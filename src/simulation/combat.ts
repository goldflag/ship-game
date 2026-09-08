import { presentationAim, presentationTelemetry } from './presentation';
import { BATTLE_RULES, afloatKg, evaluateOutcome, matchDisplacementKg, physicalLoss, type BattleOutcome } from './battleRules';
import { surfaceGunAllowed } from '../ships/armament';
import { equipmentCenter } from './equipmentPose';
import { weaponGroups, selectedWeapon, type WeaponGroup } from '../ships/weaponGroups';
import { airborne, onFlightDeck, commandSquadron, createAirWing, launchSquadron, orderFlight, recallAircraft, stepAircraft, type AirRelease, type AirOrder } from './aircraft';
import { airWingTelemetry, type AirWingTelemetry } from './airTelemetry';
import { operateGuns, type GunneryContext } from './gunnery';
import { DEFAULT_AI_LEVEL, type ShipAiLevel } from './aiLevels';
import { DEFAULT_MAP, mapIslands, type Island, type OceanMapId } from '../maps/catalog';
import { avoidLand, firstLandHit, resolveLandContact } from './land';
import { updateCapability, type VesselStatus } from './stability';
import { directControl, updateDamageControl, type ControlPriority, type ControlState } from './damageControl';
import type { Ammunition, Battery, ShipDefinition, Vec3 } from '../ships/blueprint';
import { advanceProjectile } from './projectile';
import { equipmentCondition, supportPerformance, type EquipmentCondition } from './machinery';
import { equipmentIntegrity } from './durability';
import { fireReadout, regionReadout, type FireReadout } from './damageReadout';
import { DamageLog, type DamageLogEntry } from './damageLog';
import { createShipState, FIXED_DT, stepShip, hullDepth, meanHullY, type HelmCommand } from './ship';
import { add, clamp, localToWorld, scale, sub } from './geometry';
import { availableAmmunition, createMountState, GRAVITY, gunWorkRate, queueAmmunition, selectAmmunition, solveBallistic } from './weapons';
import { travelFactor } from './ballistics';
import { BATTLE_SPAWN_DISTANCE, deployment, validateSpawns, type SpawnPositions, MAX_TEAM_SHIPS, validateSpawnDistance, type BattleFleet, type BattleResult, type FleetActor, type Team } from './battle';
import { botShouldDropDepthCharge, createDepthChargeLauncherState, damageDepthCharge, launchDepthCharge, stepDepthCharge, updateDepthChargeLauncher, type DepthCharge } from './depthCharges';
import { botHelm, botReadyToFire, botTarget, botTorpedoAim, createBotState, shipVelocity, updateBot } from './bots';
import { clearTorpedoLane, createTubeState, damageTorpedoHit, firstTorpedoHit, torpedoIntercept, trainTorpedoLaunchers, tubeLocalPosition, tubeSolution, type Torpedo } from './torpedoes';
import { createSubmarineState, stepSubmarine, submarinePropulsion } from './submarine';
import { resolveShipCollisions } from './collisions';
import type { HullImpact } from './contactDamage';
import { createSeaState, seaHandling, seaHeight, seaResponse, type SeaState } from './sea';
import { createDamage, systemHealth, updateFlooding, type BallisticEffectData, type DamageEvent, type Shell, type ImpactRecord, type DefeatCause } from './damage';

export interface CombatIntent { aim: Vec3; fire: boolean; battery: Battery; weaponGroupId?: string; ammunition?: Ammunition; controlPriority?: ControlPriority; controlFocus?: string; }
export interface CombatEvent extends BallisticEffectData { sequence: number; tick: number; kind: DamageEvent['kind'] | 'shot' | 'splash' | 'torpedo-launch' | 'torpedo-hit' | 'torpedo-dud' | 'torpedo-expired' | 'aircraft-launch' | 'aircraft-recovered' | 'aircraft-lost' | 'aircraft-crash' | 'aircraft-fire' | 'aircraft-release' | 'bomb-release' | 'depth-charge-launch' | 'depth-charge-splash' | 'depth-charge-blast' | 'depth-charge-hit'; aircraft?: { id: string; caliberM?: number; panic?: boolean; dragPerSecond?: number; target?: Vec3; tracerSpeed?: number; direction?: Vec3; velocity?: Vec3; airburst?: { flightTime: number; caliberM: number }; attitude?: { heading: number; pitch: number; bank: number } }; depthCharge?: { id: number; radiusM: number }; torpedo?: { id: number; velocity: Vec3; diameterM: number }; position: Vec3; message: string; shipId: string; hullDamage?: number; impact?: ImpactRecord; defeatCause?: DefeatCause; }
export interface ShellHistory { shellId: number; ownerId: string; tick: number; ammunition: Ammunition; impacts: ImpactRecord[]; outcome: 'flying' | 'splash' | 'passed-through' | 'expired' | 'stopped' | 'ricochet' | 'internal' | 'burst'; }
export interface CombatTelemetry {
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
  contacts: { id: string; name: string; shipId: string; team: Team; controller: FleetActor['controller']; targetId?: string; x: number; z: number; heading: number; integrity: number; sunk: boolean; status: VesselStatus; combatLost: boolean; physicalLost: boolean }[];
  battle: boolean; result: BattleResult; playerSunk: boolean;
  remainingSeconds: number; afloatKg: [number, number]; outcome?: BattleOutcome;
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
  private eventSequence = 0;
  private fireQueued = false;
  private dispersionSequence = 0;
  orderAmmunition(battery: Battery, type: Ammunition, immediate = false, weaponGroupId?: string): void {
    this.ammunitionSelection[weaponGroupId ?? battery] = type;
    this.definition.mounts.forEach((mount, i) => {
      if (!selectedWeapon(mount.battery, mount.weapon, battery, weaponGroupId)) return;
      const state = this.player.mounts[i];
      if (immediate && availableAmmunition(state, type) >= (mount.weapon.barrelCount ?? 2)) selectAmmunition(mount, state, type);
      else queueAmmunition(mount, state, type);
    });
  }
  private ammunitionSelection: Record<string, Ammunition> = { main: 'ap', secondary: 'ap', torpedo: 'ap', 'depth-charge': 'ap' };
  private playerDamageDealt = 0;
  private playerFrags = 0;
  private damageLog = new DamageLog();
  /** Last hostile hull/breach damage earns the frag, including a later flooding loss. */
  private initialSpawns?: SpawnPositions;
  private lastDamager = new Map<string, string>();
  private creditedLosses = new Set<string>();
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
    this.dispersionSequence = 0;
    this.ammunitionSelection = { main: 'ap', secondary: 'ap', torpedo: 'ap', 'depth-charge': 'ap' };
    this.airReleases.length = 0;
    this.targetUnderway = false; this.shells.length = 0; this.torpedoes.length = 0; this.depthCharges.length = 0;
    this.events.length = 0; this.shellHistory.length = 0; this.fireQueued = false;
    this.playerDamageDealt = 0; this.playerFrags = 0; this.lastDamager.clear(); this.creditedLosses.clear();
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
  private contactImpact = ({ actor, other, position, damage, kind }: HullImpact): void => {
    const weapon = kind === 'grounding' ? 'Grounding' : 'Ramming';
    if (other && other.team !== actor.team && !actor.damage.sunk && actor.damage.defeatCause !== 'hull-failure') {
      this.lastDamager.set(actor.motion.id, other.motion.id);
      if (other === this.player) this.playerDamageDealt += damage;
      this.recordDamage(other, actor, ++this.shellSequence, weapon, damage);
    }
    this.emit({ kind: 'contact', shipId: actor.motion.id, position, hullDamage: damage, message: `${weapon} · ${damage} hull damage` });
  };
  private emit = (event: Omit<CombatEvent, 'sequence' | 'tick'>): void => {
    if (event.shell) {
      const history = this.history(event.shell.id, event.kind === 'shot' ? event.shipId : undefined);
      if (event.kind === 'shot' || event.kind === 'bomb-release') history.ammunition = event.shell.ammunition ?? 'ap';
      if (event.impact) history.impacts.push(event.impact);
      if (event.impact) {
        const victim = this.actors.find(a => a.motion.id === event.shipId);
        const owner = this.actors.find(a => a.motion.id === history.ownerId);
        // Credit the lethal contact before updateCapability records hull failure.
        // Earlier disarmament never makes an afloat hull immune to damage credit.
        if (victim && owner && victim.team !== owner.team && !victim.damage.sunk && victim.damage.defeatCause !== 'hull-failure') {
          const dealt = event.impact.hullDamage ?? 0;
          if (dealt > 0 || (event.impact.breachAreaM2 ?? 0) > 0) this.lastDamager.set(victim.motion.id, owner.motion.id);
          if (owner === this.player) this.playerDamageDealt += dealt;
          const shell = this.shells.find(s => s.id === event.shell!.id);
          this.recordDamage(owner, victim, event.shell.id, shell?.weaponLabel ?? `${Math.round(event.shell.caliberM * 1000)} mm ${history.ammunition.toUpperCase()}`, dealt);
        }
        if (victim) updateCapability(victim, victim.definition);
      }
      if (event.impact?.terminal) history.outcome = event.kind === 'stopped' || event.kind === 'ricochet' || event.kind === 'burst' ? event.kind : 'internal';
    }
    this.events.push({ ...event, sequence: ++this.eventSequence, tick: this.tick });
    if (this.events.length > 128) this.events.shift();
  };
  private recordDamage(owner: FleetActor, victim: FleetActor, projectileId: number, weapon: string, damage: number): void {
    if (owner !== this.player && victim !== this.player) return;
    this.damageLog.record({ tick: this.tick, sourceId: owner.motion.id, targetId: victim.motion.id, projectileId, weapon, damage });
  }
  private history(shellId: number, ownerId = this.shells.find(s => s.id === shellId)?.ownerId ?? 'unknown'): ShellHistory {
    let history = this.shellHistory.find(h => h.shellId === shellId);
    if (!history) {
      history = { shellId, ownerId, tick: this.tick, ammunition: this.shells.find(s => s.id === shellId)?.ammunition ?? 'ap', impacts: [], outcome: 'flying' };
      this.shellHistory.push(history);
    }
    return history;
  }
  private pruneHistory(): void {
    const counts = new Map<string, number>();
    for (let i = this.shellHistory.length - 1; i >= 0; i--) {
      const h = this.shellHistory[i];
      if (h.outcome === 'flying') continue;
      const count = (counts.get(h.ownerId) ?? 0) + 1;
      counts.set(h.ownerId, count);
      if (count > 16) this.shellHistory.splice(i, 1);
    }
  }
  advance(dt: number, helm: HelmCommand, intent: CombatIntent, beforeStep?: () => void): void {
    this.accumulator += Number.isFinite(dt) ? clamp(dt, 0, .1) : 0;
    while (this.accumulator + 1e-10 >= FIXED_DT) {
      beforeStep?.();
      this.step(helm, intent);
      this.accumulator = Math.max(0, this.accumulator - FIXED_DT);
    }
  }
  /** Host/server calls one fixed tick with input intent. All hit outcomes are computed here. */
  step(helm: HelmCommand, intent: CombatIntent): void {
    if (this.isBattle && this.outcome) return;
    this.ammunitionSelection[intent.weaponGroupId ?? intent.battery] = intent.ammunition === 'he' ? 'he' : 'ap';
    const aimValid = Array.isArray(intent.aim) && intent.aim.length === 3 && intent.aim.every(n => Number.isFinite(n) && Math.abs(n) < 1e7);
    // Decide from the same pre-tick state, then move every ship before computing gun solutions.
    const targets = new Map<FleetActor, FleetActor | undefined>();
    const commands = new Map<FleetActor, HelmCommand>();
    for (const actor of this.actors) {
      actor.sea = { state: this.sea, time: this.tick * FIXED_DT };
      updateCapability(actor, actor.definition);
      if (physicalLoss(actor)) {
        delete actor.targetId;
        commands.set(actor, { throttle: 0, rudder: 0 });
        continue;
      }
      if (actor.controller === 'bot') {
        const target = botTarget(actor, this.actors);
        updateBot(actor, target, this.tick * FIXED_DT);
        actor.targetId = target?.motion.id;
        targets.set(actor, target);
        const command = botHelm(actor, target, this.actors);
        commands.set(actor, actor.bot!.aiLevel === 'static' ? command : avoidLand(actor, command, this.islands));
      } else commands.set(actor, actor === this.player ? helm : { throttle: this.targetUnderway ? .25 : 0, rudder: 0 });
    }
    for (const actor of this.actors) {
      const def = actor.definition;
      const propulsion = submarinePropulsion(actor, def);
      actor.helm = { ...commands.get(actor)! };
      stepShip(actor.motion, actor.helm, propulsion?.handling ?? def.handling, propulsion?.power ?? systemHealth(actor, def, 'engine'), systemHealth(actor, def, 'steering'), this.sea.windMps ? seaHandling(actor, this.sea) : undefined);
    }
    resolveShipCollisions(this.actors, this.contactImpact);
    for (const actor of this.actors) resolveLandContact(actor, this.islands, this.contactImpact);
    const airContext = { seed: this.seed, actors: this.actors, planes: this.aircraft, shells: this.shells, torpedoes: this.torpedoes,
      releases: this.airReleases, nextId: () => ++this.shellSequence, emit: this.emit };
    const gunnery: GunneryContext = { ...airContext, dt: FIXED_DT, nextDispersion: () => this.dispersionSequence++,
      airborne: this.isBattle && this.result === 'active' ? airContext.planes.filter(p => airborne(p) && !onFlightDeck(p)) : undefined };
    for (const actor of this.actors) {
      const def = actor.definition, target = targets.get(actor);
      operateGuns(actor, gunnery, target, actor === this.player ? { battery: intent.battery, weaponGroupId: intent.weaponGroupId,
        aim: aimValid ? intent.aim : undefined, fire: intent.fire || this.fireQueued, ammunition: this.ammunitionSelection } : undefined);
      actor.tubeLaunchCooldown = Math.max(0, (actor.tubeLaunchCooldown ?? 0) - FIXED_DT);
      const torpedoAim = (tube: NonNullable<ShipDefinition['torpedoTubes']>[number]) => actor === this.player ? (aimValid ? intent.aim : null) : target ? botTorpedoAim(actor, tube) : null;
      trainTorpedoLaunchers(actor, torpedoAim, FIXED_DT);
      (def.torpedoTubes ?? []).forEach((tube, i) => {
        const state = actor.torpedoTubes![i];
        const aim = torpedoAim(tube);
        const solution = tubeSolution(actor, tube, state, aim ?? [NaN, 0, NaN], FIXED_DT);
        const origin = solution.origin;
        if (state.status === 'ready' && actor.tubeLaunchCooldown! > 0) state.status = 'reloading';
        if (state.status === 'ready' && actor.controller === 'bot' && aim && !clearTorpedoLane(actor, origin, aim, tube.weapon.speed, this.actors)) state.status = 'blocked';
        const fire = actor === this.player ? aimValid && selectedWeapon('torpedo', tube.weapon, intent.battery, intent.weaponGroupId) && (intent.fire || this.fireQueued) : actor.controller === 'bot' && !!target && botReadyToFire(actor);
        if (!fire || state.status !== 'ready') return;
        const velocity: Vec3 = [Math.sin(solution.heading) * tube.weapon.speed, 0, -Math.cos(solution.heading) * tube.weapon.speed];
        const torpedo: Torpedo = { id: ++this.shellSequence, ownerId: actor.motion.id, tubeId: tube.id, position: origin, velocity, age: 0, distance: 0, weapon: tube.weapon };
        this.torpedoes.push(torpedo);
        state.ammo--; state.reload = state.ammo ? tube.weapon.reloadSeconds : 0; state.status = state.ammo ? 'reloading' : 'empty';
        actor.tubeLaunchCooldown = tube.weapon.launchIntervalSeconds;
        this.emit({ kind: 'torpedo-launch', position: [...origin], shipId: actor.motion.id, message: `${tube.name} · torpedo away`, torpedo: { id: torpedo.id, velocity: [...velocity], diameterM: tube.weapon.diameterM } });
      });
      actor.depthChargeCooldown = Math.max(0, (actor.depthChargeCooldown ?? 0) - FIXED_DT);
      (def.depthChargeLaunchers ?? []).forEach((launcher, i) => {
        const state = actor.depthChargeLaunchers![i];
        updateDepthChargeLauncher(actor, launcher, state, FIXED_DT);
        if (state.status !== 'ready') return;
        const fire = actor === this.player ? selectedWeapon('depth-charge', launcher.weapon, intent.battery, intent.weaponGroupId) && (intent.fire || this.fireQueued) : actor.controller === 'bot' && target && botReadyToFire(actor) && botShouldDropDepthCharge(actor, target, launcher, this.actors);
        if (!fire) return;
        const charge = launchDepthCharge(actor, launcher, ++this.shellSequence);
        this.depthCharges.push(charge);
        state.ammo--; state.reload = state.ammo ? launcher.weapon.reloadSeconds : 0; state.status = state.ammo ? 'reloading' : 'empty';
        actor.depthChargeCooldown = launcher.weapon.launchIntervalSeconds;
        this.emit({ kind: 'depth-charge-launch', position: [...charge.position], shipId: actor.motion.id, message: `${launcher.name} · depth charge away`, depthCharge: { id: charge.id, radiusM: charge.weapon.blastRadiusM } });
      });
    }
    if (this.isBattle && this.result === 'active') stepAircraft(airContext, FIXED_DT, this.tick * FIXED_DT);
    this.fireQueued = false;
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const shell = this.shells[i];
      const outcome = advanceProjectile(shell, this.actors, FIXED_DT, this.emit, this.islands, (x, z) => seaHeight(this.sea, x, z, this.tick * FIXED_DT));
      if (outcome) {
        const history = this.history(shell.id);
        if (history.outcome === 'flying') history.outcome = (outcome === 'splash' || outcome === 'passed-through') && history.impacts.at(-1)?.outcome === 'ricochet' ? 'ricochet' : outcome;
        this.shells.splice(i, 1);
      }
    }
    this.pruneHistory();
    this.stepTorpedoes();
    this.stepDepthCharges();
    for (const actor of this.actors) {
      if (actor === this.player && intent.controlPriority) directControl(actor, intent.controlPriority, intent.controlFocus ?? '');
      updateDamageControl(actor, actor.definition, FIXED_DT, event => this.emit(event));
      const wasSunk = actor.damage.sunk;
      const wave = this.sea.amplitudeM || Math.abs(actor.motion.yawRate * actor.motion.speed) > 1e-6 ? seaResponse(actor, this.sea, this.tick * FIXED_DT) : undefined;
      updateFlooding(actor, actor.definition, FIXED_DT, wave,
        this.sea.amplitudeM ? (x, z) => seaHeight(this.sea, x, z, this.tick * FIXED_DT) : undefined);
      stepSubmarine(actor, actor.definition, commands.get(actor)!, FIXED_DT, wave?.heave ?? 0);
      updateCapability(actor, actor.definition);
      if (physicalLoss(actor) && !this.creditedLosses.has(actor.motion.id)) {
        this.creditedLosses.add(actor.motion.id);
        if (this.lastDamager.get(actor.motion.id) === this.player.motion.id) this.playerFrags++;
      }
      if (!wasSunk && actor.damage.sunk) this.emit({ kind: 'sunk', position: [actor.motion.x, actor.motion.y, actor.motion.z], shipId: actor.motion.id, defeatCause: actor.damage.defeatCause, message: `${actor.definition.name} sinking · ${actor.damage.defeatCause}` });
    }
    if (this.isBattle && !this.outcome) {
      this.outcome = evaluateOutcome(this.tick + 1, this.survivors());
      if (this.outcome) this.result = this.outcome.winnerTeamId === null ? 'draw' : this.outcome.winnerTeamId === 'a' ? 'victory' : 'defeat';
    }
    this.tick++;
  }
  private stepTorpedoes(): void {
    for (let i = this.torpedoes.length - 1; i >= 0; i--) {
      const torpedo = this.torpedoes[i], from: Vec3 = [...torpedo.position], w = torpedo.weapon;
      const travel = Math.min(w.speed * FIXED_DT, w.rangeM - torpedo.distance);
      const to = add(from, scale(torpedo.velocity, travel / w.speed));
      // A simple depth keeper settles from the tube datum onto the selected fixed run depth.
      if (from[1] > 0) {
        to[1] = Math.max(-w.runningDepthM, from[1] + torpedo.velocity[1] * FIXED_DT - .5 * GRAVITY * FIXED_DT ** 2);
        torpedo.velocity[1] = to[1] > 0 ? torpedo.velocity[1] - GRAVITY * FIXED_DT : 0;
      } else to[1] += clamp(-w.runningDepthM - to[1], -.6 * FIXED_DT, .6 * FIXED_DT);
      const hit = firstTorpedoHit(torpedo, from, to, this.actors);
      torpedo.age += FIXED_DT;
      const evidence = { id: torpedo.id, velocity: [...torpedo.velocity] as Vec3, diameterM: w.diameterM };
      const land = firstLandHit(this.islands, from, to);
      if (land && (!hit || land.t < hit.t)) {
        this.emit({ kind: 'torpedo-expired', position: land.point, shipId: torpedo.ownerId, message: 'Torpedo struck the coast', torpedo: evidence });
        this.torpedoes.splice(i, 1);
        continue;
      }
      if (hit) {
        const { actor, point } = hit, armed = torpedo.distance + travel * hit.t >= w.armingDistanceM;
        const hp = actor.damage.integrity, alreadyLost = !!physicalLoss(actor);
        const message = armed ? damageTorpedoHit(torpedo, actor, point) : 'Torpedo dud · impact before arming';
        if (armed) updateCapability(actor, actor.definition);
        const owner = this.actors.find(a => a.motion.id === torpedo.ownerId);
        if (armed && !alreadyLost && owner && owner.team !== actor.team) {
          if (owner === this.player) this.playerDamageDealt += Math.max(0, hp - actor.damage.integrity);
          this.recordDamage(owner, actor, torpedo.id, `${w.name}${torpedo.tubeId === 'aircraft.payload' ? ' · Air torpedo' : ' · Torpedo'}`, Math.max(0, hp - actor.damage.integrity));
          this.lastDamager.set(actor.motion.id, owner.motion.id);
        }
        this.emit({ kind: armed ? 'torpedo-hit' : 'torpedo-dud', position: localToWorld(point, actor.motion), shipId: actor.motion.id, message, hullDamage: Math.max(0, hp - actor.damage.integrity), torpedo: evidence });
      }
      torpedo.position = to; torpedo.distance += travel;
      if (!hit && torpedo.distance >= w.rangeM - 1e-6) this.emit({ kind: 'torpedo-expired', position: [...to], shipId: torpedo.ownerId, message: 'Torpedo reached maximum range', torpedo: evidence });
      if (hit || torpedo.distance >= w.rangeM - 1e-6) this.torpedoes.splice(i, 1);
    }
  }
  private stepDepthCharges(): void {
    for (let i = this.depthCharges.length - 1; i >= 0; i--) {
      const charge = this.depthCharges[i], result = stepDepthCharge(charge, FIXED_DT);
      const evidence = { id: charge.id, radiusM: charge.weapon.blastRadiusM };
      if (result.splash) this.emit({ kind: 'depth-charge-splash', position: result.splash, shipId: charge.ownerId, message: 'Depth charge entering water', depthCharge: evidence });
      if (!result.detonated) continue;
      this.emit({ kind: 'depth-charge-blast', position: [...charge.position], shipId: charge.ownerId, message: `Depth charge detonated at ${charge.weapon.detonationDepthM} m`, depthCharge: evidence });
      const owner = this.actors.find(a => a.motion.id === charge.ownerId);
      for (const actor of this.actors) {
        const hp = actor.damage.integrity, alreadyLost = !!physicalLoss(actor);
        const message = damageDepthCharge(charge, actor);
        if (!message) continue;
        updateCapability(actor, actor.definition);
        if (!alreadyLost && owner && owner.team !== actor.team) {
          if (owner === this.player) this.playerDamageDealt += Math.max(0, hp - actor.damage.integrity);
          this.recordDamage(owner, actor, charge.id, `${charge.weapon.name} · Depth charge`, Math.max(0, hp - actor.damage.integrity));
          this.lastDamager.set(actor.motion.id, owner.motion.id);
        }
        this.emit({ kind: 'depth-charge-hit', position: [...charge.position], shipId: actor.motion.id, message, hullDamage: Math.max(0, hp - actor.damage.integrity), depthCharge: evidence });
      }
      this.depthCharges.splice(i, 1);
    }
  }
  /** Ship instruments may observe a teammate; player death and scoring remain session-owned. */
  telemetry(battery: Battery, aim: Vec3, weaponGroupId?: string, subject: FleetActor = this.player): CombatTelemetry {
    return presentationTelemetry({ ...this, ship: this.ship, aircraft: this.aircraft, ammunitionSelection: this.ammunitionSelection,
      playerDamageDealt: this.playerDamageDealt, playerFrags: this.playerFrags, damageLog: this.damageLog.snapshot(), afloatKg: afloatKg(this.survivors()) }, battery, aim, weaponGroupId, subject);
  }

}
