import { SnapshotSession, type Snapshot } from './SnapshotSession';
import type { BattleSetup as RuntimeSetup } from '../../multiplayer/generated/BattleSetup';
import type { CommandEnvelope } from '../../multiplayer/generated/CommandEnvelope';
import type { Command } from '../../multiplayer/generated/Command';
import { botSelection, setupSpawns, type BattleSetup } from '../../simulation/battle';
import { DEFAULT_MAP } from '../../maps/catalog';
import type { CombatIntent } from '../../simulation/combat';
import type { HelmCommand } from '../../simulation/ship';
import { applyLocalDelta } from './localSnapshotDelta';
export function runtimeSetup(setup: BattleSetup, seed: number): RuntimeSetup {
  const spawns = setupSpawns(setup);
  const ships: RuntimeSetup['ships'] = [{ id: 'player', presetId: setup.playerShipId, team: 'a', controller: 'player', aiLevel: 'normal', spawn: spawns.friendly[0] }];
  for (const [team, entries, poses] of [['a', setup.friendlyBots, spawns.friendly.slice(1)], ['b', setup.enemies, spawns.enemy]] as const)
    entries.forEach((entry, i) => { const bot = botSelection(entry); ships.push({ id: `${team === 'a' ? 'friendly' : 'enemy'}-${i + 1}`, presetId: bot.shipId, team, controller: 'bot', aiLevel: bot.aiLevel, spawn: poses[i] }); });
  return { ships, seed, mapId: setup.mapId ?? DEFAULT_MAP, weather: setup.weather ?? 'map', spawnDistance: setup.spawnDistance, windSpeed: setup.windSpeed ?? null };
}
export class LocalBattleSession extends SnapshotSession {
  readonly networked = false;
  private worker: Worker;
  private received?: Snapshot;
  private commands: CommandEnvelope[] = []; private sequence = 0; private accumulator = 0; private busy = true; private disposed = false;
  onFailure?: (message: string) => void;
  private fail(message: string) { this.pending = undefined; this.busy = false; this.connectionStatus = message; this.phase = 'cancelled'; this.dispose(); this.onFailure?.(message); }
  private constructor(setup: RuntimeSetup) { super(setup); this.worker = new Worker(new URL('./local.worker.ts', import.meta.url), { type: 'module' }); }
  static async create(setup: BattleSetup): Promise<LocalBattleSession> {
    const session = new LocalBattleSession(runtimeSetup(setup, crypto.getRandomValues(new Uint32Array(1))[0]));
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { session.dispose(); reject(new Error('Battle worker took too long to load.')); }, 120_000);
      session.worker.onerror = event => { clearTimeout(timer); session.fail(event.message); reject(new Error(event.message)); };
      session.worker.onmessage = event => {
        const data = event.data;
        if (data.type === 'error') { clearTimeout(timer); session.fail(data.message); reject(new Error(data.message)); }
        if (data.type === 'rejected') session.commandAcknowledged(false, data.message);
        if (data.type === 'snapshot') {
          try {
            // The owned worker already parsed, validated and normalized this frame.
            if (data.baseTick !== session.received?.tick) throw new Error('Battle worker snapshot sequence changed.');
            const frame = applyLocalDelta(session.received, data.delta) as Snapshot;
            session.received = frame;
            if (!session.actors.length) { session.apply(frame); clearTimeout(timer); resolve(); } else session.pending = frame;
            session.busy = false;
          } catch (error) { clearTimeout(timer); session.fail(String(error)); reject(error); }
        }
      };
      session.worker.postMessage({ type: 'init', setup: session.setup });
    });
    return session;
  }
  protected send(shipId: string, command: Command) { if (!this.disposed && this.commands.length < 128) this.commands.push({ sequence: ++this.sequence, connectionEpoch: 1, shipId, command }); }
  advance(dt: number, helm: HelmCommand, intent: CombatIntent, beforeStep?: () => void) {
    this.consume(dt, beforeStep);
    if (this.disposed || this.result !== 'active' || dt <= 0) return;
    this.accumulator = Math.min(.1, this.accumulator + dt);
    if (this.busy || this.accumulator < 1 / 60) return;
    const ticks = Math.min(6, Math.floor(this.accumulator * 60)); this.accumulator -= ticks / 60;
    this.input(helm, intent, true); this.busy = true;
    this.worker.postMessage({ type: 'advance', commands: this.commands.splice(0), ticks });
  }
  dispose() { this.disposed = true; this.worker.terminate(); this.commands.length = 0; this.received = undefined; }
}
