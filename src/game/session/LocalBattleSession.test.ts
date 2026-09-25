import { beforeAll, expect, test } from 'bun:test';
import init, { PvePlanner, LocalRuntime } from '../../generated/naval-wasm/naval_wasm';
import { PveDraft } from './PveDraft';
import { LocalBattleSession } from './LocalBattleSession';
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
  maxBatch = 0; batches = 0; posts = 0; detail: string[] = []; winds: { speed: number; direction: number }[] = [];
  /** Hold replies to model a round trip longer than one render frame. */
  manual = false; private held: (() => void)[] = [];
  get inFlight() { return this.held.length; }
  terminated = false;
  private planner?: PvePlanner;
  runtime!: LocalRuntime;
  constructor(runtime?: LocalRuntime) { if (runtime) this.runtime = runtime; }
  postMessage(message: { type: string; commands?: CommandEnvelope[]; ticks?: number; detailShipIds?: string[]; request?: unknown; placements?: unknown; formations?: unknown; wind?: { speed: number; direction: number } }) {
    if (message.type === 'advance') this.posts++;
    const reply = () => {
      if (this.terminated) return;
      try {
      if (message.type === 'options') { this.onmessage?.({ data: { type: 'options', options: JSON.parse(PvePlanner.options(manifest)) } }); return; }
      if (message.type === 'plan') {
        this.planner?.free(); this.planner = new PvePlanner(manifest, JSON.stringify(message.request));
        this.onmessage?.({ data: { type: 'briefing', briefing: JSON.parse(this.planner.briefing()) } }); return;
      }
      if (message.type === 'validate') {
        this.planner!.validate_placement(JSON.stringify(message.placements));
        this.onmessage?.({ data: { type: 'validated' } }); return;
      }
      if (message.type === 'deploy' && this.planner) {
        this.runtime = this.planner.start(JSON.stringify(message.placements), JSON.stringify(message.formations ?? {}));
        this.planner.free(); this.planner = undefined;
      }
      if (message.type === 'restart') { this.runtime.restart_pve(); this.detail = []; }
      if (message.type === 'advance') {
        this.batches++;
        this.maxBatch = Math.max(this.maxBatch, message.ticks!);
        this.detail = message.detailShipIds ?? [];
        if (message.wind) { this.winds.push(message.wind); this.runtime.set_wind(message.wind.speed, message.wind.direction); }
        for (const command of message.commands!) {
          this.runtime.command(JSON.stringify(command));
          this.onmessage?.({ data: { type: 'ack', sequence: command.sequence, accepted: true, command: command.command.type, shipId: command.shipId } });
        }
        for (let n = message.ticks!; n > 0; n -= 6) this.runtime.step(Math.min(6, n));
      }
      // The Rust codec encodes against the frame this runtime published last;
      // local.worker.ts relays its text unparsed.
      const update = this.runtime.snapshot_delta(this.detail);
      // A fixed synthetic cost: 2 ms per tick and 1 ms per snapshot.
      const cost = message.type === 'advance' ? { ticks: message.ticks!, stepMs: message.ticks! * 2, snapshotMs: 1 } : undefined;
      this.onmessage?.({ data: { type: 'snapshot', reset: message.type === 'restart', update, cost } });
      } catch (error) { this.onmessage?.({ data: { type: 'error', message: String(error) } }); }
    };
    if (this.manual) this.held.push(reply); else queueMicrotask(reply);
  }
  /** Deliver one held reply, letting the session schedule from it. */
  async flush() { this.held.shift()?.(); await Promise.resolve(); }
  terminate() { if (this.terminated) return; this.terminated = true; this.runtime?.free(); this.planner?.free(); }
}
async function fixture(withAircraft = false, durationSeconds?: number) {
  const planner = new PvePlanner(manifest, JSON.stringify({ version: 1, seed: 17001, mapId: 'iron-bottom-sound', weather: 'clear', difficulty: 'normal', ships: [{ id: 'own', presetId: 'fletcher', groupId: 'g' }, ...(withAircraft ? [{ id: 'carrier', presetId: 'enterprise-cv6', groupId: 'g' }] : [])], groups: [{ id: 'g', name: 'Group 1', station: 'front' }] }));
  const briefing = JSON.parse(planner.briefing()) as PveBriefing;
  if (durationSeconds !== undefined) briefing.setup.ships.push({ ...briefing.setup.ships[0], id: 'enemy', team: 'b', spawn: { x: 0, z: -8000, heading: 0 } });
  const placements = briefing.setup.ships.map(s => ({ id: s.id, spawn: s.spawn! }));
  const runtime = durationSeconds === undefined ? planner.start(JSON.stringify(placements)) : new LocalRuntime(manifest, JSON.stringify({ ...briefing.setup, missionRules: { ...briefing.setup.missionRules, durationSeconds } }));
  const worker = new TestWorker(runtime); planner.free();
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
    await frame(session, .1); await frame(session, 0); expect(session.tick).toBeGreaterThan(0);
    session.result = 'victory';
    session.setSimulationSpeed(4); expect(session.simulationSpeed).toBe(1);
  } finally { session.dispose(); }
});


test('a developer wind change reshapes the local sea physics mid-battle until restart', async () => {
  const calm = await fixture(), windy = await fixture();
  try {
    for (const { session } of [calm, windy]) for (let i = 0; i < 60; i++) await frame(session, 1 / 60);
    const launch = windy.session.sea;
    expect(windy.session.setWind(24, 200)).toBe(true);
    expect(windy.session.sea.windMps).toBe(24);
    expect(windy.session.sea.amplitudeM).toBeGreaterThan(launch.amplitudeM);
    expect(windy.session.sea.direction).toBeCloseTo(200 * Math.PI / 180);
    expect(windy.session.sea.phase).toBe(launch.phase);
    for (const { session } of [calm, windy]) { for (let i = 0; i < 240; i++) await frame(session, 1 / 60); await frame(session, 0); }
    // Exactly one batch carried the change, and the ships now ride a different sea.
    expect(windy.worker.winds).toEqual([{ speed: 24, direction: 200 }]);
    expect(windy.session.tick).toBe(calm.session.tick);
    expect(windy.worker.runtime.snapshot()).not.toBe(calm.worker.runtime.snapshot());
    // Omitted values return to the launch sea; a restart does too.
    windy.session.setWind(); expect(windy.session.sea.windMps).toBe(launch.windMps);
    windy.session.setWind(30); await windy.session.restartPve();
    expect(windy.session.sea).toBe(launch);
  } finally { calm.session.dispose(); windy.session.dispose(); }
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

test('simulation load reports worker step cost and busy share over the measured window', async () => {
  const { session } = await fixture();
  try {
    session.releaseHelm();
    expect(session.simulationLoad).toBeUndefined();
    // Sixty-hertz helm batches of one tick: 2 ms step + 1 ms snapshot each, 60 per second.
    for (let i = 0; i < 150; i++) await frame(session, 1 / 60);
    const load = session.simulationLoad!;
    expect(load.tickMs).toBeCloseTo(2);
    expect(load.snapshotMs).toBeCloseTo(1);
    expect(load.ticksPerSecond).toBeCloseTo(60, 0);
    expect(load.busy).toBeCloseTo(.18, 1);
    await session.restartPve();
    expect(session.simulationLoad).toBeUndefined();
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

test('validation timeout retires the retained draft and a fresh preparation can deploy and restart', async () => {
  const original = globalThis.Worker;
  const workers: TestWorker[] = [];
  globalThis.Worker = class extends TestWorker { constructor() { super(); workers.push(this); } } as unknown as typeof Worker;
  const request: Parameters<typeof PveDraft.create>[0] = { version: 1, seed: 17001, mapId: 'iron-bottom-sound', weather: 'clear', difficulty: 'normal',
    ships: [{ id: 'own', presetId: 'fletcher', groupId: 'g' }], groups: [{ id: 'g', name: 'Group 1', station: 'front' }] };
  let draft: PveDraft | undefined;
  let session: LocalBattleSession | undefined;
  try {
    await PveDraft.options();
    draft = await PveDraft.create(structuredClone(request));
    expect(workers.length).toBe(1);
    const briefing = draft.briefing;
    const placements = briefing.setup.ships.map(s => ({ id: s.id, spawn: s.spawn! }));
    await expect(draft.validate([])).rejects.toThrow();
    expect(draft.usable).toBe(true);
    await draft.validate(placements);
    workers[0].manual = true;
    const pending = draft.validate(placements);
    await expect(draft.deploy(placements)).rejects.toThrow('unavailable');
    expect(draft.usable).toBe(true);
    await workers[0].flush(); await pending;
    let deadline!: () => void;
    const originalTimer = globalThis.setTimeout;
    globalThis.setTimeout = ((callback: () => void) => { deadline = callback; return originalTimer(() => {}, 60000); }) as typeof setTimeout;
    const validation = draft.validate(placements);
    globalThis.setTimeout = originalTimer;
    deadline(); await expect(validation).rejects.toThrow('Deployment validation took too long.');
    expect(workers[0].terminated).toBe(true);
    expect(draft.usable).toBe(false);
    // The dialog drops an unusable draft; the same request can prepare again.
    draft.dispose();
    draft = await PveDraft.create(structuredClone(request));
    expect(workers.length).toBe(2);
    expect(draft.briefing).toEqual(briefing);
    await workers[0].flush();
    await draft.validate(placements);
    session = await draft.deploy(placements);
    await session.restartPve();
    expect(session.tick).toBe(0);
  } finally { session?.dispose(); draft?.dispose(); PveDraft.release(); globalThis.Worker = original; }
});

test('initialization errors and deadlines retire their worker and allow a fresh deployment', async () => {
  const original = globalThis.Worker;
  const workers: TestWorker[] = [];
  globalThis.Worker = class extends TestWorker { constructor() { super(); workers.push(this); } } as unknown as typeof Worker;
  const request: Parameters<typeof PveDraft.create>[0] = { version: 1, seed: 17001, mapId: 'iron-bottom-sound', weather: 'clear', difficulty: 'normal',
    ships: [{ id: 'own', presetId: 'fletcher', groupId: 'g' }], groups: [{ id: 'g', name: 'Group 1', station: 'front' }] };
  let draft: PveDraft | undefined;
  let session: LocalBattleSession | undefined;
  try {
    for (const failure of ['error-reply', 'timeout', 'worker-error'] as const) {
      draft = await PveDraft.create(structuredClone(request));
      const worker = workers.at(-1)!;
      const placements = draft.briefing.setup.ships.map(s => ({ id: s.id, spawn: s.spawn! }));
      if (failure === 'error-reply') {
        // Real Rust rejects the incomplete deployment; initialization must own cleanup.
        await expect(draft.deploy([])).rejects.toThrow();
      } else {
        worker.manual = true;
        const originalTimer = globalThis.setTimeout;
        let deadline!: () => void;
        let deployment!: ReturnType<PveDraft['deploy']>;
        try {
          globalThis.setTimeout = ((callback: () => void) => { deadline = callback; return originalTimer(() => {}, 60000); }) as typeof setTimeout;
          deployment = draft.deploy(placements);
          // Definition admission precedes worker initialization. Let its promise
          // chain settle while the deadline interception remains installed.
          await new Promise<void>(resolve => originalTimer(resolve, 0));
        } finally { globalThis.setTimeout = originalTimer; }
        if (failure === 'timeout') deadline();
        else worker.onerror?.({ message: 'Worker initialization crashed.' });
        await expect(deployment).rejects.toThrow(failure === 'timeout' ? 'Battle worker took too long to load.' : 'Worker initialization crashed.');
      }
      expect(worker.terminated).toBe(true);
      expect(draft.usable).toBe(false);
      draft = await PveDraft.create(structuredClone(request));
      expect(workers.at(-1)).not.toBe(worker);
      await worker.flush();
      session = await draft.deploy(placements);
      expect(session.tick).toBe(0);
      expect(workers.at(-1)!.terminated).toBe(false);
      session.dispose(); session = undefined;
    }
  } finally { session?.dispose(); draft?.dispose(); PveDraft.release(); globalThis.Worker = original; }
}, 15000);

test('disposing during validation rejects the pending request and never reuses its worker', async () => {
  const original = globalThis.Worker;
  const workers: TestWorker[] = [];
  globalThis.Worker = class extends TestWorker { constructor() { super(); workers.push(this); } } as unknown as typeof Worker;
  const request: Parameters<typeof PveDraft.create>[0] = { version: 1, seed: 17001, mapId: 'iron-bottom-sound', weather: 'clear', difficulty: 'normal',
    ships: [{ id: 'own', presetId: 'fletcher', groupId: 'g' }], groups: [{ id: 'g', name: 'Group 1', station: 'front' }] };
  let draft: PveDraft | undefined;
  let session: LocalBattleSession | undefined;
  try {
    draft = await PveDraft.create(request);
    const worker = workers[0], briefing = draft.briefing;
    const placements = briefing.setup.ships.map(s => ({ id: s.id, spawn: s.spawn! }));
    worker.manual = true;
    const validation = draft.validate(placements);
    expect(worker.inFlight).toBe(1);
    draft.dispose();
    await expect(validation).rejects.toThrow('Mission closed.');
    expect(worker.terminated).toBe(true);
    expect(draft.usable).toBe(false);
    draft = await PveDraft.create(request);
    expect(workers.length).toBe(2);
    expect(draft.briefing).toEqual(briefing);
    await worker.flush();
    expect(worker.inFlight).toBe(0);
    await draft.validate(placements);
    session = await draft.deploy(placements);
    expect(session.tick).toBe(0);
  } finally { session?.dispose(); draft?.dispose(); PveDraft.release(); globalThis.Worker = original; }
});


test('a real finished battle keeps publishing aftermath frames with its result locked', async () => {
  const { session } = await fixture(false, 1);
  try {
    for (let i = 0; i < 60; i++) await frame(session, 1 / 60);
    await frame(session, 0);
    expect(session.result).not.toBe('active');
    const outcome = structuredClone(session.outcome);
    const tick = session.tick;
    for (let i = 0; i < 60; i++) await frame(session, 1 / 60);
    await frame(session, 0);
    expect(session.tick).toBe(tick + 60);
    expect(session.outcome).toEqual(outcome);
    expect(session.remainingSeconds).toBe(0);
  } finally { session.dispose(); }
});
