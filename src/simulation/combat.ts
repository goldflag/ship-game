import { presentationAim, presentationTelemetry, type CombatIntent, type CombatTelemetry } from '../game/session/telemetry';
/** Declared with the seam now (`src/game/session/telemetry.ts`). */
export type { CombatIntent, CombatTelemetry, FullCombatTelemetry } from '../game/session/telemetry';
export { hasFullTarget } from '../game/session/telemetry';
import type { CombatEvent, ShellHistory } from '../game/session/elements';
export type { CombatEvent, ShellHistory } from '../game/session/elements';
import { afloatKg, matchDisplacementKg, physicalLoss, type BattleOutcome } from '../game/session/battleRules';
import { selectedWeapon } from '../ships/weaponGroups';
import { commandSquadron, createAirWing, launchSquadron, orderFlight, recallAircraft, type AirRelease, type AirOrder } from './aircraft';
import { DEFAULT_AI_LEVEL, type ShipAiLevel } from '../game/session/aiLevels';
import { DEFAULT_MAP, customTerrainOffset, placedMapTerrain, type OceanMapId } from '../maps/catalog';
import { OPEN_SEA, type PlacedTerrain } from '../maps/heightfield';
import type { FleetActor as SessionActor, Shell as SessionShell, Torpedo as SessionTorpedo, DepthCharge as SessionDepthCharge, AirRelease as SessionAirRelease } from '../game/session/elements';
import type { Ammunition, Battery, ShipDefinition, Vec3 } from '../ships/blueprint';
import type { BattleResult } from '../game/session/BattleSession';
import { createShipState, FIXED_DT, type HelmCommand } from '../game/session/motion';
import { availableAmmunition, createMountState, queueAmmunition, selectAmmunition, type MountState } from './weapons';
import { BATTLE_SPAWN_DISTANCE, deployment, validateSpawns, type SpawnPositions, MAX_TEAM_SHIPS, validateSpawnDistance, type BattleFleet, type FleetActor, type Team } from './battle';
import { createDepthChargeLauncherState, type DepthCharge } from './depthCharges';
import { createBotState } from './bots';
import { createTubeState, type Torpedo } from '../game/torpedoAim';
import { createSubmarineState } from './submarine';
import { createSeaState, type SeaState } from '../game/session/sea';
import { createDamage, type Shell } from './damage';

export class CombatSimulation {
  // The fixture publishes the frame's element shapes; its own hulls are supersets.
  readonly player: SessionActor;
  target: SessionActor;
  readonly actors: SessionActor[];
  readonly isBattle: boolean;
  readonly spawnDistance: number;
  readonly mapId: OceanMapId;
  /** The land it checks spawns against: whatever chart has loaded, or open sea. */
  readonly terrain: PlacedTerrain;
  readonly seed: number;
  readonly sea: SeaState;
  result: BattleResult = 'active';
  outcome?: BattleOutcome;
  private readonly displacement = new Map<string, number>();
  private survivors() { return this.actors.map(a => ({ team: a.team === 'friendly' ? 'a' as const : 'b' as const, displacementKg: this.displacement.get(a.motion.id)!, physicalLoss: physicalLoss(a) })); }
  readonly shells: SessionShell[] = [];
  readonly torpedoes: SessionTorpedo[] = [];
  readonly depthCharges: SessionDepthCharge[] = [];
  readonly airReleases: SessionAirRelease[] = [];
  get aircraft() { return this.actors.flatMap(a => a.airWing?.planes ?? []); }
  launchAircraft(squadronId: string) { return this.isBattle && this.result === 'active' ? launchSquadron(this.player as FleetActor, squadronId, this.target as FleetActor) : 0; }
  recallAircraft(flightId?: string) { if (this.isBattle && this.result === 'active') recallAircraft(this.player as FleetActor, flightId); }
  commandSquadron(id: string, order: AirOrder) { return this.isBattle && this.result === 'active' && commandSquadron(this.player as FleetActor, id, order, this.actors as FleetActor[]); }
  orderFlight(flightId: string, order: AirOrder) { return this.isBattle && this.result === 'active' && orderFlight(this.player as FleetActor, flightId, order, this.actors as FleetActor[]); }
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
      const state = this.player.mounts[i] as MountState;
      if (immediate && availableAmmunition(state, type) >= mount.weapon.barrelCount) selectAmmunition(mount, state, type);
      else queueAmmunition(mount, state, type);
    });
  }
  private ammunitionSelection: Record<string, Ammunition> = { main: 'ap', secondary: 'ap', torpedo: 'ap', 'depth-charge': 'ap' };
  private playerDamageDealt = 0;
  private playerFrags = 0;
  private initialSpawns?: SpawnPositions;
  /** Without a fleet, create an idle gunnery fixture for port and isolated asset tests. */
  constructor(readonly definition: ShipDefinition, fleet?: BattleFleet, seed = fleet?.seed ?? 0x6e617661) {
    this.isBattle = !!fleet;
    this.spawnDistance = fleet?.spawnDistance ?? BATTLE_SPAWN_DISTANCE;
    this.mapId = fleet?.mapId ?? DEFAULT_MAP;
    this.terrain = placedMapTerrain(this.mapId, customTerrainOffset(this.spawnDistance)) ?? OPEN_SEA;
    this.seed = seed;
    this.sea = createSeaState(this.mapId, fleet?.weather, seed, fleet?.windSpeed);
    if (!Number.isInteger(this.seed) || this.seed < 0 || this.seed > 0xffffffff) throw new Error('Battle seed must be an unsigned 32-bit integer.');
    validateSpawnDistance(this.spawnDistance);
    if (fleet && (!fleet.enemies.length || fleet.enemies.length > MAX_TEAM_SHIPS || fleet.friendlyBots.length >= MAX_TEAM_SHIPS)) throw new Error(`Choose one to ${MAX_TEAM_SHIPS} ships per team.`);
    if (fleet?.spawns) {
      validateSpawns(fleet.spawns, fleet.friendlyBots.length + 1, fleet.enemies.length, this.terrain);
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
    return { definition, presetId: definition.id, team, controller, helm: { throttle: 0, rudder: 0 }, sea: { state: this.sea, time: 0 }, airWing: createAirWing(definition, id, team), motion: createShipState(id), mounts: definition.mounts.map(createMountState), damage: createDamage(definition),
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
  telemetry(battery: Battery, aim: Vec3, weaponGroupId?: string, subject: SessionActor = this.player): CombatTelemetry {
    return presentationTelemetry({ ...this, ship: this.ship, aircraft: this.aircraft, ammunitionSelection: this.ammunitionSelection,
      playerDamageDealt: this.playerDamageDealt, playerArmorBlocked: 0, playerFrags: this.playerFrags, damageLog: [], afloatKg: afloatKg(this.survivors()) }, battery, aim, weaponGroupId, subject);
  }

}
