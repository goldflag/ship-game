import { expandSnapshot } from '../../src/multiplayer/snapshotDelta';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import version from '../../src/generated/naval-version.json';
const base = process.env.NAVAL_TEST_URL ?? 'http://127.0.0.1:8787';
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function join(mode: string, inviteCode?: string) {
  const response = await fetch(`${base}/api/join`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fleet: ['fletcher', 'fletcher'], mode, inviteCode, version }) });
  assert.equal(response.status, 200, await response.clone().text()); return response.json();
}
function connect(ticket: string) {
  const socket = new WebSocket(base.replace(/^http/, 'ws') + '/api/socket'); socket.binaryType = 'arraybuffer';
  const messages: any[] = []; let latest: any;
  socket.onopen = () => socket.send(JSON.stringify({ type: 'hello', ticket, version }));
  socket.onmessage = e => { if (typeof e.data === 'string') { const message = JSON.parse(e.data); messages.push(message); if(message.type === 'error') console.error(message); } else latest = expandSnapshot(messages.findLast(m => m.type === 'matched').baseline, JSON.parse(gunzipSync(new Uint8Array(e.data)).toString())); };
  return { socket, messages, get frame() { return latest; }, send(message: object) { socket.send(JSON.stringify(message)); } };
}
async function until<T>(read: () => T, label: string): Promise<NonNullable<T>> {
  const deadline = Date.now() + 15000;
  for (;;) { const value = read(); if (value) return value!; assert.ok(Date.now() < deadline, `Timed out: ${label}`); await sleep(25); }
}
const first = await join('create-invite'); const a = connect(first.ticket);
const second = await join('join-invite', first.inviteCode); const b = connect(second.ticket);
const sockets = [a.socket, b.socket];
try {
  const am = await until(() => a.messages.find(m => m.type === 'matched'), 'first match');
  const bm = await until(() => b.messages.find(m => m.type === 'matched'), 'second match');
  assert.equal(am.matchId, bm.matchId); assert.notEqual(am.team, bm.team);
  await until(() => a.frame?.phase === 'loading', 'barrier');
  a.send({ type: 'ready', version }); await sleep(200); assert.equal(a.frame.tick, 0);
  b.send({ type: 'ready', version }); await until(() => a.frame?.tick > 6, 'running');
  const own = am.setup.ships.find((s: any) => s.team === am.team).id;
  const enemy = am.setup.ships.find((s: any) => s.team !== am.team).id;
  a.send({ type: 'command', envelope: { sequence: 1, connectionEpoch: am.connectionEpoch, shipId: enemy, command: { type: 'hold' } } });
  const rejected = await until(() => a.messages.find(m => m.type === 'ack' && m.sequence === 1), 'ownership rejection'); assert.equal(rejected.accepted, false);
  a.send({ type: 'command', envelope: { sequence: 2, connectionEpoch: am.connectionEpoch, shipId: own, command: { type: 'move', position: [1000, -1000] } } });
  assert.equal((await until(() => a.messages.find(m => m.type === 'ack' && m.sequence === 2), 'move acknowledgement')).accepted, true);
  const resumed = connect(first.ticket); sockets.push(resumed.socket);
  const rm = await until(() => resumed.messages.find(m => m.type === 'matched'), 'reconnect'); assert.ok(rm.connectionEpoch > am.connectionEpoch);
  resumed.send({ type: 'ready', version });
  await until(() => a.messages.find(m => m.type === 'error' && m.code === 'replaced'), 'old connection replaced');
  await until(() => resumed.frame?.phase === 'running', 'resumed running');
  resumed.send({ type: 'surrender' });
  await until(() => b.frame?.phase === 'finished', 'forfeit result');
  assert.equal(b.frame.outcome.reason, 'forfeit'); assert.equal(b.frame.outcome.winnerTeamId, bm.team);
  const final = connect(second.ticket); sockets.push(final.socket);
  await until(() => final.frame?.phase === 'finished', 'reconnect frozen result'); assert.deepEqual(final.frame.outcome, b.frame.outcome);
  console.log(JSON.stringify({ ok: true, matchId: am.matchId, checks: ['load barrier', 'ownership', 'movement', 'reconnect epoch', 'old socket replacement', 'forfeit', 'frozen result reconnect'], finalTick: b.frame.tick }));
} finally { sockets.forEach(s => s.close()); }
