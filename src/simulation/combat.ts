import { airborne, createAirWing, launchSquadron, orderFlight, recallAircraft, stepAircraft, type AirRelease, type AirOrder } from './aircraft';
import { airWingTelemetry, type AirWingTelemetry } from './airTelemetry';
import { DEFAULT_MAP, mapIslands, type Island, type OceanMapId } from '../maps/catalog';
import { avoidLand, firstLandHit, resolveLandContact } from './land';
import { updateCapability, type VesselStatus } from './stability';
import { directControl, updateDamageControl, type ControlPriority, type ControlState } from './damageControl';
import type { Ammunition, Battery, ShipDefinition, Vec3 } from '../ships/blueprint';
import { advanceProjectile } from './projectile';
import { equipmentCondition, type EquipmentCondition } from './machinery';
import { equipmentIntegrity } from './durability';
import { DamageLog, type DamageLogEntry } from './damageLog';
import { createShipState, FIXED_DT, stepShip, type HelmCommand } from './ship';
import { add, clamp, length, localToWorld, scale, sub } from './geometry';
import { availableAmmunition, createMountState, GRAVITY, muzzleWorld, selectAmmunition, shotDirection, solveBallistic, updateMount } from './weapons';
import { dispersedDirection, dispersedSpeed, travelFactor, velocityPenetration } from './ballistics';
import { BATTLE_SPAWN_DISTANCE, deployment, MAX_TEAM_SHIPS, validateSpawnDistance, type BattleFleet, type BattleResult, type FleetActor, type Team } from './battle';
import { botShouldDropDepthCharge, createDepthChargeLauncherState, damageDepthCharge, launchDepthCharge, stepDepthCharge, updateDepthChargeLauncher, type DepthCharge } from './depthCharges';
import { botAim, botAmmunition, botDidFire, botGunRange, botHelm, botReadyToFire, botTarget, botTorpedoAim, clearFiringLane, createBotState, shipVelocity, updateBot } from './bots';
import { clearTorpedoLane, createTubeState, damageTorpedoHit, firstTorpedoHit, torpedoIntercept, trainTorpedoLaunchers, tubeLocalPosition, tubeSolution, type Torpedo } from './torpedoes';
import { createSubmarineState, stepSubmarine, submarinePropulsion } from './submarine';
import { resolveShipCollisions } from './collisions';
import { createDamage, systemHealth, updateFlooding, type BallisticEffectData, type DamageEvent, type Shell, type ImpactRecord, type DefeatCause } from './damage';

export interface CombatIntent { aim: Vec3; fire: boolean; battery: Battery; ammunition?: Ammunition; controlPriority?: ControlPriority; controlFocus?: string; }
export interface CombatEvent extends BallisticEffectData { sequence: number; tick: number; kind: DamageEvent['kind'] | 'shot' | 'splash' | 'torpedo-launch' | 'torpedo-hit' | 'torpedo-dud' | 'torpedo-expired' | 'aircraft-launch' | 'aircraft-recovered' | 'aircraft-lost' | 'aircraft-fire' | 'aircraft-release' | 'bomb-release' | 'depth-charge-launch' | 'depth-charge-splash' | 'depth-charge-blast' | 'depth-charge-hit'; aircraft?: { id: string; target?: Vec3 }; depthCharge?: { id: number; radiusM: number }; torpedo?: { id: number; velocity: Vec3; diameterM: number }; position: Vec3; message: string; shipId: string; hullDamage?: number; impact?: ImpactRecord; defeatCause?: DefeatCause; }
export interface ShellHistory { shellId: number; ownerId: string; tick: number; ammunition: Ammunition; impacts: ImpactRecord[]; outcome: 'flying' | 'splash' | 'passed-through' | 'expired' | 'stopped' | 'ricochet' | 'internal' | 'burst'; }
export interface CombatTelemetry {
  airWing?: AirWingTelemetry;
  airContacts?: { id: string; team: Team; x: number; z: number; heading: number; role: string; ownerId: string; flightId?: string; phase: string }[];
  battery: Battery; range: number; ready: number; total: number; targetIntegrity: number; targetWater: number;
  ammunition: Ammunition; ammunitionStock: { ap: number; he: number }; heSupported: boolean;
  targetStatus: VesselStatus; playerStatus: VesselStatus; targetList: number; targetTrim: number; targetDraftChange: number;
  playerList: number; playerTrim: number; playerDraftChange: number;
  control: ControlState; targetFires: number; controlTargets: { id: string; name: string }[];
  targetMounts: { id: string; name: string; condition: number }[];
  targetId: string; targetName: string; targetRange: number;
  targetDepthM?: number;
  contacts: { id: string; name: string; shipId: string; team: Team; controller: FleetActor['controller']; targetId?: string; x: number; z: number; heading: number; integrity: number; sunk: boolean; status: VesselStatus; combatLost: boolean }[];
  battle: boolean; result: BattleResult; playerSunk: boolean;
  targetPower: number; targetSteering: number; targetSunk: boolean; targetUnderway: boolean;
  mounts: { id: string; name: string; status: string; reload: number; ammo: number; loaded?: Ammunition }[];
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
  result: BattleResult = 'active';
  readonly shells: Shell[] = [];
  readonly torpedoes: Torpedo[] = [];
  readonly depthCharges: DepthCharge[] = [];
  readonly airReleases: AirRelease[] = [];
  get aircraft() { return this.actors.flatMap(a => a.airWing?.planes ?? []); }
  launchAircraft(squadronId: string) { return this.isBattle && this.result === 'active' ? launchSquadron(this.player, squadronId, this.target) : 0; }
  recallAircraft(flightId?: string) { if (this.isBattle && this.result === 'active') recallAircraft(this.player, flightId); }
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
  private ammunitionSelection: Record<Battery, Ammunition> = { main: 'ap', secondary: 'ap', torpedo: 'ap', 'depth-charge': 'ap' };
  private playerDamageDealt = 0;
  private playerFrags = 0;
  private damageLog = new DamageLog();
  /** Last hostile hull/breach damage earns the frag, including a later flooding loss. */
  private lastDamager = new Map<string, string>();
  private creditedLosses = new Set<string>();
  /** Without a fleet, create an idle gunnery fixture for port and isolated asset tests. */
  constructor(readonly definition: ShipDefinition, fleet?: BattleFleet, seed = fleet?.seed ?? 0x6e617661) {
    this.isBattle = !!fleet;
    this.spawnDistance = fleet?.spawnDistance ?? BATTLE_SPAWN_DISTANCE;
    this.mapId = fleet?.mapId ?? DEFAULT_MAP;
    this.islands = mapIslands(this.mapId, this.spawnDistance, Math.max(1 + (fleet?.friendlyBots.length ?? 0), fleet?.enemies.length ?? 1));
    this.seed = seed;
    if (!Number.isInteger(this.seed) || this.seed < 0 || this.seed > 0xffffffff) throw new Error('Battle seed must be an unsigned 32-bit integer.');
    validateSpawnDistance(this.spawnDistance);
    if (fleet && (!fleet.enemies.length || fleet.enemies.length > MAX_TEAM_SHIPS || fleet.friendlyBots.length >= MAX_TEAM_SHIPS)) throw new Error(`Choose one to ${MAX_TEAM_SHIPS} ships per team.`);
    this.player = this.createActor('player', definition, 'friendly', 'player');
    this.actors = [this.player];
    if (fleet) {
      fleet.friendlyBots.forEach((def, i) => this.actors.push(this.createActor(`friendly-${i + 1}`, def, 'friendly', 'bot')));
      fleet.enemies.forEach((def, i) => this.actors.push(this.createActor(`enemy-${i + 1}`, def, 'enemy', 'bot')));
      for (const team of ['friendly', 'enemy'] as const) this.actors.filter(actor => actor.team === team).forEach((actor, i) => Object.assign(actor.motion, deployment(i, team, this.spawnDistance)));
      this.target = this.actors.find(actor => actor.team === 'enemy')!;
    } else {
      this.target = this.createTarget();
      this.actors.push(this.target);
    }
  }
  get ship() { return this.player.motion; }
  /** Fraction toward the next tick, for presentation between the last two CPU poses. */
  get interpolationAlpha() { return this.accumulator / FIXED_DT; }
  /** Reset every hull while preserving actor identities used by renderer bindings. */
  reset(): void {
    for (const team of ['friendly', 'enemy'] as const) this.actors.filter(actor => actor.team === team).forEach((actor, i) => {
      Object.assign(actor, this.createActor(actor.motion.id, actor.definition, actor.team, actor.controller));
      delete actor.targetId;
      if (this.isBattle) Object.assign(actor.motion, deployment(i, team, this.spawnDistance));
    });
    this.target = this.actors.find(actor => actor.team === 'enemy')!;
    if (!this.isBattle) Object.assign(this.target, this.createTarget());
    this.clearCombat(); this.tick = 0; this.accumulator = 0; this.result = 'active';
  }
  private createActor(id: string, definition: ShipDefinition, team: Team, controller: FleetActor['controller']): FleetActor {
    return { definition, team, controller, airWing: createAirWing(definition, id, team), motion: createShipState(id), mounts: definition.mounts.map(createMountState), damage: createDamage(definition),
      torpedoTubes: (definition.torpedoTubes ?? []).map(createTubeState), tubeLaunchCooldown: 0,
      torpedoLaunchers: (definition.torpedoLaunchers ?? []).map(l => ({ id: l.id, train: 0 })),
      depthChargeLaunchers: (definition.depthChargeLaunchers ?? []).map(createDepthChargeLauncherState), depthChargeCooldown: 0,
      ...(definition.submarine ? { submarine: createSubmarineState() } : {}),
      ...(controller === 'bot' ? { bot: createBotState(id, definition, this.seed) } : {}) };
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
  aimAt(moduleId?: string, battery: Battery = 'main'): Vec3 {
    const m = this.target.definition.modules.find(m => m.id === moduleId);
    const gun = moduleId?.startsWith('mount:') ? this.target.definition.mounts.find(m => m.id === moduleId.slice(6)) : undefined;
    const aim = localToWorld(gun ? [gun.position[0], gun.position[1] + gun.weapon.gunhouseSize[2] / 2, gun.position[2]] : m ? [m.center[0], .5, m.center[2]] : [0, .5, 0], this.target.motion);
    if (battery === 'torpedo' && this.definition.torpedoTubes?.length) {
      const tube = this.definition.torpedoTubes[0];
      return torpedoIntercept(localToWorld(tubeLocalPosition(this.player, tube), this.ship), aim, shipVelocity(this.target), tube.weapon.speed) ?? aim;
    }
    const weapon = this.definition.mounts.find(m => m.battery === battery)?.weapon;
    const speed = weapon?.muzzleSpeed ?? 820, drag = weapon?.ballistics?.dragPerSecond ?? 0;
    const from: Vec3 = [this.ship.x, this.ship.y + 8, this.ship.z];
    let time = Math.hypot(aim[0] - this.ship.x, aim[2] - this.ship.z) / speed;
    for (let i = 0; i < 3; i++) {
      const solution = solveBallistic(from, sub(add(aim, scale(shipVelocity(this.target), time)), scale(shipVelocity(this.player), travelFactor(time, drag))), speed, drag);
      if (!solution) break;
      time = solution.time;
    }
    return add(aim, scale(shipVelocity(this.target), time));
  }
  requestFire(): void { this.fireQueued = true; }
  private emit = (event: Omit<CombatEvent, 'sequence' | 'tick'>): void => {
    if (event.shell) {
      const history = this.history(event.shell.id, event.kind === 'shot' ? event.shipId : undefined);
      if (event.kind === 'shot' || event.kind === 'bomb-release') history.ammunition = event.shell.ammunition ?? 'ap';
      if (event.impact) history.impacts.push(event.impact);
      if (event.impact) {
        const victim = this.actors.find(a => a.motion.id === event.shipId);
        const owner = this.actors.find(a => a.motion.id === history.ownerId);
        if (victim && owner && victim.team !== owner.team && !victim.damage.sunk && !victim.damage.stability.combatLost) {
          const dealt = event.impact.hullDamage ?? 0;
          if (dealt > 0 || (event.impact.breachAreaM2 ?? 0) > 0) this.lastDamager.set(victim.motion.id, owner.motion.id);
          if (owner === this.player) this.playerDamageDealt += dealt;
          const shell = this.shells.find(s => s.id === event.shell!.id);
          this.recordDamage(owner, victim, event.shell.id, shell?.weaponLabel ?? `${Math.round(event.shell.caliberM * 1000)} mm ${history.ammunition.toUpperCase()}`, dealt);
        }
        if (victim) updateCapability(victim, victim.definition);
      }
      if (event.kind === 'splash') history.outcome = history.impacts.length ? 'passed-through' : 'splash';
      else if (event.impact?.terminal) history.outcome = event.kind === 'stopped' || event.kind === 'ricochet' || event.kind === 'burst' ? event.kind : 'internal';
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
    this.ammunitionSelection[intent.battery] = intent.ammunition === 'he' ? 'he' : 'ap';
    const aimValid = Array.isArray(intent.aim) && intent.aim.length === 3 && intent.aim.every(n => Number.isFinite(n) && Math.abs(n) < 1e7);
    // Decide from the same pre-tick state, then move every ship before computing gun solutions.
    const targets = new Map<FleetActor, FleetActor | undefined>();
    const commands = new Map<FleetActor, HelmCommand>();
    for (const actor of this.actors) {
      updateCapability(actor, actor.definition);
      if (actor.damage.stability.combatLost) {
        delete actor.targetId;
        commands.set(actor, { throttle: 0, rudder: 0 });
        continue;
      }
      if (actor.controller === 'bot') {
        const target = botTarget(actor, this.actors);
        updateBot(actor, target, this.tick * FIXED_DT);
        actor.targetId = target?.motion.id;
        targets.set(actor, target);
        commands.set(actor, avoidLand(actor, botHelm(actor, target, this.actors), this.islands));
      } else commands.set(actor, actor === this.player ? helm : { throttle: this.targetUnderway ? .25 : 0, rudder: 0 });
    }
    for (const actor of this.actors) {
      const def = actor.definition;
      const propulsion = submarinePropulsion(actor, def);
      stepShip(actor.motion, commands.get(actor)!, propulsion?.handling ?? def.handling, propulsion?.power ?? systemHealth(actor, def, 'engine'), systemHealth(actor, def, 'steering'));
    }
    resolveShipCollisions(this.actors);
    for (const actor of this.actors) resolveLandContact(actor, this.islands);
    for (const actor of this.actors) {
      const def = actor.definition, target = targets.get(actor);
      const laneClear = target && clearFiringLane(actor, target, this.actors);
      def.mounts.forEach((m, i) => {
        const state = actor.mounts[i];
        if (actor.damage.stability.combatLost) { state.status = 'disabled'; return; }
        if (actor === this.player && m.battery === intent.battery) selectAmmunition(m, state, intent.ammunition === 'he' ? 'he' : 'ap');
        else if (actor.controller === 'bot' && target) selectAmmunition(m, state, botAmmunition(target, m, state));
        if (m.magazineId && equipmentCondition(actor, def, def.modules.find(module => module.id === m.magazineId)!).availability === 0) { state.status = 'disabled'; return; }
        if (actor === this.player && !aimValid) { state.status = 'out-of-arc'; return; }
        const inRange = target && Math.hypot(target.motion.x - actor.motion.x, target.motion.z - actor.motion.z) <= botGunRange(m);
        const aim = actor === this.player ? intent.aim : target && inRange && state.hp > 0 && availableAmmunition(state) >= (m.weapon.barrelCount ?? 2) ? botAim(actor, target, m, state) : undefined;
        const aligned = updateMount(m, state, def, actor.motion, aim, FIXED_DT, shipVelocity(actor));
        const firing = actor === this.player ? aligned && (intent.fire || this.fireQueued) && m.battery === intent.battery : actor.controller === 'bot' && inRange && laneClear && aligned && botReadyToFire(actor, m);
        const barrelCount = m.weapon.barrelCount ?? 2;
        if (!actor.damage.sunk && firing && state.status === 'ready' && this.shells.length <= 256 - barrelCount) {
          if (actor.controller === 'bot') botDidFire(actor, m);
          state.reload = m.weapon.reloadSeconds; state.ammo -= barrelCount; state.recoil = 1; state.status = 'reloading';
          if (state.loaded === 'he') state.heAmmo -= barrelCount;
          for (let barrel = 0; barrel < barrelCount; barrel++) {
            const position = muzzleWorld(m, state, barrel, actor.motion);
            const shot = this.dispersionSequence++;
            const direction = dispersedDirection(shotDirection(m, state, actor.motion), m.weapon.ballistics?.dispersionRad ?? 0, this.seed, shot);
            const speed = dispersedSpeed(m.weapon.muzzleSpeed, m.weapon.ballistics?.muzzleSpeedSigmaFraction ?? 0, this.seed, shot);
            const velocity = add(scale(direction, speed), shipVelocity(actor));
            this.shells.push({ id: ++this.shellSequence, ownerId: actor.motion.id, weaponLabel: `${Math.round(m.weapon.caliberM * 1000)} mm ${state.loaded.toUpperCase()} · ${m.battery === 'main' ? 'Main' : 'Secondary'}`, position, velocity, age: 0, penetrationMm: state.loaded === 'he' ? 0 : velocityPenetration(m.weapon.penetrationMm, m.weapon.ballistics?.penetrationReferenceSpeedMps ?? m.weapon.muzzleSpeed, length(velocity)), damage: m.weapon.damage, caliberM: m.weapon.caliberM, visited: [], ammunition: state.loaded, ap: state.loaded === 'ap' ? m.weapon.ap : undefined, he: state.loaded === 'he' ? m.weapon.he : undefined, dragPerSecond: m.weapon.ballistics?.dragPerSecond ?? 0 });
            this.emit({ kind: 'shot', position: [...position], shipId: actor.motion.id, message: `${m.name} fired`,
              shell: { id: this.shellSequence, caliberM: m.weapon.caliberM, velocity: [...velocity], ammunition: state.loaded, type: state.loaded === 'he' ? 'HE' : 'AP' } });
          }
        }
      });
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
        const fire = actor === this.player ? aimValid && intent.battery === 'torpedo' && (intent.fire || this.fireQueued) : actor.controller === 'bot' && !!target && botReadyToFire(actor);
        if (!fire || state.status !== 'ready' || this.torpedoes.length >= 128) return;
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
        if (state.status !== 'ready' || this.depthCharges.length >= 128) return;
        const fire = actor === this.player ? intent.battery === 'depth-charge' && (intent.fire || this.fireQueued) : actor.controller === 'bot' && target && botReadyToFire(actor) && botShouldDropDepthCharge(actor, target, launcher, this.actors);
        if (!fire) return;
        const charge = launchDepthCharge(actor, launcher, ++this.shellSequence);
        this.depthCharges.push(charge);
        state.ammo--; state.reload = state.ammo ? launcher.weapon.reloadSeconds : 0; state.status = state.ammo ? 'reloading' : 'empty';
        actor.depthChargeCooldown = launcher.weapon.launchIntervalSeconds;
        this.emit({ kind: 'depth-charge-launch', position: [...charge.position], shipId: actor.motion.id, message: `${launcher.name} · depth charge away`, depthCharge: { id: charge.id, radiusM: charge.weapon.blastRadiusM } });
      });
    }
    if (this.isBattle && this.result === 'active') stepAircraft({ actors: this.actors, planes: this.aircraft, shells: this.shells, torpedoes: this.torpedoes, releases: this.airReleases, nextId: () => ++this.shellSequence, emit: this.emit }, FIXED_DT, this.tick * FIXED_DT);
    this.fireQueued = false;
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const shell = this.shells[i];
      const outcome = advanceProjectile(shell, this.actors, FIXED_DT, this.emit, this.islands);
      if (outcome) {
        const history = this.history(shell.id);
        if (history.outcome === 'flying') history.outcome = outcome;
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
      updateFlooding(actor, actor.definition, FIXED_DT);
      stepSubmarine(actor, actor.definition, commands.get(actor)!, FIXED_DT);
      updateCapability(actor, actor.definition);
      if ((actor.damage.sunk || actor.damage.stability.combatLost) && !this.creditedLosses.has(actor.motion.id)) {
        this.creditedLosses.add(actor.motion.id);
        if (this.lastDamager.get(actor.motion.id) === this.player.motion.id) this.playerFrags++;
      }
      if (!wasSunk && actor.damage.sunk) this.emit({ kind: 'sunk', position: [actor.motion.x, actor.motion.y, actor.motion.z], shipId: actor.motion.id, defeatCause: actor.damage.defeatCause, message: `${actor.definition.name} sinking · ${actor.damage.defeatCause}` });
    }
    if (this.isBattle && this.result === 'active') {
      const friendly = this.actors.some(actor => actor.team === 'friendly' && !actor.damage.sunk && !actor.damage.stability.combatLost);
      const enemy = this.actors.some(actor => actor.team === 'enemy' && !actor.damage.sunk && !actor.damage.stability.combatLost);
      this.result = !friendly && !enemy ? 'draw' : !enemy ? 'victory' : !friendly ? 'defeat' : 'active';
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
        const hp = actor.damage.integrity, alreadyLost = actor.damage.sunk || actor.damage.stability.combatLost;
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
        const hp = actor.damage.integrity, alreadyLost = actor.damage.sunk || actor.damage.stability.combatLost;
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
  telemetry(battery: Battery, aim: Vec3): CombatTelemetry {
    const mounts = battery === 'depth-charge' ? (this.definition.depthChargeLaunchers ?? []).map((l, i) => {
      const s = this.player.depthChargeLaunchers![i];
      return { id: l.id, name: l.name, status: s.status, reload: Math.max(s.reload, this.player.depthChargeCooldown ?? 0), ammo: s.ammo };
    }) : battery === 'torpedo' ? (this.definition.torpedoTubes ?? []).map((tube, i) => {
      const s = this.player.torpedoTubes![i];
      return { id: tube.id, name: tube.name, status: s.status, reload: Math.max(s.reload, this.player.tubeLaunchCooldown ?? 0), ammo: s.ammo };
    }) : this.definition.mounts.filter(m => m.battery === battery).map(m => {
      const s = this.player.mounts.find(s => s.id === m.id)!;
      return { id: m.id, name: m.name, status: s.status, reload: s.reload, ammo: s.ammo, loaded: s.loaded };
    });
    const significant = [...this.events].reverse().find(e => ['module', 'sunk', 'stopped', 'ricochet', 'penetration', 'contact', 'burst', 'torpedo-launch', 'torpedo-hit', 'torpedo-dud', 'torpedo-expired', 'depth-charge-launch', 'depth-charge-blast', 'depth-charge-hit'].includes(e.kind));
    return {
      airWing: (() => { const wing = airWingTelemetry(this.player, this.actors); if (wing) wing.available &&= this.result === 'active'; return wing; })(),
      airContacts: this.aircraft.filter(airborne).map(p => ({ id: p.id, team: p.team, x: p.position[0], z: p.position[2], heading: p.heading, role: p.role, ownerId: p.ownerId, flightId: p.flightId, phase: p.phase })),
      battery, range: Math.hypot(aim[0] - this.ship.x, aim[2] - this.ship.z), ready: mounts.filter(m => m.status === 'ready').length, total: mounts.length,
      ammunition: this.ammunitionSelection[battery], heSupported: this.definition.mounts.some(m => m.battery === battery && m.weapon.he !== undefined),
      ammunitionStock: (battery === 'torpedo' || battery === 'depth-charge' ? [] : mounts).reduce((stock, m) => { const s = this.player.mounts.find(s => s.id === m.id)!; stock.ap += availableAmmunition(s, 'ap'); stock.he += availableAmmunition(s, 'he'); return stock; }, { ap: 0, he: 0 }),
      targetMounts: this.target.definition.mounts.map((m, i) => ({ id: m.id, name: m.name, condition: this.target.mounts[i].hp / 100 })),
      targetId: this.target.motion.id, targetName: this.target.definition.name,
      ...(this.target.submarine ? { targetDepthM: Math.max(0, -this.target.motion.y) } : {}),
      targetRange: Math.hypot(this.target.motion.x - this.ship.x, this.target.motion.z - this.ship.z),
      battle: this.isBattle, result: this.result, playerSunk: this.player.damage.sunk,
      contacts: this.actors.map(actor => ({ id: actor.motion.id, shipId: actor.definition.id, name: actor.definition.name, team: actor.team, controller: actor.controller,
        targetId: actor.targetId, x: actor.motion.x, z: actor.motion.z, heading: actor.motion.heading, integrity: actor.damage.integrity / actor.damage.maxIntegrity, sunk: actor.damage.sunk, status: actor.damage.stability.status, combatLost: actor.damage.stability.combatLost })),
      targetStatus: this.target.damage.stability.status, playerStatus: this.player.damage.stability.status, targetList: this.target.motion.roll * 180 / Math.PI, targetTrim: this.target.motion.pitch * 180 / Math.PI, targetDraftChange: -this.target.motion.y,
      playerList: this.ship.roll * 180 / Math.PI, playerTrim: this.ship.pitch * 180 / Math.PI, playerDraftChange: -this.ship.y,
      control: structuredClone(this.player.damage.control), targetFires: [...this.target.damage.control.rooms, ...this.target.damage.control.mounts].filter(f => f.intensity > 0).length,
      controlTargets: [...this.player.definition.compartments.map(c => ({ id: c.id, name: c.name })), ...this.player.definition.mounts.map(m => ({ id: m.id, name: m.name }))],
      targetIntegrity: this.target.damage.integrity / this.target.damage.maxIntegrity, targetWater: this.target.damage.compartments.reduce((n, c) => n + c.waterM3, 0),
      targetEquipmentIntegrity: equipmentIntegrity(this.target, this.target.definition),
      targetPower: systemHealth(this.target, this.target.definition, 'engine'), targetSteering: systemHealth(this.target, this.target.definition, 'steering'), targetSunk: this.target.damage.sunk, targetUnderway: this.targetUnderway,
      mounts, modules: this.target.definition.modules.map((m, i) => ({ id: m.id, name: m.name, condition: this.target.damage.modules[i].hp / m.hp, ...equipmentCondition(this.target, this.target.definition, m) })),
      playerIntegrity: this.player.damage.integrity / this.player.damage.maxIntegrity,
      playerMaxIntegrity: this.player.damage.maxIntegrity, playerDamageDealt: this.playerDamageDealt, playerFrags: this.playerFrags,
      damageLog: this.damageLog.snapshot(),
      playerWater: this.player.damage.compartments.reduce((n, c) => n + c.waterM3, 0),
      ...(this.player.submarine && this.definition.submarine ? { submarine: {
        depthM: Math.max(0, -this.ship.y), targetDepthM: this.player.submarine.targetDepthM,
        verticalSpeed: this.ship.verticalSpeed ?? 0, ballastM3: this.player.submarine.ballastM3,
        ballastFraction: this.player.submarine.ballastM3 / this.definition.submarine.ballastCapacityM3,
        emergencyBlow: this.player.submarine.emergencyBlow, propulsion: this.ship.y < -.5 ? 'Electric' as const : 'Diesel' as const,
        maxDepthM: this.definition.submarine.maxDepthM, periscopeDepthM: this.definition.submarine.periscopeDepthM, maxTorpedoDepthM: this.definition.submarine.maxTorpedoDepthM,
      } } : {}),
      targetDefeatCause: this.target.damage.defeatCause,
      shellHistory: this.shellHistory.filter(h => h.impacts.some(i => i.shipId === this.target.motion.id)).slice(-8).reverse().map(h => ({ ...h, impacts: h.impacts.filter(i => i.shipId === this.target.motion.id).map(i => ({ ...i, position: [...i.position] })) })),
      targetPosition: { x: this.target.motion.x, z: this.target.motion.z, heading: this.target.motion.heading },
      batteries: (['main', 'secondary', ...(this.definition.torpedoTubes?.length ? ['torpedo'] : []), ...(this.definition.depthChargeLaunchers?.length ? ['depth-charge'] : [])] as Battery[]).map(battery => {
        const states = battery === 'depth-charge' ? this.player.depthChargeLaunchers! : battery === 'torpedo' ? this.player.torpedoTubes! : this.definition.mounts.filter(m => m.battery === battery).map(m => this.player.mounts.find(s => s.id === m.id)!);
        const reloading = states.filter(m => m.reload > 0);
        return { battery, ammunition: this.ammunitionSelection[battery], ammo: states.reduce((n, m) => n + m.ammo, 0), ready: states.filter(m => m.status === 'ready').length, total: states.length,
          reload: reloading.length ? Math.min(...reloading.map(m => m.reload)) : 0 };
      }),
      message: significant ? `${this.actors.find(actor => actor.motion.id === significant.shipId)?.definition.name ?? 'Ship'} · ${significant.message}` : battery === 'depth-charge' ? 'Drop during a close pass. Charges sink before exploding; keep moving clear of the blast.' : battery === 'torpedo' ? `${this.definition.torpedoLaunchers?.length ? 'Bring a broadside toward the sight.' : 'Turn bow or stern toward the sight.'} Torpedoes keep their launch course; lead moving targets.` : 'Only aligned, loaded guns fire. Turn the ship to bring guns marked Out of arc onto the target.',
    };
  }
}
