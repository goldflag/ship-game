import { SnapshotSession, type Snapshot } from './SnapshotSession';
import type { BattleSetup as RuntimeSetup } from '../../multiplayer/generated/BattleSetup';
import type { Command } from '../../multiplayer/generated/Command';
import { botSelection, setupSpawns, type BattleSetup } from '../../simulation/battle';
import { DEFAULT_MAP } from '../../maps/catalog';
import type { CombatIntent } from '../../simulation/combat';
import type { HelmCommand } from '../../simulation/ship';
import { applyLocalDelta } from './localSnapshotDelta';
import { CommandQueue } from './commandQueue';
import type { PveBriefing } from '../../multiplayer/generated/PveBriefing';
import type { Placement } from '../../multiplayer/generated/Placement';
import pveAir from '../../../assets/gameplay/pve-air.v1.json';
import type { AirRules } from '../../multiplayer/generated/AirRules';
export function runtimeSetup(setup: BattleSetup, seed: number): RuntimeSetup {
  const spawns = setupSpawns(setup);
  const ships: RuntimeSetup['ships'] = [{ id: 'player', presetId: setup.playerShipId, team: 'a', controller: 'player', aiLevel: 'normal', spawn: spawns.friendly[0] }];
  for (const [team, entries, poses] of [['a', setup.friendlyBots, spawns.friendly.slice(1)], ['b', setup.enemies, spawns.enemy]] as const)
    entries.forEach((entry, i) => { const bot = botSelection(entry); ships.push({ id: `${team === 'a' ? 'friendly' : 'enemy'}-${i + 1}`, presetId: bot.shipId, team, controller: 'bot', aiLevel: bot.aiLevel, spawn: poses[i] }); });
  return { ships, seed, mapId: setup.mapId ?? DEFAULT_MAP, weather: setup.weather ?? 'map', spawnDistance: setup.spawnDistance, windSpeed: setup.windSpeed ?? null, ...(setup.missionRules ? { missionRules: setup.missionRules,
    ...(setup.missionRules.airProfileId === pveAir.id ? { airRules: pveAir as AirRules } : {}),
  } : {}) };
}
export class LocalBattleSession extends SnapshotSession {
  readonly networked = false;
  private worker: Worker;
  private received?: Snapshot;
  private commands = new CommandQueue();
  get orderReceipts() { return this.commands.receipts; }
  get queuedOrderCount() { return this.commands.length; }
  private accumulator = 0; private busy = true; private disposed = false;
  private speed: 1 | 2 | 4 = 1;
  get simulationSpeed() { return this.speed; }
  setSimulationSpeed(speed: 1 | 2 | 4): void {
    if (!this.missionRules || this.disposed || this.result !== 'active' || ![1, 2, 4].includes(speed)) return;
    this.speed = speed; this.accumulator = 0;
  }
  onFailure?: (message: string) => void;
  private fail(message: string) { this.pending = undefined; this.busy = false; this.connectionStatus = message; this.phase = 'cancelled'; this.dispose(); this.onFailure?.(message); }
  private restartRequest?: { resolve(): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> };
  private constructor(setup: RuntimeSetup, worker = new Worker(new URL('./local.worker.ts', import.meta.url), { type: 'module' })) { super(setup); this.worker = worker; }
  static async create(setup: BattleSetup): Promise<LocalBattleSession> {
    const session = new LocalBattleSession(runtimeSetup(setup, crypto.getRandomValues(new Uint32Array(1))[0]));
    return session.initialize({ type: 'init', setup: session.setup });
  }
  static async deploy(worker: Worker, briefing: PveBriefing, placements: Placement[]): Promise<LocalBattleSession> {
    const setup = { ...briefing.setup, ships: briefing.setup.ships.map(ship => ({ ...ship, spawn: placements.find(p => p.id === ship.id)?.spawn ?? ship.spawn })) };
    const session = new LocalBattleSession(setup, worker);
    return session.initialize({ type: 'deploy', placements });
  }
  private async initialize(message: { type: 'init'; setup: RuntimeSetup } | { type: 'deploy'; placements: Placement[] }): Promise<LocalBattleSession> {
    const session = this;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { session.dispose(); reject(new Error('Battle worker took too long to load.')); }, 120_000);
      session.worker.onerror = event => { clearTimeout(timer); session.fail(event.message); reject(new Error(event.message)); };
      session.worker.onmessage = event => {
        const data = event.data;
        if (data.type === 'error') { clearTimeout(timer); session.fail(data.message); reject(new Error(data.message)); }
        if (data.type === 'ack') {
          session.commands.acknowledge(data.sequence, data.accepted ? 'accepted' : 'rejected', data.message);
          session.commandAcknowledged(data.accepted, data.message, data.command, data.shipId);
        }
        if (data.type === 'snapshot') {
          try {
            if (data.reset) { session.received = undefined; session.pending = undefined; session.resetIntents(); }
            // The owned worker already parsed, validated and normalized this frame.
            if (data.baseTick !== session.received?.tick) throw new Error('Battle worker snapshot sequence changed.');
            const frame = applyLocalDelta(session.received, data.delta) as Snapshot;
            session.received = frame;
            if (!session.actors.length || data.reset) { session.apply(frame); clearTimeout(timer); resolve(); } else session.pending = frame;
            session.busy = false;
            if (data.reset && session.restartRequest) {
              clearTimeout(session.restartRequest.timer); session.restartRequest.resolve(); session.restartRequest = undefined;
            }
          } catch (error) { clearTimeout(timer); session.fail(String(error)); reject(error); }
        }
      };
      session.worker.postMessage(message);
    });
    return session;
  }
  protected send(shipId: string, command: Command) {
    if (this.disposed) return;
    if (!this.commands.enqueue(shipId, command)) this.commandAcknowledged(false, 'Order queue full. Resume to process orders.', command.type, shipId);
  }
  advance(dt: number, helm: HelmCommand, intent: CombatIntent, beforeStep?: () => void) {
    // Only fixed authoritative ticks accelerate. Camera/input keep wall time;
    // interpolation consumes the same simulated interval as the snapshots.
    const simulationDt = dt * this.speed;
    this.consume(simulationDt, beforeStep);
    if (this.disposed || this.restartRequest || this.result !== 'active' || dt <= 0) return;
    this.accumulator = Math.min(.1 * this.speed, this.accumulator + simulationDt);
    // Captains run every authoritative tick, but fleet presentation needs only
    // 20 wall-time updates/second. Helm input and queued orders retain the 60Hz
    // dispatch opportunity, including commands issued between ordinary batches.
    const updatesPerSecond = this.missionRules && !this.controlledShipId && !this.commands.length ? 20 : 60;
    // Summing six 120Hz frames can land just below three ticks. Round only the
    // floating-point noise, so a full batch is not delayed by another frame.
    const availableTicks = Math.floor(this.accumulator * 60 + 1e-9);
    if (this.busy || availableTicks < this.speed * (60 / updatesPerSecond)) return;
    const ticks = Math.min(6 * this.speed, availableTicks); this.accumulator = Math.max(0, this.accumulator - ticks / 60);
    this.input(helm, intent, true); this.busy = true;
    this.worker.postMessage({ type: 'advance', commands: this.commands.drain(), ticks });
  }
  restartPve(): Promise<void> {
    if (!this.missionRules || this.disposed || this.restartRequest) return Promise.reject(new Error('This mission cannot restart right now.'));
    this.commands.clear(); this.accumulator = 0; this.speed = 1; this.pending = undefined; this.busy = true;
    return new Promise((resolve, reject) => {
      this.restartRequest = { resolve, reject, timer: setTimeout(() => this.fail('Mission restart took too long.'), 30000) };
      this.worker.postMessage({ type: 'restart' });
    });
  }
  dispose() {
    this.disposed = true; this.worker.terminate(); this.commands.clear(); this.received = undefined;
    if (this.restartRequest) { clearTimeout(this.restartRequest.timer); this.restartRequest.reject(new Error(this.connectionStatus || 'Mission closed.')); this.restartRequest = undefined; }
  }
}
