import { presentationAim, presentationTelemetry } from './presentation';
import { afloatKg, matchDisplacementKg, physicalLoss, type BattleOutcome } from './battleRules';
import { weaponGroups, selectedWeapon, type WeaponGroup } from '../ships/weaponGroups';
import { commandSquadron, createAirWing, launchSquadron, orderFlight, recallAircraft, type AirRelease, type AirOrder } from './aircraft';
import { type AirWingTelemetry } from './airTelemetry';
import { DEFAULT_AI_LEVEL, type ShipAiLevel } from './aiLevels';
import { DEFAULT_MAP, mapIslands, type Island, type OceanMapId } from '../maps/catalog';
import { type VesselStatus } from './stability';
import { type ControlPriority, type ControlState } from './damageControl';
import type { Ammunition, Battery, ShipDefinition, Vec3 } from '../ships/blueprint';
import { type EquipmentCondition } from './machinery';
import { type FireReadout } from './damageReadout';
import { DamageLog, type DamageLogEntry } from './damageLog';
import { createShipState, FIXED_DT, type HelmCommand } from './ship';
import { availableAmmunition, createMountState, queueAmmunition, selectAmmunition } from './weapons';
import { BATTLE_SPAWN_DISTANCE, deployment, validateSpawns, type SpawnPositions, MAX_TEAM_SHIPS, validateSpawnDistance, type BattleFleet, type BattleResult, type FleetActor, type Team } from './battle';
import { createDepthChargeLauncherState, type DepthCharge } from './depthCharges';
import { createBotState } from './bots';
import { createTubeState, type Torpedo } from './torpedoes';
import { createSubmarineState } from './submarine';
import { createSeaState, type SeaState } from './sea';
import { createDamage, type BallisticEffectData, type DamageEvent, type Shell, type ImpactRecord, type DefeatCause } from './damage';

export interface CombatIntent { aim: Vec3; fire: boolean; battery: Battery; weaponGroupId?: string; ammunition?: Ammunition; controlPriority?: ControlPriority; controlFocus?: string; }
export interface CombatEvent extends BallisticEffectData { sequence: number; tick: number; kind: DamageEvent['kind'] | 'shot' | 'splash' | 'torpedo-launch' | 'torpedo-hit' | 'torpedo-dud' | 'torpedo-expired' | 'aircraft-launch' | 'aircraft-recovered' | 'aircraft-lost' | 'aircraft-crash' | 'aircraft-fire' | 'aircraft-release' | 'bomb-release' | 'depth-charge-launch' | 'depth-charge-splash' | 'depth-charge-blast' | 'depth-charge-hit'; aircraft?: { id: string; caliberM?: number; panic?: boolean; dragPerSecond?: number; target?: Vec3; tracerSpeed?: number; direction?: Vec3; velocity?: Vec3; airburst?: { flightTime: number; caliberM: number }; attitude?: { heading: number; pitch: number; bank: number } }; depthCharge?: { id: number; radiusM: number }; torpedo?: { id: number; velocity: Vec3; diameterM: number }; position: Vec3; message: string; shipId: string; hullDamage?: number; impact?: ImpactRecord; defeatCause?: DefeatCause; }
export interface ShellHistory { shellId: number; ownerId: string; tick: number; ammunition: Ammunition; impacts: ImpactRecord[]; outcome: 'flying' | 'splash' | 'passed-through' | 'expired' | 'stopped' | 'ricochet' | 'internal' | 'burst'; }
export interface FullCombatTelemetry {
  targetKnowledge?: 'full';
  playerSupport: { power: number; fireControl: number }; targetSupport: { power: number; fireControl: number };
  playerFires: FireReadout[]; targetFireDetails: FireReadout[];
  targetRegions: { id: string; name: string; condition: number }[];
  airWing?: AirWingTelemetry;
  airContacts?: { id: string; team: Team; x: number; z: number; heading: number; role: string; ownerId: string; flightId?: string; phase: string }[];
  weaponGroupId?: string;
  weaponGroups: (WeaponGroup & { ammunition: Ammunition; ammo: number; ready: number; total: number; reload: number })[];
  battery: Battery; range: number; ready: number; total: number; targetIntegrity: number; targetWater: number;
  /** Mean flight time to the sight for the selected battery's reachable guns, excluding reload/training. */
  flightTimeSeconds?: number;
  ammunition: Ammunition; ammunitionStock: { ap: number; he: number }; heSupported: boolean;
  targetStatus: VesselStatus; playerStatus: VesselStatus; targetList: number; targetTrim: number; targetDraftChange: number;
  playerList: number; playerTrim: number; playerDraftChange: number;
  control: ControlState; targetFires: number; controlTargets: { id: string; name: string }[];
  targetMounts: { id: string; name: string; condition: number }[];
  targetId: string; targetName: string; targetRange: number;
  targetDepthM?: number;
  contacts: { id: string; name: string; shipId: string; team: Team; controller: FleetActor['controller']; targetId?: string; x: number; z: number; heading: number; speed: number; integrity: number; sunk: boolean; status: VesselStatus; combatLost: boolean; physicalLost: boolean }[];
  battle: boolean; result: BattleResult; playerSunk: boolean;
  remainingSeconds: number | null; afloatKg: [number | null, number | null]; outcome?: BattleOutcome;
  targetPower: number; targetSteering: number; targetSunk: boolean; targetUnderway: boolean;
  mounts: { id: string; name: string; status: string; reload: number; ammo: number; loaded?: Ammunition; queued?: Ammunition }[];
  modules: ({ id: string; name: string; condition: number } & EquipmentCondition)[]; message: string;
  targetEquipmentIntegrity: number;
  playerIntegrity: number;
  playerMaxIntegrity: number;
  playerWater: number;
  submarine?: { depthM: number; targetDepthM: number; verticalSpeed: number; ballastM3: number; ballastFraction: number; emergencyBlow: boolean; propulsion: 'Diesel' | 'Electric'; maxDepthM: number; periscopeDepthM: number; maxTorpedoDepthM: number };
  targetDefeatCause?: DefeatCause;
  shellHistory: ShellHistory[];
  playerDamageDealt: number;
  playerFrags: number;
  damageLog: DamageLogEntry[];
  targetPosition: { x: number; z: number; heading: number };
  batteries: { battery: Battery; ammunition: Ammunition; ammo: number; ready: number; total: number; reload: number }[];
}
type TargetTelemetryKeys = Extract<keyof FullCombatTelemetry, `target${string}`> | 'modules' | 'shellHistory';
export type CombatTelemetry = FullCombatTelemetry | (Omit<FullCombatTelemetry, TargetTelemetryKeys> & Partial<Pick<FullCombatTelemetry, Exclude<TargetTelemetryKeys, 'targetKnowledge'>>> & { targetKnowledge: 'none' | 'contact' });
export function hasFullTarget(combat: CombatTelemetry): combat is FullCombatTelemetry {
  return combat.targetKnowledge !== 'none' && combat.targetKnowledge !== 'contact';
}
export class CombatSimulation {
  readonly player: FleetActor;
  target: FleetActor;
  readonly actors: FleetActor[];
  readonly isBattle: boolean;
  readonly spawnDistance: number;
  readonly mapId: OceanMapId;
  readonly islands: Island[];
  readonly seed: number;
  readonly sea: SeaState;
  result: BattleResult = 'active';
  outcome?: BattleOutcome;
  private readonly displacement = new Map<string, number>();
  private survivors() { return this.actors.map(a => ({ team: a.team === 'friendly' ? 'a' as const : 'b' as const, displacementKg: this.displacement.get(a.motion.id)!, physicalLoss: physicalLoss(a) })); }
  readonly shells: Shell[] = [];
  readonly torpedoes: Torpedo[] = [];
  readonly depthCharges: DepthCharge[] = [];
  readonly airReleases: AirRelease[] = [];
  get aircraft() { return this.actors.flatMap(a => a.airWing?.planes ?? []); }
  launchAircraft(squadronId: string) { return this.isBattle && this.result === 'active' ? launchSquadron(this.player, squadronId, this.target) : 0; }
  recallAircraft(flightId?: string) { if (this.isBattle && this.result === 'active') recallAircraft(this.player, flightId); }
  commandSquadron(id: string, order: AirOrder) { return this.isBattle && this.result === 'active' && commandSquadron(this.player, id, order, this.actors); }
  orderFlight(flightId: string, order: AirOrder) { return this.isBattle && this.result === 'active' && orderFlight(this.player, flightId, order, this.actors); }
  readonly events: CombatEvent[] = [];
  /** In-flight histories plus the last 16 completed shells per owner. */
  readonly shellHistory: ShellHistory[] = [];
  targetUnderway = false;
  tick = 0;
  private accumulator = 0;
  private shellSequence = 0;
  private fireQueued = false;
  orderAmmunition(battery: Battery, type: Ammunition, immediate = false, weaponGroupId?: string): void {
    this.ammunitionSelection[weaponGroupId ?? battery] = type;
    this.definition.mounts.forEach((mount, i) => {
      if (!selectedWeapon(mount.battery, mount.weapon, battery, weaponGroupId)) return;
      const state = this.player.mounts[i];
      if (immediate && availableAmmunition(state, type) >= mount.weapon.barrelCount) selectAmmunition(mount, state, type);
      else queueAmmunition(mount, state, type);
    });
  }
  private ammunitionSelection: Record<string, Ammunition> = { main: 'ap', secondary: 'ap', torpedo: 'ap', 'depth-charge': 'ap' };
  private playerDamageDealt = 0;
  private playerFrags = 0;
  private damageLog = new DamageLog();
  private initialSpawns?: SpawnPositions;
  /** Without a fleet, create an idle gunnery fixture for port and isolated asset tests. */
  constructor(readonly definition: ShipDefinition, fleet?: BattleFleet, seed = fleet?.seed ?? 0x6e617661) {
    this.isBattle = !!fleet;
    this.spawnDistance = fleet?.spawnDistance ?? BATTLE_SPAWN_DISTANCE;
    this.mapId = fleet?.mapId ?? DEFAULT_MAP;
    this.islands = mapIslands(this.mapId, this.spawnDistance, Math.max(1 + (fleet?.friendlyBots.length ?? 0), fleet?.enemies.length ?? 1));
    this.seed = seed;
    this.sea = createSeaState(this.mapId, fleet?.weather, seed, fleet?.windSpeed);
    if (!Number.isInteger(this.seed) || this.seed < 0 || this.seed > 0xffffffff) throw new Error('Battle seed must be an unsigned 32-bit integer.');
    validateSpawnDistance(this.spawnDistance);
    if (fleet && (!fleet.enemies.length || fleet.enemies.length > MAX_TEAM_SHIPS || fleet.friendlyBots.length >= MAX_TEAM_SHIPS)) throw new Error(`Choose one to ${MAX_TEAM_SHIPS} ships per team.`);
    if (fleet?.spawns) {
      validateSpawns(fleet.spawns, fleet.friendlyBots.length + 1, fleet.enemies.length, this.islands);
      this.initialSpawns = structuredClone(fleet.spawns);
    }
    this.player = this.createActor('player', definition, 'friendly', 'player');
    this.actors = [this.player];
    if (fleet) {
      for (const [team, entries] of [['friendly', fleet.friendlyBots], ['enemy', fleet.enemies]] as const) {
        entries.forEach((entry, i) => {
          const { definition: def, aiLevel } = 'definition' in entry ? entry : { definition: entry, aiLevel: DEFAULT_AI_LEVEL };
          this.actors.push(this.createActor(`${team}-${i + 1}`, def, team, 'bot', aiLevel));
        });
      }
      for (const team of ['friendly', 'enemy'] as const) this.actors.filter(actor => actor.team === team).forEach((actor, i) => Object.assign(actor.motion, this.initialSpawns?.[team][i] ?? deployment(i, team, this.spawnDistance)));
      this.target = this.actors.find(actor => actor.team === 'enemy')!;
    } else {
      this.target = this.createTarget();
      this.actors.push(this.target);
    }
    for (const actor of this.actors) this.displacement.set(actor.motion.id, matchDisplacementKg(actor.definition.hull.massKg));
  }
  get ship() { return this.player.motion; }
  /** Fraction toward the next tick, for presentation between the last two CPU poses. */
  get interpolationAlpha() { return this.accumulator / FIXED_DT; }
  /** Reset every hull while preserving actor identities used by renderer bindings. */
  reset(): void {
    for (const team of ['friendly', 'enemy'] as const) this.actors.filter(actor => actor.team === team).forEach((actor, i) => {
      Object.assign(actor, this.createActor(actor.motion.id, actor.definition, actor.team, actor.controller, actor.bot?.aiLevel));
      delete actor.targetId;
      if (this.isBattle) Object.assign(actor.motion, this.initialSpawns?.[team][i] ?? deployment(i, team, this.spawnDistance));
    });
    this.target = this.actors.find(actor => actor.team === 'enemy')!;
    if (!this.isBattle) Object.assign(this.target, this.createTarget());
    this.clearCombat(); this.tick = 0; this.accumulator = 0; this.result = 'active'; this.outcome = undefined;
  }
  private createActor(id: string, definition: ShipDefinition, team: Team, controller: FleetActor['controller'], aiLevel: ShipAiLevel = DEFAULT_AI_LEVEL): FleetActor {
    return { definition, team, controller, helm: { throttle: 0, rudder: 0 }, sea: { state: this.sea, time: 0 }, airWing: createAirWing(definition, id, team), motion: createShipState(id), mounts: definition.mounts.map(createMountState), damage: createDamage(definition),
      torpedoTubes: (definition.torpedoTubes ?? []).map(createTubeState), tubeLaunchCooldown: 0,
      torpedoLaunchers: (definition.torpedoLaunchers ?? []).map(l => ({ id: l.id, train: 0 })),
      depthChargeLaunchers: (definition.depthChargeLaunchers ?? []).map(createDepthChargeLauncherState), depthChargeCooldown: 0,
      ...(definition.submarine ? { submarine: createSubmarineState() } : {}),
      ...(controller === 'bot' ? { bot: createBotState(id, definition, this.seed, aiLevel) } : {}) };
  }
  private createTarget() {
    const target = this.createActor('target', this.definition, 'enemy', 'idle');
    target.motion.x = this.ship.x + 650; target.motion.z = this.ship.z - 550;
    return target;
  }
  private clearCombat(): void {
    this.shellSequence = 0;
    this.ammunitionSelection = { main: 'ap', secondary: 'ap', torpedo: 'ap', 'depth-charge': 'ap' };
    this.airReleases.length = 0;
    this.targetUnderway = false; this.shells.length = 0; this.torpedoes.length = 0; this.depthCharges.length = 0;
    this.events.length = 0; this.shellHistory.length = 0; this.fireQueued = false;
    this.playerDamageDealt = 0; this.playerFrags = 0;
    this.damageLog.clear();
  }
  resetTarget(): void {
    if (this.isBattle) return;
    Object.assign(this.target, this.createTarget()); this.clearCombat();
  }
  selectTarget(id: string): boolean {
    const target = this.actors.find(actor => actor.motion.id === id && actor.team === 'enemy');
    if (!target) return false;
    this.target = target; return true;
  }
  aimAt(moduleId?: string, battery: Battery = 'main', weaponGroupId?: string): Vec3 {
    return presentationAim(this, moduleId, battery, weaponGroupId);
  }
  requestFire(): void { this.fireQueued = true; }
  private eventSequence = 0;
  /** Renderer fixtures publish presentation events onto the port fixture's feed. */
  private emit = (event: Omit<CombatEvent, 'sequence' | 'tick'>): void => {
    this.events.push({ ...event, sequence: ++this.eventSequence, tick: this.tick });
    if (this.events.length > 128) this.events.shift();
  };
  /** The port fixture is never stepped: custom and online battles advance in Rust. */
  advance(_dt: number, _helm: HelmCommand, _intent: CombatIntent, _beforeStep?: () => void): void {}
  step(_helm: HelmCommand, _intent: CombatIntent): void {}
  /** Ship instruments may observe a teammate; player death and scoring remain session-owned. */
  telemetry(battery: Battery, aim: Vec3, weaponGroupId?: string, subject: FleetActor = this.player): CombatTelemetry {
    return presentationTelemetry({ ...this, ship: this.ship, aircraft: this.aircraft, ammunitionSelection: this.ammunitionSelection,
      playerDamageDealt: this.playerDamageDealt, playerFrags: this.playerFrags, damageLog: this.damageLog.snapshot(), afloatKg: afloatKg(this.survivors()) }, battery, aim, weaponGroupId, subject);
  }

}
