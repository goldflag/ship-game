import { testAccount, verifyMatchContent } from './test-accounts';
import { gunzipSync } from 'node:zlib';
// Run against a dedicated server with NAVAL_MAX_MATCHES=2 and no other players.
import assert from 'node:assert/strict';
import version from '../../src/generated/naval-version.json';

const base = process.env.NAVAL_TEST_URL ?? 'http://127.0.0.1:8787';
const duration = Number(process.env.NAVAL_TEST_SECONDS ?? 600);
assert.ok(Number.isInteger(duration) && duration >= 1 && duration <= 1800);
const historicalFleet = ['enterprise-cv6', 'enterprise-cv6', 'bismarck', 'baltimore', 'fletcher', 'fletcher', 'fletcher', 'fletcher'].map(
  (presetId) => ({ kind: 'historical', presetId }),
);
const template = process.env.NAVAL_TEST_CUSTOM_SOURCE ? await Bun.file(process.env.NAVAL_TEST_CUSTOM_SOURCE).json() : undefined;
const fleet = historicalFleet;
let measuring = false;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const cookies = new Map<string, string>();
const post = async (path: string, body: object, cookie?: string) =>
  fetch(`${base}/api/${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: cookie ?? cookies.get((body as any).ticket) ?? (await testAccount(base)),
      origin: new URL(base).origin,
    },
    body: JSON.stringify(body),
  });
async function join(mode: string, inviteCode?: string) {
  const cookie = await testAccount(base);
  const selected = template ? await customFleet(cookie) : fleet;
  const response = await post('join', { mode, inviteCode, fleet: selected, version }, cookie);
  assert.equal(response.status, 200, await response.clone().text());
  const result = await response.json();
  cookies.set(result.ticket, cookie);
  return result;
}
async function until(read: () => boolean, label: string) {
  const deadline = Date.now() + 15000;
  while (!read()) {
    assert.ok(Date.now() < deadline, `Timed out: ${label}`);
    await sleep(25);
  }
}
const health = await (await fetch(`${base}/api/health`)).json();
assert.equal(health.activeMatches, 0);
assert.equal(health.maxMatches, 2);
const cancelled = await join('create-invite');
assert.equal((await post('cancel', { ticket: cancelled.ticket })).status, 204);
assert.notEqual((await post('join', { mode: 'join-invite', inviteCode: cancelled.inviteCode, fleet, version })).status, 200);
async function customFleet(cookie: string) {
  const selected: any[] = [];
  for (let i = 0; i < 8; i++) {
    const source = structuredClone(template);
    source.id = 'design-' + crypto.randomUUID();
    source.revision = crypto.randomUUID();
    const response = await fetch(base + '/api/ships/' + source.id, {
      method: 'PUT',
      headers: { cookie, origin: new URL(base).origin, 'Content-Type': 'application/json', 'idempotency-key': crypto.randomUUID() },
      body: JSON.stringify({
        designId: source.id,
        name: source.name,
        source,
        schemaVersion: 1,
        catalogRevision: source.construction.catalogRevision,
        expectedRevisionId: null,
      }),
    });
    assert.equal(response.status, 200, await response.clone().text());
    const saved = await response.json();
    selected.push({ kind: 'custom', designId: saved.designId, revisionId: saved.id });
  }
  return selected;
}
const clients: { socket: WebSocket; messages: any[]; frames: number; bytes: number }[] = [];
function connect(ticket: string) {
  const socket = new WebSocket(base.replace(/^http/, 'ws') + '/api/socket', {
    headers: { cookie: cookies.get(ticket)!, origin: new URL(base).origin },
  });
  socket.binaryType = 'arraybuffer';
  const client = { socket, messages: [] as any[], frames: 0, bytes: 0 };
  clients.push(client);
  socket.onopen = () => socket.send(JSON.stringify({ type: 'hello', ticket, version }));
  socket.onmessage = async (event) => {
    if (typeof event.data === 'string') client.messages.push(JSON.parse(event.data));
    else {
      const message = JSON.parse(
        gunzipSync(new Uint8Array(event.data)[0] === 0 ? new Uint8Array(event.data).subarray(1) : new Uint8Array(event.data)).toString(),
      );
      if (message.type === 'matched') {
        await verifyMatchContent(base, cookies.get(ticket)!, ticket, message.contentHash, false);
        client.messages.push(message);
      } else if (measuring) {
        client.frames++;
        client.bytes += event.data.byteLength;
      }
    }
  };
  return client;
}
try {
  for (let i = 0; i < 2; i++) {
    const first = await join('create-invite');
    connect(first.ticket);
    connect((await join('join-invite', first.inviteCode)).ticket);
    await until(() => clients.every((c) => c.messages.some((m) => m.type === 'matched')), 'connected players');
    for (const client of clients.slice(i * 2))
      client.socket.send(
        JSON.stringify({ type: 'ready', version, contentHash: client.messages.find((m) => m.type === 'matched').contentHash }),
      );
  }
  await until(() => clients.every((c) => c.messages.some((m) => m.type === 'matched')), 'four connected players');
  const rejected = await post('join', { mode: 'create-invite', fleet, version });
  assert.equal(rejected.ok, false);
  assert.match((await rejected.json()).error, /match workers are occupied/);
  let loading = true,
    compileJobs = 0;
  // The worker is private. The qualification container joins only its isolated
  // network; public admission must reject a third battle before compilation.
  const compilerURL = process.env.NAVAL_TEST_COMPILER_URL;
  if (template) assert.ok(compilerURL && process.env.SERVICE_SECRET, 'Private compiler credentials required');
  let compileFailure: unknown;
  const compilerLoad = template
    ? (async () => {
        while (loading) {
          const source = structuredClone(template);
          source.id = 'load-' + crypto.randomUUID();
          source.revision = crypto.randomUUID();
          const response = await fetch(compilerURL + '/compile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-service-secret': process.env.SERVICE_SECRET! },
            body: JSON.stringify({ accountId: 'qualification-load', sourceJson: JSON.stringify(source) }),
          });
          assert.equal(response.status, 200, await response.clone().text());
          await response.arrayBuffer();
          compileJobs++;
        }
      })().catch((error) => {
        compileFailure = error;
      })
    : Promise.resolve();
  await sleep(3500);
  clients.forEach((c) => {
    c.frames = 0;
    c.bytes = 0;
  });
  measuring = true;
  const heartbeat = setInterval(
    () => clients.forEach((c) => c.socket.send(JSON.stringify({ type: 'ping', nonce: Date.now() >>> 0 }))),
    3000,
  );
  try {
    await sleep(duration * 1000);
  } finally {
    measuring = false;
    loading = false;
    clearInterval(heartbeat);
    await compilerLoad;
  }
  if (compileFailure) throw compileFailure;
  assert.equal((await (await fetch(`${base}/api/health`)).json()).activeMatches, 2);
  for (const client of clients) {
    assert.ok(client.frames > duration * 15, `Snapshot delivery fell below 15 Hz: ${client.frames}`);
    assert.ok(!client.messages.some((m) => m.type === 'error'), JSON.stringify(client.messages.filter((m) => m.type === 'error')));
  }
  if (template) assert.ok(compileJobs > 0);
  const result = {
    ok: true,
    fixtureDigest: template ? new Bun.CryptoHasher('sha256').update(JSON.stringify(template)).digest('hex') : undefined,
    custom: !!template,
    compileJobs,
    version,
    durationSeconds: duration,
    concurrentMatches: 2,
    vesselsPerMatch: 16,
    checks: ['HTTP queue cancellation', 'four players', 'third match rejected', 'sustained snapshots'],
    clients: clients.map((c) => ({ frames: c.frames, bytes: c.bytes })),
  };
  console.log(JSON.stringify(result));
} finally {
  for (const client of clients) {
    if (client.socket.readyState === WebSocket.OPEN) client.socket.send(JSON.stringify({ type: 'surrender' }));
  }
  await sleep(250);
  clients.forEach((c) => c.socket.close());
}
