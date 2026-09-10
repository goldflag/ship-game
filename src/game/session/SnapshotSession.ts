import type { DeckPolicy } from '../../multiplayer/generated/DeckPolicy';
import type { BattleSession, ObservedShip, BattleDebrief, DeckServiceAction } from './BattleSession';
import type { ContactTrack } from '../../multiplayer/generated/ContactTrack';
import type { ReconCoverage } from '../../multiplayer/generated/ReconCoverage';
import type { BattleSetup } from '../../multiplayer/generated/BattleSetup';
import type { Command } from '../../multiplayer/generated/Command';
import type { WeaponsPolicy } from '../../multiplayer/generated/WeaponsPolicy';
import type { FleetOrderState } from '../../multiplayer/generated/FleetOrderState';
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
import { updateMountCarriers } from '../../simulation/mountFrames';
import type { HelmCommand } from '../../simulation/ship';

/** Wire state is decoded once at the authority boundary. Optional Rust values
 * become absent JS properties; null deck slots must never look like deck poses. */
export { decodeSnapshot, readSnapshot } from './snapshotCodec';
type WireActor = Omit<FleetActor, 'definition' | 'team' | 'bot' | 'airWing'> & {
  presetId: string; team: TeamId; aiLevel?: NonNullable<FleetActor['bot']>['aiLevel']; launcherTrains: Record<string, number>;
};
export interface Snapshot {
  tick: number; actors: WireActor[]; wings: { ownerId: string; state: AirWingState }[];
  shells: Shell[]; torpedoes: Torpedo[]; depthCharges: DepthCharge[]; releases: AirRelease[]; events: CombatEvent[];
  outcome?: BattleOutcome; afloatKg: [number | null, number | null];
  view?: 'team'; contacts?: ContactTrack[]; observedShips?: ObservedShip[]; remainingSeconds?: number | null;
  reconCoverage?: ReconCoverage;
  debrief?: Snapshot;
  shipOutcomes?: Record<string, 'operational' | 'sunk' | 'incapacitated'>;
  records: { scores: Record<string, { damageDealt: number; frags: number; damageLog: DamageLogEntry[] }>; shellHistory: ShellHistory[] };
  selectedShipIds?: (string | undefined)[]; phase?: string; reason?: string; connected?: boolean[]; loaded?: boolean[]; countdown?: number;
  fleetOrders?: Record<string, FleetOrderState>;
}
function replaceObject<T extends object>(target: T, value: T): void {
  for (const key of Object.keys(target) as (keyof T)[]) if (!(key in value)) delete target[key];
  Object.assign(target, value);
}
export abstract class SnapshotSession implements BattleSession {
  abstract readonly networked: boolean;
  readonly isBattle = true;
  actors: FleetActor[] = [];
  player!: FleetActor; target?: FleetActor;
  observationTracks: ContactTrack[] = []; observedShips: ObservedShip[] = [];
  reconCoverage?: ReconCoverage;
  private targetContactId?: string;
  get targetContact() { return this.observationTracks.find(c => c.id === this.targetContactId); }
  get missionRules() { return this.setup.missionRules; }
  remainingSeconds?: number | null;
  debrief?: BattleDebrief;
  shells: Shell[] = []; torpedoes: Torpedo[] = []; depthCharges: DepthCharge[] = []; airReleases: AirRelease[] = [];
  events: CombatEvent[] = []; shellHistory: ShellHistory[] = [];
  tick = 0; result: BattleResult = 'active'; outcome?: BattleOutcome; phase = 'loading'; connectionStatus = '';
  connected?: boolean[]; loaded?: boolean[]; countdown = 0;
  targetUnderway = true;
  afloatKg: [number | null, number | null] = [0, 0]; playerDamageDealt = 0; playerFrags = 0; damageLog: DamageLogEntry[] = [];
  shipScores: Record<string, { damageDealt: number; frags: number }> = {};
  aircraftLosses = { own: 0, enemy: 0 };
  private lastLossSequence = -1; private lastFrameTick = -1;
  ammunitionSelection: Record<string, Ammunition> = {};
  readonly mapId: OceanMapId; readonly islands; readonly sea; readonly seed; readonly spawnDistance;
  protected pending?: Snapshot;
  protected fireQueued = false;
  protected depthM: number | null = null; protected emergencyBlow: boolean | null = null;
  private orderNoticeUntil = 0;
  commandAcknowledged(accepted: boolean, error?: string, command?: Command['type'], shipId?: string) {
    if (!accepted && this.selectionRequest && ((command === 'release-helm' && this.selectionRequest.id === null)
      || (command === 'select' && this.selectionRequest.id === shipId))) this.selectionRequest = undefined;
    if (!accepted && !this.connectionStatus) { this.connectionStatus = `Order declined: ${error ?? 'unavailable'}`; this.orderNoticeUntil = performance.now() + 3000; }
  }
  private elapsed = 0; private interval = 1 / 20;
  private autopilot?: { throttle: number; rudder: number };
  private lastHelm: HelmCommand = { throttle: 0, rudder: 0 };
  controlledShipId?: string;
  fleetOrders: Record<string, FleetOrderState> = {};
  private selectionRequest?: { id: string | null; until: number };
  private lastControl = '';
  constructor(readonly setup: BattleSetup, readonly ownTeam: TeamId = 'a', readonly playerIndex = 0) {
    this.mapId = setup.mapId as OceanMapId; this.seed = setup.seed; this.spawnDistance = setup.spawnDistance;
    this.islands = setup.missionRules ? mapIslands(this.mapId, 16000, setup.missionRules.budget.maxShips).map(island => ({ ...island, z: island.z + 8000 }))
      : mapIslands(this.mapId, setup.spawnDistance, Math.max(...(['a', 'b'] as const).map(t => setup.ships.filter(s => s.team === t).length)));
    this.sea = createSeaState(this.mapId, setup.weather as WeatherId, setup.seed, setup.windSpeed ?? undefined);
  }
  get definition() { return this.player.definition; }
  get ship() { return this.player.motion; }
  get aircraft() { return this.actors.flatMap(a => a.airWing?.planes ?? []); }
  get interpolationAlpha() { return Math.min(1, this.elapsed / this.interval); }
  protected abstract send(shipId: string, command: Command): void;
  protected resetIntents(): void {
    this.selectionRequest = undefined; this.targetContactId = undefined; this.target = undefined;
    this.fireQueued = false; this.autopilot = undefined; this.lastControl = '';
    this.depthM = null; this.emergencyBlow = null; this.orderNoticeUntil = 0;
    this.connectionStatus = ''; this.controlledShipId = undefined;
  }
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
      // These stable renderer identities must not alias the retained wire frame:
      // local deltas reuse its unchanged paths in subsequent snapshots.
      const actor = existing ?? { ...state, motion: { ...state.motion }, damage: { ...state.damage },
        definition: shipPreset(presetId), team: team === this.ownTeam ? 'friendly' : 'enemy' } as FleetActor;
      if (existing) {
        const { motion, damage, ...rest } = state;
        replaceObject(actor.motion, motion); replaceObject(actor.damage, damage); Object.assign(actor, rest);
      } else this.actors.push(actor);
      if (actor.definition.mounts.some(m => m.parentMountId)) {
        // Derived frames belong to presentation state, never the retained delta baseline.
        actor.mounts = state.mounts.map(m => ({ ...m }));
        updateMountCarriers(actor.definition, actor.mounts);
      }
      // AI diagnostics are public; tracking, targeting caches and RNG remain private.
      actor.bot = aiLevel ? { aiLevel } as FleetActor['bot'] : undefined;
      actor.torpedoLaunchers = Object.entries(launcherTrains).map(([id, train]) => ({ id, train }));
      actor.sea = { state: this.sea, time: this.tick / 60 };
      const wing = frame.wings.find(w => w.ownerId === actor.motion.id)?.state;
      if (wing) {
        const previous = new Map(actor.airWing?.planes.map(p => [p.id, p]) ?? []);
        const planes = wing.planes.map(wirePlane => {
          const p = { ...wirePlane, team: actor.team };
          const old = previous.get(p.id);
          if (old) {
            p.previousPosition = old.position;
            p.previousAttitude = { heading: old.heading, pitch: old.pitch, bank: old.bank };
            p.previousControls = old.controls;
          }
          return p;
        });
        const rules = this.setup.airRules;
        actor.airWing = { ...wing, planes, operatingRules: rules ? {
          endurance: rules.endurance,
          activeFlightLimit: rules.activeFlights.kind === 'unlimited' ? null : rules.activeFlights.kind === 'limited' ? rules.activeFlights.maximum : actor.definition.airWing?.maxActiveFlights ?? 4,
        } : undefined };
      }
    }
    this.actors = this.actors.filter(a => frame.actors.some(w => w.motion.id === a.motion.id));
    this.observationTracks = frame.contacts ?? []; this.observedShips = frame.observedShips ?? [];
    this.reconCoverage = frame.reconCoverage;
    this.remainingSeconds = frame.view === 'team' ? frame.remainingSeconds ?? null : frame.remainingSeconds;
    const selected = frame.selectedShipIds?.[this.playerIndex];
    const player = this.actors.find(a => a.motion.id === selected && a.team === 'friendly') ?? this.player ?? this.actors.find(a => a.team === 'friendly')!;
    if (player !== this.player) { this.lastControl = ''; this.ammunitionSelection = {}; this.autopilot = undefined; this.depthM = null; this.emergencyBlow = null; }
    this.player = player;
    const authoritativeControl = frame.selectedShipIds ? selected ?? undefined : player.motion.id;
    if (this.selectionRequest && (this.selectionRequest.id === (authoritativeControl ?? null)
      || (this.networked && performance.now() >= this.selectionRequest.until))) this.selectionRequest = undefined;
    // An older in-flight frame cannot give manual authority back during a transfer.
    // Local commands can remain queued in tactical pause for arbitrarily long.
    this.controlledShipId = this.selectionRequest ? undefined : authoritativeControl;
    this.fleetOrders = frame.fleetOrders ?? {};
    if (frame.view === 'team') this.target = undefined;
    else if (!this.target || !this.actors.includes(this.target)) this.target = this.actors.find(a => a.team === 'enemy');
    this.shells = frame.shells; this.torpedoes = frame.torpedoes; this.depthCharges = frame.depthCharges; this.airReleases = frame.releases;
    this.events = frame.events; this.shellHistory = frame.records.shellHistory;
    const score = frame.records.scores[player.motion.id];
    this.playerDamageDealt = score?.damageDealt ?? 0; this.playerFrags = score?.frags ?? 0; this.damageLog = score?.damageLog ?? [];
    this.shipScores = Object.fromEntries(Object.entries(frame.records.scores).map(([id, s]) => [id, { damageDealt: s.damageDealt, frags: s.frags }]));
    // A restarted mission replays from tick zero; loss counts start again with it.
    if (frame.tick < this.lastFrameTick) { this.aircraftLosses = { own: 0, enemy: 0 }; this.lastLossSequence = -1; }
    this.lastFrameTick = frame.tick;
    const ownPlanes = new Set(this.actors.flatMap(a => a.airWing?.planes.map(p => p.id) ?? []));
    for (const event of frame.events) {
      if (event.kind !== 'aircraft-lost' || !(event.sequence > this.lastLossSequence)) continue;
      this.lastLossSequence = event.sequence;
      if (ownPlanes.has(event.aircraft?.id ?? '')) this.aircraftLosses.own++; else this.aircraftLosses.enemy++;
    }
    this.afloatKg = this.relativeTonnage(frame.afloatKg);
    this.outcome = frame.outcome && { ...frame.outcome, winnerTeamId: frame.outcome.winnerTeamId ? frame.outcome.winnerTeamId === this.ownTeam ? 'a' : 'b' : null, afloatKg: this.relativeTonnage(frame.outcome.afloatKg) };
    this.result = !this.outcome ? 'active' : !this.outcome.winnerTeamId ? 'draw' : this.outcome.winnerTeamId === 'a' ? 'victory' : 'defeat';
    this.debrief = frame.outcome && frame.debrief ? {
      seed: this.seed, tick: frame.debrief.tick,
      ships: frame.debrief.actors.map(actor => {
        const score = frame.debrief!.records.scores[actor.motion.id];
        return { id: actor.motion.id, presetId: actor.presetId, team: actor.team === this.ownTeam ? 'friendly' : 'enemy',
          status: frame.debrief!.shipOutcomes?.[actor.motion.id] ?? (physicalLoss(actor) ? 'sunk' : 'operational'),
          damageDealt: score?.damageDealt ?? 0, frags: score?.frags ?? 0,
          aircraftRemaining: frame.debrief!.wings.find(w => w.ownerId === actor.motion.id)?.state.planes.filter(p => !['lost', 'withdrawn'].includes(p.phase) && p.hp > 0).length ?? 0 };
      }),
    } : undefined;
    this.phase = frame.phase ?? 'running'; this.connected = frame.connected; this.loaded = frame.loaded; this.countdown = frame.countdown ?? 0;
    if (frame.reason || frame.phase === 'finished') this.connectionStatus = frame.reason ?? '';
  }
  private relativeTonnage<T>(values: [T, T]): [T, T] { return this.ownTeam === 'a' ? values : [values[1], values[0]]; }
  protected input(helm: HelmCommand, intent: CombatIntent, active: boolean): void {
    this.lastHelm = { ...helm };
    if (this.selectionRequest && (!this.networked || performance.now() < this.selectionRequest.until)) return;
    if (!active || this.controlledShipId !== this.ship.id || physicalLoss(this.player) || this.result !== 'active' || this.phase !== 'running') { this.fireQueued = false; return; }
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
  selectTarget(id: string) {
    if (this.observationTracks.some(c => c.id === id && c.kind === 'surface')) { this.targetContactId = id; this.target = undefined; return true; }
    const target = this.actors.find(a => a.motion.id === id && a.team === 'enemy'); if (!target) return false;
    this.target = target; this.targetContactId = undefined; return true;
  }
  selectShip(id: string) { const actor = this.actors.find(a => a.motion.id === id && a.team === 'friendly' && !physicalLoss(a)); if (!actor) return false; this.selectionRequest = { id, until: performance.now() + 2000 }; this.send(id, { type: 'select' }); return true; }
  releaseHelm() {
    const id = this.controlledShipId;
    if (!id) return false;
    this.selectionRequest = { id: null, until: performance.now() + 2000 };
    this.controlledShipId = undefined;
    this.fireQueued = false; this.autopilot = undefined; this.depthM = null; this.emergencyBlow = null;
    this.send(id, { type: 'release-helm' });
    return true;
  }
  routeShip(id: string, waypoints: [number, number][], speedMps: number, looped = false, append = false) { this.send(id, { type: 'route', waypoints, speedMps, looped, append }); }
  holdShipArea(id: string, position: [number, number], radiusM: number) { this.send(id, { type: 'hold-area', position, radiusM }); }
  escortShip(id: string, leaderId: string, offset: [number, number], radiusM: number) { this.send(id, { type: 'escort', leaderId, offset, radiusM }); }
  setShipWeapons(id: string, policy: WeaponsPolicy) { this.send(id, { type: 'weapons', policy }); }
  moveShip(id: string, point: Vec3) { this.send(id, { type: 'move', position: [point[0], point[2]] }); if (id === this.ship.id) this.autopilot = { ...this.lastHelm }; }
  focusShip(id: string, targetId: string) { this.send(id, { type: 'focus', targetId }); }
  holdShip(id: string) { this.send(id, { type: 'hold' }); if (id === this.ship.id) this.autopilot = { ...this.lastHelm }; }
  automateShip(id: string) { this.send(id, { type: 'autonomous' }); if (id === this.ship.id) this.autopilot = { ...this.lastHelm }; }
  setDepth(depthM: number, emergency = false) { this.depthM = depthM; this.emergencyBlow = emergency; }
  requestFire() { this.fireQueued = true; }
  orderAmmunition(battery: Battery, type: Ammunition, _immediate = false, group?: string) { this.ammunitionSelection[group ?? battery] = type; }
  launchAircraft(squadronId: string) {
    const flight = squadronFlights(this.player).find(f => f.squadronId === squadronId && f.planeIds.some(id => this.aircraft.find(p => p.id === id)?.phase === 'ready'));
    if (!flight) return 0;
    const fighter = this.definition.airWing!.squadrons.find(s => s.id === squadronId)?.role === 'fighter';
    const targetId = this.targetContact?.id ?? this.target?.motion.id;
    if (!fighter && !targetId) return 0;
    return this.commandSquadron(flight.id, fighter ? { kind: 'defend' } : { kind: 'attack', targetId: targetId! }) ? flight.planeIds.length : 0;
  }
  commandSquadron(id: string, order: AirOrder) {
    const owner = this.actors.find(a => a.team === 'friendly' && squadronFlights(a).some(f => f.id === id));
    if (!owner || this.result !== 'active') return false;
    if (this.setup.missionRules && order.kind === 'attack') order = { kind: 'strike', contactId: order.targetId };
    if (this.setup.missionRules && order.kind === 'intercept') order = { kind: 'intercept-contact', contactId: order.flightId };
    this.send(owner.motion.id, { type: 'air', flightId: id, order: order.kind === 'defend' ? { ...order, targetId: order.targetId ?? null } : order });
    return true;
  }
  setFormationPolicy(id: string, policy: import('../../multiplayer/generated/FormationPolicy').FormationPolicy) { this.send(id, { type: 'formation-policy', policy }); }
  commandDeck(id: string, action: DeckServiceAction) {
    const owner = this.actors.find(a => a.team === 'friendly' && a.airWing?.deck && a.airWing.flights.some(f => f.id === id));
    if (!owner || this.result !== 'active') return false;
    this.send(owner.motion.id, { type: 'deck', flightId: id, action });
    return true;
  }
  cancelDeckTask(carrierId: string, requestId: number) {
    const owner = this.actors.find(a => a.team === 'friendly' && a.motion.id === carrierId && a.airWing?.deck);
    if (!owner || this.result !== 'active' || !Number.isSafeInteger(requestId) || requestId < 1) return false;
    this.send(carrierId, { type: 'cancel-deck', requestId });
    return true;
  }
  setDeckPolicy(carrierId: string, policy: DeckPolicy) {
    if (this.result !== 'active' || !this.actors.some(a => a.team === 'friendly' && a.motion.id === carrierId && a.airWing?.deck)) return false;
    this.send(carrierId, { type: 'deck-policy', policy });
    return true;
  }
  prioritizeDeckTask(carrierId: string, requestId: number) {
    if (this.result !== 'active' || !Number.isSafeInteger(requestId) || requestId < 1
      || !this.actors.some(a => a.team === 'friendly' && a.motion.id === carrierId && a.airWing?.deck)) return false;
    this.send(carrierId, { type: 'next-deck', requestId });
    return true;
  }
  orderFlight(id: string, order: AirOrder) { return this.commandSquadron(id, order); }
  recallAircraft(flightId?: string) {
    const owners = flightId ? this.actors.filter(a => a.team === 'friendly' && squadronFlights(a).some(f => f.id === flightId)) : [this.player];
    for (const owner of owners) this.send(owner.motion.id, { type: 'recall', flightId: flightId ?? null });
  }
}
