import { beforeAll, expect, test } from 'bun:test';
import init, { PvePlanner, type LocalRuntime } from '../../generated/naval-wasm/naval_wasm';
import { LocalBattleSession } from './LocalBattleSession';
import { decodeSnapshot } from './snapshotCodec';
import { localDelta } from './localSnapshotDelta';
import type { Snapshot } from './SnapshotSession';
import type { PveBriefing } from '../../multiplayer/generated/PveBriefing';
import type { CommandEnvelope } from '../../multiplayer/generated/CommandEnvelope';
let manifest: Uint8Array;
beforeAll(async () => {
  await init({ module_or_path: await Bun.file(new URL('../../generated/naval-wasm/naval_wasm_bg.wasm', import.meta.url)).arrayBuffer() });
  manifest = new Uint8Array(await Bun.file(new URL('../../../.build/naval-content/manifest.json', import.meta.url)).arrayBuffer());
});
const helm = { throttle: 0, rudder: 0 }, intent = { aim: [0, 0, 0] as [number, number, number], battery: 'main' as const, fire: false };
/** Real WASM authority behind an asynchronous worker transport, with bounded batches. */
class TestWorker {
  onmessage?: (event: { data: unknown }) => void;
  onerror?: (event: { message: string }) => void;
  previous?: Snapshot; maxBatch = 0; batches = 0; posts = 0; detail: string[] = [];
  /** Hold replies to model a round trip longer than one render frame. */
  manual = false; private held: (() => void)[] = [];
  get inFlight() { return this.held.length; }
  constructor(readonly runtime: LocalRuntime) {}
  postMessage(message: { type: string; commands?: CommandEnvelope[]; ticks?: number; detailShipIds?: string[] }) {
    if (message.type === 'advance') this.posts++;
    const reply = () => {
      if (message.type === 'restart') { this.runtime.restart_pve(); this.previous = undefined; this.detail = []; }
      if (message.type === 'advance') {
        this.batches++;
        this.maxBatch = Math.max(this.maxBatch, message.ticks!);
        this.detail = message.detailShipIds ?? [];
        for (const command of message.commands!) {
          this.runtime.command(JSON.stringify(command));
          this.onmessage?.({ data: { type: 'ack', sequence: command.sequence, accepted: true, command: command.command.type, shipId: command.shipId } });
        }
        for (let n = message.ticks!; n > 0; n -= 6) this.runtime.step(Math.min(6, n));
      }
      const frame = decodeSnapshot(this.runtime.detailed_snapshot(this.detail));
      this.onmessage?.({ data: { type: 'snapshot', reset: message.type === 'restart', baseTick: this.previous?.tick, delta: localDelta(this.previous, frame) } });
      this.previous = frame;
    };
    if (this.manual) this.held.push(reply); else queueMicrotask(reply);
  }
  /** Deliver one held reply, letting the session schedule from it. */
  async flush() { this.held.shift()?.(); await Promise.resolve(); }
  terminate() { this.runtime.free(); }
}
async function fixture(withAircraft = false) {
  const planner = new PvePlanner(manifest, JSON.stringify({ version: 1, seed: 17001, mapId: 'pacific-islands', weather: 'clear', difficulty: 'normal', ships: [{ id: 'own', presetId: 'fletcher', groupId: 'g' }, ...(withAircraft ? [{ id: 'carrier', presetId: 'enterprise-cv6', groupId: 'g' }] : [])], groups: [{ id: 'g', name: 'Group 1', station: 'front' }] }));
  const briefing = JSON.parse(planner.briefing()) as PveBriefing;
  const placements = briefing.setup.ships.map(s => ({ id: s.id, spawn: s.spawn! }));
  const worker = new TestWorker(planner.start(JSON.stringify(placements))); planner.free();
  return { worker, session: await LocalBattleSession.deploy(worker as unknown as Worker, briefing, placements) };
}
async function frame(session: LocalBattleSession, dt: number) { session.advance(dt, helm, intent); await Promise.resolve(); }

test('local speed schedules the same authoritative battle at 1×, 2× and 4×', async () => {
  let expected: string | undefined;
  for (const speed of [1, 2, 4] as const) {
    const { session, worker } = await fixture(true);
    try {
      session.setSimulationSpeed(speed);
      for (let i = 0; i < 240 / speed; i++) await frame(session, 1 / 60);
      await frame(session, 0);
      expect(session.tick).toBe(240);
      const snapshot = worker.runtime.snapshot();
      if (expected) expect(snapshot).toBe(expected); else expected = snapshot;
      expect(worker.maxBatch).toBe(3 * speed);
    } finally { session.dispose(); }
  }
});

test('4× pause preserves queued orders; resume admits once and restart restores 1×', async () => {
  const { session, worker } = await fixture();
  try {
    session.setSimulationSpeed(4);
    await frame(session, .1); await frame(session, 0);
    expect(session.tick).toBe(24); expect(worker.maxBatch).toBe(24);
    session.holdShipArea('own', [1000, 10000], 500);
    for (let i = 0; i < 10; i++) await frame(session, 0);
    expect(session.tick).toBe(24); expect(session.queuedOrderCount).toBe(1);
    await frame(session, 1 / 60); await frame(session, 0);
    expect(session.tick).toBe(28); expect(session.orderReceipts.at(-1)?.state).toBe('accepted');
    expect(session.queuedOrderCount).toBe(0);
    await session.restartPve();
    expect(session.simulationSpeed).toBe(1); expect(session.tick).toBe(0); expect(session.orderReceipts).toEqual([]);
    session.result = 'victory';
    await frame(session, .1); expect(session.tick).toBe(0);
    session.setSimulationSpeed(4); expect(session.simulationSpeed).toBe(1);
  } finally { session.dispose(); }
});


test('4× batches high-refresh render frames without dropping authoritative time', async () => {
  const { session, worker } = await fixture();
  try {
    session.setSimulationSpeed(4);
    for (let i = 0; i < 120; i++) await frame(session, 1 / 120);
    await frame(session, 0);
    expect(session.tick).toBe(240);
    expect(worker.batches).toBe(20);
    expect(worker.maxBatch).toBe(12);
  } finally { session.dispose(); }
});

test('fleet command batches presentation at 20 Hz while preserving accelerated ticks', async () => {
  for (const speed of [1, 2, 4] as const) {
    const { session, worker } = await fixture();
    try {
      session.releaseHelm();
      await frame(session, 1 / 60); await frame(session, 0);
      session.setSimulationSpeed(speed);
      const startTick = session.tick, startBatches = worker.batches;
      for (let i = 0; i < 120; i++) await frame(session, 1 / 120);
      await frame(session, 0);
      expect(session.tick - startTick).toBe(60 * speed);
      expect(worker.batches - startBatches).toBe(20);
      expect(worker.maxBatch).toBe(3 * speed);
      // An addressed order must not wait for the next ordinary publication.
      session.holdShipArea('own', [1000, 10000], 500);
      await frame(session, 1 / 60);
      expect(session.orderReceipts.at(-1)?.state).toBe('accepted');
    } finally { session.dispose(); }
  }
});

test('taking the helm retains 60 Hz input opportunities at accelerated speed', async () => {
  const { session, worker } = await fixture();
  try {
    session.selectShip('own');
    await frame(session, 1 / 60); await frame(session, 0);
    expect(session.controlledShipId).toBe('own');
    session.setSimulationSpeed(4);
    const tick = session.tick, batches = worker.batches;
    for (let i = 0; i < 60; i++) await frame(session, 1 / 60);
    await frame(session, 0);
    expect(session.tick - tick).toBe(240);
    expect(worker.batches - batches).toBe(60);
    expect(worker.maxBatch).toBe(4);
  } finally { session.dispose(); }
});

test('a slow round trip takes its next batch from the reply, not the next frame', async () => {
  const { session, worker } = await fixture();
  try {
    session.releaseHelm();
    await frame(session, 1 / 60); await frame(session, 0);
    session.setSimulationSpeed(4);
    worker.manual = true;
    session.advance(.05, helm, intent);
    expect(worker.posts).toBe(1);
    // Frames keep arriving while the worker is busy; none of them may dispatch.
    for (let i = 0; i < 3; i++) session.advance(1 / 60, helm, intent);
    expect(worker.posts).toBe(1);
    await worker.flush();
    expect(worker.posts).toBe(2);
    expect(worker.inFlight).toBe(1);
  } finally { session.dispose(); }
});

test('a round trip longer than the old clamp carries its debt instead of dropping time', async () => {
  const { session, worker } = await fixture();
  try {
    session.releaseHelm();
    await frame(session, 1 / 60); await frame(session, 0);
    session.setSimulationSpeed(4);
    const start = session.tick;
    worker.manual = true;
    // 0.05 s dispatches twelve ticks; nine more frames owe another 36, which the
    // former 0.4 s clamp would have silently discarded.
    session.advance(.05, helm, intent);
    for (let i = 0; i < 9; i++) session.advance(1 / 60, helm, intent);
    for (let i = 0; i < 5; i++) await worker.flush();
    await frame(session, 0);
    expect(session.tick - start).toBe(48);
    expect(session.achievedSpeed).toBe(4);
  } finally { session.dispose(); }
});

test('damage-control detail travels only for the ship whose panel is on screen', async () => {
  const { session, worker } = await fixture(true);
  try {
    session.selectShip('own');
    await frame(session, 1 / 60); await frame(session, 0);
    await frame(session, 1 / 60); await frame(session, 0);
    expect(session.controlledShipId).toBe('own');
    expect(worker.detail).toEqual(['own']);
    const own = session.actors.find(a => a.motion.id === 'own')!;
    const other = session.actors.find(a => a.motion.id !== 'own')!;
    expect(own.damage.control.rooms[0].trend).toBeString();
    expect(own.damage.control.pumping.length).toBeGreaterThan(0);
    expect(other.damage.control.pumping).toEqual([]);
    expect(other.damage.connections).toEqual([]);
    // Hull fire effects and the inspection view read every ship's room fires by
    // compartment index, so the rooms stay in place with only what they read.
    expect(other.damage.control.rooms.length).toBe(other.damage.compartments.length);
    expect(Object.keys(other.damage.control.rooms[0])).toEqual(['heat', 'intensity']);
    // Fire markers and flooding readouts still need every hull's compartments.
    expect(other.damage.compartments.length).toBeGreaterThan(0);
    expect(other.damage.control.mounts.length).toBeGreaterThan(0);
  } finally { session.dispose(); }
});
