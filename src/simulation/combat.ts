import { insideHull as containsHull } from './structure';
import type { Battery, ShipDefinition, Vec3 } from '../ships/blueprint';
import { createShipState, FIXED_DT, stepShip, type HelmCommand } from './ship';
import { add, clamp, localToWorld, scale, segmentBox, sub, worldToLocal } from './geometry';
import { createMountState, GRAVITY, muzzleWorld, shotDirection, updateMount } from './weapons';
import { BATTLE_SPAWN_DISTANCE, deployment, MAX_TEAM_SHIPS, validateSpawnDistance, type BattleFleet, type BattleResult, type FleetActor, type Team } from './battle';
import { botAim, botGunRange, botHelm, botTarget, clearFiringLane, shipVelocity } from './bots';
import { createDamage, hitShip, systemHealth, updateFlooding, type BallisticEffectData, type DamageEvent, type Shell } from './damage';
import { resolveShipCollisions } from './collisions';
import { mayReachHull, shellHullRadius } from './spatial';

export interface CombatIntent { aim: Vec3; fire: boolean; battery: Battery; }
export interface CombatEvent extends BallisticEffectData { sequence: number; tick: number; kind: DamageEvent['kind'] | 'shot' | 'splash'; position: Vec3; message: string; shipId: string; }
export interface CombatTelemetry {
  battery: Battery; range: number; ready: number; total: number; targetIntegrity: number; targetWater: number;
  targetId: string; targetName: string; targetRange: number;
  contacts: { id: string; name: string; shipId: string; team: Team; controller: FleetActor['controller']; targetId?: string; x: number; z: number; heading: number; integrity: number; sunk: boolean }[];
  battle: boolean; result: BattleResult; playerSunk: boolean;
  targetPower: number; targetSteering: number; targetSunk: boolean; targetUnderway: boolean;
  mounts: { id: string; name: string; status: string; reload: number; ammo: number }[];
  modules: { id: string; name: string; condition: number }[]; message: string;
  playerIntegrity: number;
  playerWater: number;
  playerDamageDealt: number;
  playerFrags: number;
  targetPosition: { x: number; z: number; heading: number };
  batteries: { battery: Battery; ammo: number; ready: number; total: number; reload: number }[];
}
export class CombatSimulation {
  readonly player: FleetActor;
  target: FleetActor;
  readonly actors: FleetActor[];
  readonly isBattle: boolean;
  readonly spawnDistance: number;
  result: BattleResult = 'active';
  readonly shells: Shell[] = [];
  readonly events: CombatEvent[] = [];
  targetUnderway = false;
  tick = 0;
  private accumulator = 0;
  private shellSequence = 0;
  private eventSequence = 0;
  private fireQueued = false;
  private playerDamageDealt = 0;
  private playerFrags = 0;
  /** Last hostile hull/breach damage earns the frag, including a later flooding loss. */
  private lastDamager = new Map<string, string>();
  /** Without a fleet, create an idle gunnery fixture for port and isolated asset tests. */
  constructor(readonly definition: ShipDefinition, fleet?: BattleFleet) {
    this.isBattle = !!fleet;
    this.spawnDistance = fleet?.spawnDistance ?? BATTLE_SPAWN_DISTANCE;
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
    return { definition, team, controller, motion: createShipState(id), mounts: definition.mounts.map(createMountState), damage: createDamage(definition) };
  }
  private createTarget() {
    const target = this.createActor('target', this.definition, 'enemy', 'idle');
    target.motion.x = this.ship.x + 650; target.motion.z = this.ship.z - 550;
    return target;
  }
  private clearCombat(): void {
    this.targetUnderway = false; this.shells.length = 0;
    this.events.length = 0; this.fireQueued = false;
    this.playerDamageDealt = 0; this.playerFrags = 0; this.lastDamager.clear();
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
    const aim = localToWorld(m ? [m.center[0], .5, m.center[2]] : [0, .5, 0], this.target.motion);
    const speed = this.definition.mounts.find(m => m.battery === battery)?.weapon.muzzleSpeed ?? 820;
    const time = Math.hypot(aim[0] - this.ship.x, aim[2] - this.ship.z) / speed;
    return add(aim, scale(shipVelocity(this.target), time));
  }
  requestFire(): void { this.fireQueued = true; }
  private emit = (event: Omit<CombatEvent, 'sequence' | 'tick'>): void => {
    this.events.push({ ...event, sequence: ++this.eventSequence, tick: this.tick });
    if (this.events.length > 128) this.events.shift();
  };
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
    const aimValid = Array.isArray(intent.aim) && intent.aim.length === 3 && intent.aim.every(n => Number.isFinite(n) && Math.abs(n) < 1e7);
    // Decide from the same pre-tick state, then move every ship before computing gun solutions.
    const targets = new Map<FleetActor, FleetActor | undefined>();
    const commands = new Map<FleetActor, HelmCommand>();
    for (const actor of this.actors) {
      if (actor.controller === 'bot') {
        const target = botTarget(actor, this.actors);
        actor.targetId = target?.motion.id;
        targets.set(actor, target);
        commands.set(actor, botHelm(actor, target, this.actors));
      } else commands.set(actor, actor === this.player ? helm : { throttle: this.targetUnderway ? .25 : 0, rudder: 0 });
    }
    for (const actor of this.actors) {
      const def = actor.definition;
      stepShip(actor.motion, commands.get(actor)!, def.handling, systemHealth(actor, def, 'engine'), systemHealth(actor, def, 'steering'));
    }
    resolveShipCollisions(this.actors);
    for (const actor of this.actors) {
      const def = actor.definition, target = targets.get(actor);
      const laneClear = target && clearFiringLane(actor, target, this.actors);
      def.mounts.forEach((m, i) => {
        const state = actor.mounts[i];
        if (m.magazineId && actor.damage.modules.find(module => module.id === m.magazineId)?.hp === 0) { state.status = 'disabled'; return; }
        if (actor === this.player && !aimValid) { state.status = 'out-of-arc'; return; }
        const aim = actor === this.player ? intent.aim : target ? botAim(actor, target, m, state) : localToWorld([0, .5, -5000], actor.motion);
        const aligned = updateMount(m, state, def, actor.motion, aim, FIXED_DT, shipVelocity(actor));
        const inRange = target && Math.hypot(target.motion.x - actor.motion.x, target.motion.z - actor.motion.z) <= botGunRange(m);
        const firing = aligned && (actor === this.player ? (intent.fire || this.fireQueued) && m.battery === intent.battery : actor.controller === 'bot' && inRange && laneClear);
        const barrelCount = m.weapon.barrelCount ?? 2;
        if (!actor.damage.sunk && firing && state.status === 'ready' && this.shells.length <= 256 - barrelCount) {
          state.reload = m.weapon.reloadSeconds; state.ammo -= barrelCount; state.recoil = 1; state.status = 'reloading';
          for (let barrel = 0; barrel < barrelCount; barrel++) {
            const position = muzzleWorld(m, state, barrel, actor.motion);
            const velocity = add(scale(shotDirection(m, state, actor.motion), m.weapon.muzzleSpeed), shipVelocity(actor));
            this.shells.push({ id: ++this.shellSequence, ownerId: actor.motion.id, position, velocity, age: 0, penetrationMm: m.weapon.penetrationMm, damage: m.weapon.damage, caliberM: m.weapon.caliberM, visited: [] });
            this.emit({ kind: 'shot', position: [...position], shipId: actor.motion.id, message: `${m.name} fired`,
              shell: { id: this.shellSequence, caliberM: m.weapon.caliberM, velocity: [...velocity] } });
          }
        }
      });
    }
    this.fireQueued = false;
    const hullCandidates = this.shells.length ? this.actors.filter(actor => actor.motion.y > -40).map(actor => ({ actor, radius: shellHullRadius(actor.definition) })) : [];
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const shell = this.shells[i];
      const from: Vec3 = [...shell.position];
      // Constant-acceleration integration preserves the analytical aim solution.
      const to = add(from, add(scale(shell.velocity, FIXED_DT), [0, -.5 * GRAVITY * FIXED_DT * FIXED_DT, 0]));
      shell.velocity[1] -= GRAVITY * FIXED_DT; shell.age += FIXED_DT;
      let ended = false;
      // Bound each swept segment to the first sea contact, so submerged modules can't
      // be hit by shells that already splashed down outside the hull.
      const insideHull = (point: Vec3) => this.actors.some(actor => actor.motion.id !== shell.ownerId && containsHull(worldToLocal(point, actor.motion), actor.definition));
      const seaPoint = from[1] > 0 && to[1] <= 0 ? add(from, scale(sub(to, from), from[1] / (from[1] - to[1]))) : to;
      const crossingSea = from[1] > 0 && to[1] <= 0 && !insideHull(seaPoint);
      const end = crossingSea ? add(from, scale(sub(to, from), from[1] / (from[1] - to[1]))) : to;
      const candidates = hullCandidates.filter(({ actor, radius }) => actor.motion.id !== shell.ownerId && mayReachHull(from, end, actor.motion, radius)).map(({ actor }) => {
        const def = actor.definition;
        const hit = segmentBox(worldToLocal(from, actor.motion), worldToLocal(end, actor.motion), { center: [0, 10, 0], size: [def.hull.beam + 30, 60, def.hull.length + 40] });
        return { actor, hit };
      }).filter(c => c.hit).sort((a, b) => a.hit!.t - b.hit!.t);
      for (const { actor } of candidates) {
        const hp = actor.damage.integrity;
        const breaches = actor.damage.compartments.reduce((sum, c) => sum + c.breachAreaM2, 0);
        const stopped = hitShip(shell, from, end, actor, actor.definition, this.emit);
        const owner = this.actors.find(a => a.motion.id === shell.ownerId);
        if (!actor.damage.sunk && hp > 0 && owner && owner.team !== actor.team) {
          const lost = Math.max(0, hp - actor.damage.integrity);
          if (owner === this.player) this.playerDamageDealt += lost;
          if (lost > 0 || actor.damage.compartments.reduce((sum, c) => sum + c.breachAreaM2, 0) > breaches) {
            this.lastDamager.set(actor.motion.id, owner.motion.id);
          }
        }
        if (stopped) { ended = true; break; }
      }
      if (!ended && (crossingSea || (to[1] < 0 && !insideHull(to)))) {
        this.emit({ kind: 'splash', position: [end[0], 0, end[2]], shipId: '', message: 'Shell splash',
          shell: { id: shell.id, caliberM: shell.caliberM, velocity: [...shell.velocity] } }); ended = true;
      }
      shell.position = to;
      if (ended || shell.age > 60) this.shells.splice(i, 1);
    }
    for (const actor of this.actors) {
      const wasSunk = actor.damage.sunk;
      updateFlooding(actor, actor.definition, FIXED_DT);
      if (!wasSunk && actor.damage.sunk) {
        if (actor.team !== this.player.team && this.lastDamager.get(actor.motion.id) === this.player.motion.id) this.playerFrags++;
        this.emit({ kind: 'sunk', position: [actor.motion.x, actor.motion.y, actor.motion.z], shipId: actor.motion.id, message: `${actor.definition.name} sinking` });
      }
    }
    if (this.isBattle && this.result === 'active') {
      const friendly = this.actors.some(actor => actor.team === 'friendly' && !actor.damage.sunk);
      const enemy = this.actors.some(actor => actor.team === 'enemy' && !actor.damage.sunk);
      this.result = !friendly && !enemy ? 'draw' : !enemy ? 'victory' : !friendly ? 'defeat' : 'active';
    }
    this.tick++;
  }
  telemetry(battery: Battery, aim: Vec3): CombatTelemetry {
    const mounts = this.definition.mounts.filter(m => m.battery === battery).map(m => {
      const s = this.player.mounts.find(s => s.id === m.id)!;
      return { id: m.id, name: m.name, status: s.status, reload: s.reload, ammo: s.ammo };
    });
    const significant = [...this.events].reverse().find(e => ['module', 'sunk', 'stopped', 'ricochet', 'penetration'].includes(e.kind));
    return { battery, range: Math.hypot(aim[0] - this.ship.x, aim[2] - this.ship.z), ready: mounts.filter(m => m.status === 'ready').length, total: mounts.length,
      targetId: this.target.motion.id, targetName: this.target.definition.name,
      targetRange: Math.hypot(this.target.motion.x - this.ship.x, this.target.motion.z - this.ship.z),
      battle: this.isBattle, result: this.result, playerSunk: this.player.damage.sunk,
      contacts: this.actors.map(actor => ({ id: actor.motion.id, shipId: actor.definition.id, name: actor.definition.name, team: actor.team, controller: actor.controller,
        targetId: actor.targetId, x: actor.motion.x, z: actor.motion.z, heading: actor.motion.heading, integrity: actor.damage.integrity / 1000, sunk: actor.damage.sunk })),
      targetIntegrity: this.target.damage.integrity / 1000, targetWater: this.target.damage.compartments.reduce((n, c) => n + c.waterM3, 0),
      targetPower: systemHealth(this.target, this.target.definition, 'engine'), targetSteering: systemHealth(this.target, this.target.definition, 'steering'), targetSunk: this.target.damage.sunk, targetUnderway: this.targetUnderway,
      mounts, modules: this.target.definition.modules.map((m, i) => ({ id: m.id, name: m.name, condition: this.target.damage.modules[i].hp / m.hp })),
      playerIntegrity: this.player.damage.integrity / 1000,
      playerDamageDealt: this.playerDamageDealt, playerFrags: this.playerFrags,
      playerWater: this.player.damage.compartments.reduce((n, c) => n + c.waterM3, 0),
      targetPosition: { x: this.target.motion.x, z: this.target.motion.z, heading: this.target.motion.heading },
      batteries: (['main', 'secondary'] as Battery[]).map(battery => {
        const states = this.definition.mounts.filter(m => m.battery === battery).map(m => this.player.mounts.find(s => s.id === m.id)!);
        const reloading = states.filter(m => m.reload > 0);
        return { battery, ammo: states.reduce((n, m) => n + m.ammo, 0), ready: states.filter(m => m.status === 'ready').length, total: states.length,
          reload: reloading.length ? Math.min(...reloading.map(m => m.reload)) : 0 };
      }),
      message: significant ? `${this.actors.find(actor => actor.motion.id === significant.shipId)?.definition.name ?? 'Ship'} · ${significant.message}` : 'Only aligned, loaded guns fire. Turn the ship to bring guns marked Out of arc onto the target.',
    };
  }
}
