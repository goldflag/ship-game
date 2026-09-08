import { gunzipSync } from 'node:zlib';
// Run against a dedicated server with NAVAL_MAX_MATCHES=2 and no other players.
import assert from 'node:assert/strict';
import version from '../../src/generated/naval-version.json';

const base = process.env.NAVAL_TEST_URL ?? 'http://127.0.0.1:8787';
const duration = Number(process.env.NAVAL_TEST_SECONDS ?? 30);
assert.ok(Number.isInteger(duration) && duration >= 1 && duration <= 1800);
const fleet = ['enterprise-cv6', 'enterprise-cv6', 'bismarck', 'baltimore', 'fletcher', 'fletcher', 'fletcher', 'fletcher'];
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const post = (path: string, body: object) => fetch(`${base}/api/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
async function join(mode: string, inviteCode?: string) {
  const response = await post('join', { mode, inviteCode, fleet, version });
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
}
async function until(read: () => boolean, label: string) {
  const deadline = Date.now() + 15000;
  while (!read()) { assert.ok(Date.now() < deadline, `Timed out: ${label}`); await sleep(25); }
}
const health = await (await fetch(`${base}/api/health`)).json();
assert.equal(health.activeMatches, 0); assert.equal(health.maxMatches, 2);
const cancelled = await join('create-invite');
assert.equal((await post('cancel', { ticket: cancelled.ticket })).status, 204);
assert.notEqual((await post('join', { mode: 'join-invite', inviteCode: cancelled.inviteCode, fleet, version })).status, 200);
const clients: { socket: WebSocket; messages: any[]; frames: number; bytes: number }[] = [];
function connect(ticket: string) {
  const socket = new WebSocket(base.replace(/^http/, 'ws') + '/api/socket'); socket.binaryType = 'arraybuffer';
  const client = { socket, messages: [] as any[], frames: 0, bytes: 0 }; clients.push(client);
  socket.onopen = () => socket.send(JSON.stringify({ type: 'hello', ticket, version }));
  socket.onmessage = event => {
    if (typeof event.data === 'string') client.messages.push(JSON.parse(event.data));
    else { const message = JSON.parse(gunzipSync(new Uint8Array(event.data)[0] === 0 ? new Uint8Array(event.data).subarray(1) : new Uint8Array(event.data)).toString()); if (message.type === 'matched') client.messages.push(message); else { client.frames++; client.bytes += event.data.byteLength; } }
  };
  return client;
}
try {
  for (let i = 0; i < 2; i++) {
    const first = await join('create-invite'); connect(first.ticket);
    connect((await join('join-invite', first.inviteCode)).ticket);
  }
  await until(() => clients.every(c => c.messages.some(m => m.type === 'matched')), 'four connected players');
  const rejected = await post('join', { mode: 'create-invite', fleet, version });
  assert.equal(rejected.ok, false);
  assert.match((await rejected.json()).error, /match workers are occupied/);
  for (const client of clients) client.socket.send(JSON.stringify({ type: 'ready', version }));
  const heartbeat = setInterval(() => clients.forEach(c => c.socket.send(JSON.stringify({ type: 'ping', nonce: Date.now() >>> 0 }))), 3000);
  try { await sleep((duration + 3) * 1000); } finally { clearInterval(heartbeat); }
  assert.equal((await (await fetch(`${base}/api/health`)).json()).activeMatches, 2);
  for (const client of clients) {
    assert.ok(client.frames > duration * 10, `Snapshot delivery fell below 10 Hz: ${client.frames}`);
    assert.ok(!client.messages.some(m => m.type === 'error'), JSON.stringify(client.messages.filter(m => m.type === 'error')));
  }
  console.log(JSON.stringify({ ok: true, durationSeconds: duration, concurrentMatches: 2, vesselsPerMatch: 16, checks: ['HTTP queue cancellation', 'four players', 'third match rejected', 'sustained snapshots'], clients: clients.map(c => ({ frames: c.frames, bytes: c.bytes })) }));
} finally {
  for (const client of clients) { if (client.socket.readyState === WebSocket.OPEN) client.socket.send(JSON.stringify({ type: 'surrender' })); }
  await sleep(250); clients.forEach(c => c.socket.close());
}
