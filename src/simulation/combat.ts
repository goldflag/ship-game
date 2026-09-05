import type { Battery, ShipDefinition, Vec3 } from '../ships/blueprint';
import { createShipState, FIXED_DT, stepShip, type HelmCommand } from './ship';
import { add, clamp, contains, localToWorld, scale, segmentBox, sub, worldToLocal } from './geometry';
import { createMountState, GRAVITY, muzzleWorld, shotDirection, updateMount } from './weapons';
import { createDamage, hitShip, systemHealth, updateFlooding, type Combatant, type DamageEvent, type Shell } from './damage';

export interface CombatIntent { aim: Vec3; fire: boolean; battery: Battery; }
export interface CombatEvent { sequence: number; tick: number; kind: DamageEvent['kind'] | 'shot' | 'splash'; position: Vec3; message: string; shipId: string; }
export interface CombatTelemetry {
  battery: Battery; range: number; ready: number; total: number; targetIntegrity: number; targetWater: number;
  targetPower: number; targetSteering: number; targetSunk: boolean; targetUnderway: boolean;
  mounts: { id: string; name: string; status: string; reload: number; ammo: number }[];
  modules: { id: string; name: string; condition: number }[]; message: string;
}
export class CombatSimulation {
  readonly player: Combatant;
  target: Combatant;
  readonly shells: Shell[] = [];
  readonly events: CombatEvent[] = [];
  targetUnderway = false;
  tick = 0;
  private accumulator = 0;
  private shellSequence = 0;
  private eventSequence = 0;
  private fireQueued = false;
  constructor(readonly definition: ShipDefinition) {
    this.player = this.createActor('player');
    this.target = this.createTarget();
  }
  get ship() { return this.player.motion; }
  /** Start a fresh voyage without invalidating the renderer's actor references. */
  reset(): void {
    Object.assign(this.player, this.createActor('player'));
    this.resetTarget(); this.tick = 0; this.accumulator = 0;
  }
  private createActor(id: string): Combatant {
    return { motion: createShipState(id), mounts: this.definition.mounts.map(createMountState), damage: createDamage(this.definition) };
  }
  private createTarget() {
    const target = this.createActor('target');
    target.motion.x = this.ship.x + 650; target.motion.z = this.ship.z - 550;
    return target;
  }
  resetTarget(): void {
    Object.assign(this.target, this.createTarget()); this.targetUnderway = false; this.shells.length = 0;
    this.events.length = 0; this.fireQueued = false;
  }
  aimAt(moduleId?: string, battery: Battery = 'main'): Vec3 {
    const m = this.definition.modules.find(m => m.id === moduleId);
    const aim = localToWorld(m ? [m.center[0], .5, m.center[2]] : [0, .5, 0], this.target.motion);
    const speed = this.definition.mounts.find(m => m.battery === battery)?.weapon.muzzleSpeed ?? 820;
    const time = Math.hypot(aim[0] - this.ship.x, aim[2] - this.ship.z) / speed;
    return add(aim, [Math.sin(this.target.motion.heading) * this.target.motion.speed * time, 0, -Math.cos(this.target.motion.heading) * this.target.motion.speed * time]);
  }
  requestFire(): void { this.fireQueued = true; }
  private emit = (event: Omit<CombatEvent, 'sequence' | 'tick'>): void => {
    this.events.push({ ...event, sequence: ++this.eventSequence, tick: this.tick });
    if (this.events.length > 128) this.events.shift();
  };
  advance(dt: number, helm: HelmCommand, intent: CombatIntent): void {
    this.accumulator += Number.isFinite(dt) ? clamp(dt, 0, .1) : 0;
    while (this.accumulator + 1e-10 >= FIXED_DT) {
      this.step(helm, intent);
      this.accumulator = Math.max(0, this.accumulator - FIXED_DT);
    }
  }
  /** Host/server calls one fixed tick with input intent. All hit outcomes are computed here. */
  step(helm: HelmCommand, intent: CombatIntent): void {
    const def = this.definition;
    const aimValid = Array.isArray(intent.aim) && intent.aim.length === 3 && intent.aim.every(n => Number.isFinite(n) && Math.abs(n) < 1e7);
    stepShip(this.ship, helm, def.handling, systemHealth(this.player, def, 'engine'), systemHealth(this.player, def, 'steering'));
    stepShip(this.target.motion, { throttle: this.targetUnderway ? .25 : 0, rudder: 0 }, def.handling, systemHealth(this.target, def, 'engine'), systemHealth(this.target, def, 'steering'));
    def.mounts.forEach((m, i) => {
      const state = this.player.mounts[i];
      if (m.magazineId && this.player.damage.modules.find(module => module.id === m.magazineId)?.hp === 0) { state.status = 'disabled'; return; }
      if (!aimValid) { state.status = 'out-of-arc'; return; }
      updateMount(m, state, def, this.ship, intent.aim, FIXED_DT, [Math.sin(this.ship.heading) * this.ship.speed, 0, -Math.cos(this.ship.heading) * this.ship.speed]);
      const barrelCount = m.weapon.barrelCount ?? 2;
      if (!this.player.damage.sunk && (intent.fire || this.fireQueued) && m.battery === intent.battery && state.status === 'ready' && this.shells.length <= 256 - barrelCount) {
        state.reload = m.weapon.reloadSeconds; state.ammo -= barrelCount; state.recoil = 1; state.status = 'reloading';
        for (let barrel = 0; barrel < barrelCount; barrel++) {
          const position = muzzleWorld(m, state, barrel, this.ship);
          const velocity = add(scale(shotDirection(m, state, this.ship), m.weapon.muzzleSpeed), [Math.sin(this.ship.heading) * this.ship.speed, 0, -Math.cos(this.ship.heading) * this.ship.speed]);
          this.shells.push({ id: ++this.shellSequence, ownerId: this.ship.id, position, velocity, age: 0, penetrationMm: m.weapon.penetrationMm, damage: m.weapon.damage, caliberM: m.weapon.caliberM, visited: [] });
          this.emit({ kind: 'shot', position: [...position], shipId: this.ship.id, message: `${m.name} fired` });
        }
      }
    });
    this.fireQueued = false;
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const shell = this.shells[i];
      const from: Vec3 = [...shell.position];
      // Constant-acceleration integration preserves the analytical aim solution.
      const to = add(from, add(scale(shell.velocity, FIXED_DT), [0, -.5 * GRAVITY * FIXED_DT * FIXED_DT, 0]));
      shell.velocity[1] -= GRAVITY * FIXED_DT; shell.age += FIXED_DT;
      let ended = false;
      // Bound each swept segment to the first sea contact, so submerged modules can't
      // be hit by shells that already splashed down outside the hull.
      const insideHull = (point: Vec3) => [this.player, this.target].some(actor => actor.motion.id !== shell.ownerId && def.armor.some(a => contains(a, worldToLocal(point, actor.motion))));
      const seaPoint = from[1] > 0 && to[1] <= 0 ? add(from, scale(sub(to, from), from[1] / (from[1] - to[1]))) : to;
      const crossingSea = from[1] > 0 && to[1] <= 0 && !insideHull(seaPoint);
      const end = crossingSea ? add(from, scale(sub(to, from), from[1] / (from[1] - to[1]))) : to;
      const candidates = [this.player, this.target].filter(a => a.motion.id !== shell.ownerId && a.motion.y > -40).map(actor => {
        const hit = segmentBox(worldToLocal(from, actor.motion), worldToLocal(end, actor.motion), { center: [0, 10, 0], size: [def.hull.beam + 30, 60, def.hull.length + 40] });
        return { actor, hit };
      }).filter(c => c.hit).sort((a, b) => a.hit!.t - b.hit!.t);
      for (const { actor } of candidates) if (hitShip(shell, from, end, actor, def, this.emit)) { ended = true; break; }
      if (!ended && (crossingSea || (to[1] < 0 && !insideHull(to)))) {
        this.emit({ kind: 'splash', position: [end[0], 0, end[2]], shipId: '', message: 'Shell splash' }); ended = true;
      }
      shell.position = to;
      if (ended || shell.age > 60) this.shells.splice(i, 1);
    }
    for (const actor of [this.player, this.target]) {
      const wasSunk = actor.damage.sunk;
      updateFlooding(actor, def, FIXED_DT);
      if (!wasSunk && actor.damage.sunk) this.emit({ kind: 'sunk', position: [actor.motion.x, actor.motion.y, actor.motion.z], shipId: actor.motion.id, message: 'Target sinking' });
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
      targetIntegrity: this.target.damage.integrity / 1000, targetWater: this.target.damage.compartments.reduce((n, c) => n + c.waterM3, 0),
      targetPower: systemHealth(this.target, this.definition, 'engine'), targetSteering: systemHealth(this.target, this.definition, 'steering'), targetSunk: this.target.damage.sunk, targetUnderway: this.targetUnderway,
      mounts, modules: this.definition.modules.map((m, i) => ({ id: m.id, name: m.name, condition: this.target.damage.modules[i].hp / m.hp })),
      message: significant?.message ?? 'Aim at the target, wait for guns to train, then fire.',
    };
  }
}
