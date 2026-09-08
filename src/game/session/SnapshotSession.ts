import type { BattleSession } from './BattleSession';
import type { BattleSetup } from '../../multiplayer/generated/BattleSetup';
import type { Command } from '../../multiplayer/generated/Command';
import type { TeamId } from '../../multiplayer/generated/TeamId';
import type { Ammunition, Battery, Vec3 } from '../../ships/blueprint';
import { shipPreset, shipPresets } from '../../ships/presets';
import { mapIslands, type OceanMapId } from '../../maps/catalog';
import type { WeatherId } from '../../maps/conditions';
import type { FleetActor, BattleResult } from '../../simulation/battle';
import type { CombatIntent, CombatEvent, ShellHistory } from '../../simulation/combat';
import type { DamageLogEntry } from '../../simulation/damageLog';
import type { Shell } from '../../simulation/damage';
import type { Torpedo } from '../../simulation/torpedoes';
import type { DepthCharge } from '../../simulation/depthCharges';
import { squadronFlights, type AirOrder, type AirWingState, type AirRelease } from '../../simulation/aircraft';
import { physicalLoss, type BattleOutcome } from '../../simulation/battleRules';
import { presentationAim, presentationTelemetry } from '../../simulation/presentation';
import { createSeaState } from '../../simulation/sea';
import type { HelmCommand } from '../../simulation/ship';

/** Wire state is decoded once at the authority boundary. Optional Rust values
 * become absent JS properties; null deck slots must never look like deck poses. */
export function decodeSnapshot(json: string): Snapshot { return readSnapshot(JSON.parse(json)); }
export function readSnapshot(value: unknown): Snapshot {
  const normalize = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    const object = value as Record<string, unknown>;
    for (const key of Object.keys(object)) {
      if (object[key] === null && !Array.isArray(object)) delete object[key];
      else normalize(object[key]);
    }
  };
  const frame = value as Snapshot;
  if (!frame || !Number.isSafeInteger(frame.tick) || frame.tick < 0 || !Array.isArray(frame.actors) || !frame.actors.length || frame.actors.length > 60)
    throw new Error('Invalid battle snapshot.');
  normalize(frame);
  return frame;
}
type WireActor = Omit<FleetActor, 'definition' | 'team' | 'bot' | 'airWing'> & {
  presetId: string; team: TeamId; aiLevel?: NonNullable<FleetActor['bot']>['aiLevel']; launcherTrains: Record<string, number>;
};
export interface Snapshot {
  tick: number; actors: WireActor[]; wings: { ownerId: string; state: AirWingState }[];
  shells: Shell[]; torpedoes: Torpedo[]; depthCharges: DepthCharge[]; releases: AirRelease[]; events: CombatEvent[];
  outcome?: BattleOutcome; afloatKg: [number, number];
  records: { scores: Record<string, { damageDealt: number; frags: number; damageLog: DamageLogEntry[] }>; shellHistory: ShellHistory[] };
  selectedShipIds?: (string | undefined)[]; phase?: string; reason?: string; connected?: boolean[]; loaded?: boolean[]; countdown?: number;
}
function replaceObject<T extends object>(target: T, value: T): void {
  for (const key of Object.keys(target) as (keyof T)[]) if (!(key in value)) delete target[key];
  Object.assign(target, value);
}
export abstract class SnapshotSession implements BattleSession {
  abstract readonly networked: boolean;
  readonly isBattle = true;
  actors: FleetActor[] = [];
  player!: FleetActor; target!: FleetActor;
  shells: Shell[] = []; torpedoes: Torpedo[] = []; depthCharges: DepthCharge[] = []; airReleases: AirRelease[] = [];
  events: CombatEvent[] = []; shellHistory: ShellHistory[] = [];
  tick = 0; result: BattleResult = 'active'; outcome?: BattleOutcome; phase = 'loading'; connectionStatus = '';
  connected?: boolean[]; loaded?: boolean[]; countdown = 0;
  targetUnderway = true;
  afloatKg: [number, number] = [0, 0]; playerDamageDealt = 0; playerFrags = 0; damageLog: DamageLogEntry[] = [];
  ammunitionSelection: Record<string, Ammunition> = {};
  readonly mapId: OceanMapId; readonly islands; readonly sea; readonly seed; readonly spawnDistance;
  protected pending?: Snapshot;
  protected fireQueued = false;
  protected depthM: number | null = null; protected emergencyBlow: boolean | null = null;
  private orderNoticeUntil = 0;
  commandAcknowledged(accepted: boolean, error?: string) {
    if (!accepted && !this.connectionStatus) { this.connectionStatus = `Order declined: ${error ?? 'unavailable'}`; this.orderNoticeUntil = performance.now() + 3000; }
  }
  private elapsed = 0; private interval = 1 / 20;
  private autopilot?: { throttle: number; rudder: number };
  private lastHelm: HelmCommand = { throttle: 0, rudder: 0 };
  private selectionRequest?: { id: string; until: number };
  private lastControl = '';
  constructor(readonly setup: BattleSetup, readonly ownTeam: TeamId = 'a', readonly playerIndex = 0) {
    this.mapId = setup.mapId as OceanMapId; this.seed = setup.seed; this.spawnDistance = setup.spawnDistance;
    this.islands = mapIslands(this.mapId, setup.spawnDistance, Math.max(...(['a', 'b'] as const).map(t => setup.ships.filter(s => s.team === t).length)));
    this.sea = createSeaState(this.mapId, setup.weather as WeatherId, setup.seed, setup.windSpeed ?? undefined);
  }
  get definition() { return this.player.definition; }
  get ship() { return this.player.motion; }
  get aircraft() { return this.actors.flatMap(a => a.airWing?.planes ?? []); }
  get interpolationAlpha() { return Math.min(1, this.elapsed / this.interval); }
  protected abstract send(shipId: string, command: Command): void;
  abstract advance(dt: number, helm: HelmCommand, intent: CombatIntent, beforeStep?: () => void): void;
  abstract dispose(): void;
  // Fixed ticks belong to the worker/server. Development preview cannot run a JS fallback.
  step(helm: HelmCommand, intent: CombatIntent): void { this.advance(1 / 60, helm, intent); }
  reset(): void { /* A new custom battle creates a fresh worker. Online results are immutable. */ }
  resetTarget(): void { /* Battle targets are authoritative. */ }
  protected consume(dt: number, beforeStep?: () => void): void {
    if (this.orderNoticeUntil && performance.now() >= this.orderNoticeUntil) { if (this.connectionStatus.startsWith('Order declined:')) this.connectionStatus = ''; this.orderNoticeUntil = 0; }
    this.elapsed += dt;
    if (!this.pending) return;
    const frame = this.pending; this.pending = undefined;
    beforeStep?.(); this.apply(frame);
  }
  protected apply(frame: Snapshot): void {
    const oldTick = this.tick;
    this.tick = frame.tick; this.interval = Math.max(1 / 60, (this.tick - oldTick) / 60); this.elapsed = 0;
    for (const wire of frame.actors) {
      if (!Object.hasOwn(shipPresets, wire.presetId)) throw new Error('Snapshot references unavailable content.');
      const expected = this.setup.ships.find(s => s.id === wire.motion.id);
      if (!expected || expected.presetId !== wire.presetId || expected.team !== wire.team) throw new Error('Snapshot fleet changed.');
      const { presetId, team, aiLevel, launcherTrains, ...state } = wire;
      const existing = this.actors.find(a => a.motion.id === state.motion.id);
      const actor = existing ?? { ...state, definition: shipPreset(presetId), team: team === this.ownTeam ? 'friendly' : 'enemy' } as FleetActor;
      if (existing) {
        const { motion, damage, ...rest } = state;
        replaceObject(actor.motion, motion); replaceObject(actor.damage, damage); Object.assign(actor, rest);
      } else this.actors.push(actor);
      // AI diagnostics are public; tracking, targeting caches and RNG remain private.
      actor.bot = aiLevel ? { aiLevel } as FleetActor['bot'] : undefined;
      actor.torpedoLaunchers = Object.entries(launcherTrains).map(([id, train]) => ({ id, train }));
      actor.sea = { state: this.sea, time: this.tick / 60 };
      const wing = frame.wings.find(w => w.ownerId === actor.motion.id)?.state;
      if (wing) {
        const previous = new Map(actor.airWing?.planes.map(p => [p.id, p]) ?? []);
        for (const p of wing.planes) {
          p.team = actor.team;
          const old = previous.get(p.id);
          if (old) {
            p.previousPosition = old.position;
            p.previousAttitude = { heading: old.heading, pitch: old.pitch, bank: old.bank };
            p.previousControls = old.controls;
          }
        }
        actor.airWing = wing;
      }
    }
    const selected = frame.selectedShipIds?.[this.playerIndex];
    const player = this.actors.find(a => a.motion.id === selected && a.team === 'friendly') ?? this.player ?? this.actors.find(a => a.team === 'friendly')!;
    if (player !== this.player) { this.lastControl = ''; this.ammunitionSelection = {}; this.autopilot = undefined; this.depthM = null; this.emergencyBlow = null; }
    this.player = player;
    if (this.selectionRequest?.id === player.motion.id) this.selectionRequest = undefined;
    this.target ??= this.actors.find(a => a.team === 'enemy')!;
    this.shells = frame.shells; this.torpedoes = frame.torpedoes; this.depthCharges = frame.depthCharges; this.airReleases = frame.releases;
    this.events = frame.events; this.shellHistory = frame.records.shellHistory;
    const score = frame.records.scores[player.motion.id];
    this.playerDamageDealt = score?.damageDealt ?? 0; this.playerFrags = score?.frags ?? 0; this.damageLog = score?.damageLog ?? [];
    this.afloatKg = this.relativeTonnage(frame.afloatKg);
    this.outcome = frame.outcome && { ...frame.outcome, winnerTeamId: frame.outcome.winnerTeamId ? frame.outcome.winnerTeamId === this.ownTeam ? 'a' : 'b' : null, afloatKg: this.relativeTonnage(frame.outcome.afloatKg) };
    this.result = !this.outcome ? 'active' : !this.outcome.winnerTeamId ? 'draw' : this.outcome.winnerTeamId === 'a' ? 'victory' : 'defeat';
    this.phase = frame.phase ?? 'running'; this.connected = frame.connected; this.loaded = frame.loaded; this.countdown = frame.countdown ?? 0;
    if (frame.reason || frame.phase === 'finished') this.connectionStatus = frame.reason ?? '';
  }
  private relativeTonnage(values: [number, number]): [number, number] { return this.ownTeam === 'a' ? values : [values[1], values[0]]; }
  protected input(helm: HelmCommand, intent: CombatIntent, active: boolean): void {
    this.lastHelm = { ...helm };
    if (this.selectionRequest && performance.now() < this.selectionRequest.until) return;
    if (!active || physicalLoss(this.player) || this.result !== 'active' || this.phase !== 'running') { this.fireQueued = false; return; }
    if (this.autopilot && (helm.throttle !== this.autopilot.throttle || helm.rudder !== this.autopilot.rudder)) this.autopilot = undefined;
    const priority = intent.controlPriority ?? 'balanced', focus = intent.controlFocus || null;
    const control = JSON.stringify([priority, focus]);
    if (control !== this.lastControl) { this.send(this.ship.id, { type: 'damage-control', priority, focus }); this.lastControl = control; }
    this.send(this.ship.id, { type: 'input', input: {
      manualHelm: !this.autopilot, throttle: helm.throttle, rudder: helm.rudder, aim: intent.aim,
      fire: intent.fire || this.fireQueued, battery: intent.battery, weaponGroupId: intent.weaponGroupId ?? null,
      ammunition: intent.ammunition ?? this.ammunitionSelection[intent.weaponGroupId ?? intent.battery] ?? 'ap',
      depthM: this.depthM, emergencyBlow: this.emergencyBlow,
    } });
    this.fireQueued = false;
  }
  aimAt(moduleId?: string, battery: Battery = 'main', group?: string) { return presentationAim(this, moduleId, battery, group); }
  telemetry(battery: Battery, aim: Vec3, group?: string, subject = this.player) { return presentationTelemetry(this, battery, aim, group, subject); }
  selectTarget(id: string) { const target = this.actors.find(a => a.motion.id === id && a.team === 'enemy'); if (!target) return false; this.target = target; return true; }
  selectShip(id: string) { const actor = this.actors.find(a => a.motion.id === id && a.team === 'friendly' && !physicalLoss(a)); if (!actor) return false; this.selectionRequest = { id, until: performance.now() + 2000 }; this.send(id, { type: 'select' }); return true; }
  moveShip(id: string, point: Vec3) { this.send(id, { type: 'move', position: [point[0], point[2]] }); if (id === this.ship.id) this.autopilot = { ...this.lastHelm }; }
  focusShip(id: string, targetId: string) { this.send(id, { type: 'focus', targetId }); }
  holdShip(id: string) { this.send(id, { type: 'hold' }); if (id === this.ship.id) this.autopilot = { ...this.lastHelm }; }
  automateShip(id: string) { this.send(id, { type: 'autonomous' }); if (id === this.ship.id) this.autopilot = { ...this.lastHelm }; }
  setDepth(depthM: number, emergency = false) { this.depthM = depthM; this.emergencyBlow = emergency; }
  requestFire() { this.fireQueued = true; }
  orderAmmunition(battery: Battery, type: Ammunition, _immediate = false, group?: string) { this.ammunitionSelection[group ?? battery] = type; }
  launchAircraft(squadronId: string) { const flight = squadronFlights(this.player).find(f => f.squadronId === squadronId && f.planeIds.some(id => this.aircraft.find(p => p.id === id)?.phase === 'ready')); if (!flight) return 0; this.commandSquadron(flight.id, this.definition.airWing!.squadrons.find(s => s.id === squadronId)?.role === 'fighter' ? { kind: 'defend' } : { kind: 'attack', targetId: this.target.motion.id }); return flight.planeIds.length; }
  commandSquadron(id: string, order: AirOrder) { this.send(this.ship.id, { type: 'air', flightId: id, order: order.kind === 'defend' ? { ...order, targetId: order.targetId ?? null } : order }); return this.result === 'active'; }
  orderFlight(id: string, order: AirOrder) { return this.commandSquadron(id, order); }
  recallAircraft(flightId?: string) { this.send(this.ship.id, { type: 'recall', flightId: flightId ?? null }); }
}
