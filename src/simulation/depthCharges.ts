import type { DepthChargePart, ShipDefinition, Vec3 } from '../ships/blueprint';
import type { FleetActor } from './battle';
import { add, clamp, localToWorld, rotate, scale, worldToLocal } from './geometry';
import { motionVelocity } from './ship';
import { damageUnderwaterBlast } from './torpedoes';
import { equipmentCondition } from './machinery';

export type DepthChargeDefinition = NonNullable<ShipDefinition['depthChargeLaunchers']>[number];
export interface DepthChargeLauncherState {
  id: string; ammo: number; reload: number; status: 'ready' | 'reloading' | 'empty' | 'disabled';
}
export interface DepthCharge {
  id: number; ownerId: string; launcherId: string; position: Vec3; velocity: Vec3;
  age: number; submerged: boolean; weapon: DepthChargePart;
}
export const createDepthChargeLauncherState = (l: DepthChargeDefinition): DepthChargeLauncherState => ({ id: l.id, ammo: l.ammo, reload: 0, status: l.ammo ? 'ready' : 'empty' });
export function updateDepthChargeLauncher(actor: FleetActor, l: DepthChargeDefinition, state: DepthChargeLauncherState, dt: number): void {
  state.reload = Math.max(0, state.reload - dt);
  const magazine = actor.definition.modules.find(m => m.id === l.magazineId);
  state.status = actor.damage.sunk || actor.damage.stability.combatLost || !magazine || equipmentCondition(actor, actor.definition, magazine).availability <= 0 ? 'disabled' : state.ammo <= 0 ? 'empty' : state.reload > 0 || (actor.depthChargeCooldown ?? 0) > 0 ? 'reloading' : 'ready';
}
export function launchDepthCharge(actor: FleetActor, l: DepthChargeDefinition, id: number): DepthCharge {
  return { id, ownerId: actor.motion.id, launcherId: l.id, position: localToWorld(l.position, actor.motion),
    velocity: add(rotate(l.velocity, actor.motion), motionVelocity(actor.motion)), age: 0, submerged: false, weapon: l.weapon };
}

/** Exact sea-entry split, then constant sinking with horizontal water drag. */
export function stepDepthCharge(charge: DepthCharge, dt: number): { splash: Vec3 | null; detonated: boolean } {
  let remaining = dt, splash: Vec3 | null = null;
  const p = charge.position, v = charge.velocity;
  if (!charge.submerged) {
    const entryTime = Math.max(0, (v[1] + Math.sqrt(v[1] ** 2 + 2 * 9.81 * Math.max(0, p[1]))) / 9.81);
    const airTime = Math.min(remaining, entryTime);
    p[0] += v[0] * airTime; p[2] += v[2] * airTime;
    p[1] += v[1] * airTime - .5 * 9.81 * airTime ** 2; v[1] -= 9.81 * airTime;
    remaining -= airTime;
    if (entryTime <= dt) { p[1] = 0; charge.submerged = true; splash = [...p]; }
  }
  if (charge.submerged) {
    const time = Math.min(remaining, Math.max(0, (charge.weapon.detonationDepthM + p[1]) / charge.weapon.sinkSpeed));
    const drag = Math.exp(-1.6 * time);
    p[0] += v[0] * (1 - drag) / 1.6; p[2] += v[2] * (1 - drag) / 1.6;
    v[0] *= drag; v[2] *= drag; v[1] = -charge.weapon.sinkSpeed;
    p[1] = Math.max(-charge.weapon.detonationDepthM, p[1] - charge.weapon.sinkSpeed * time);
  }
  charge.age += dt;
  return { splash, detonated: charge.submerged && p[1] <= -charge.weapon.detonationDepthM + 1e-8 };
}

/** Distance to a station-based submerged hull envelope, in meters. No armor/GPU query. */
export function depthChargeReach(position: Vec3, actor: FleetActor) {
  const local = worldToLocal(position, actor.motion), h = actor.definition.hull;
  const z = clamp(local[2], -h.length / 2, h.length / 2), station = h.length / 2 - z;
  const interpolate = (points: [number, number][]) => {
    const index = Math.max(0, points.findIndex((p, i) => i < points.length - 1 && station >= p[0] && station <= points[i + 1][0]));
    const [a, b] = [points[index], points[index + 1]];
    return a[1] + (b[1] - a[1]) * clamp((station - a[0]) / (b[0] - a[0]), 0, 1);
  };
  const width = interpolate(h.halfBreadths), keel = interpolate(h.keelHeights);
  const top = Math.min(interpolate(h.deckHeights), -actor.motion.y);
  const point: Vec3 = [clamp(local[0], -width, width), clamp(local[1], keel, Math.max(keel, top)), z];
  return { point, distance: Math.hypot(...local.map((v, i) => v - point[i])) };
}
export function damageDepthCharge(charge: DepthCharge, actor: FleetActor): string | null {
  const { point, distance } = depthChargeReach(charge.position, actor), w = charge.weapon;
  if (distance >= w.blastRadiusM) return null;
  const strength = (1 - distance / w.blastRadiusM) ** 2;
  return damageUnderwaterBlast(actor, point, { damage: w.damage * strength, breachAreaM2: w.breachAreaM2 * strength }, 'Depth charge hit', charge.id);
}

/** Bots release only into a predicted close pass, with the same trajectory and blast reach. */
export function botShouldDropDepthCharge(actor: FleetActor, target: FleetActor, l: DepthChargeDefinition, actors: readonly FleetActor[]): boolean {
  if (Math.hypot(actor.motion.x - target.motion.x, actor.motion.z - target.motion.z) > actor.definition.hull.length + target.definition.hull.length + l.weapon.blastRadiusM) return false;
  const charge = launchDepthCharge(actor, l, 0);
  // One coarse exact trajectory step suffices; the launch model integrates analytically.
  const airTime = Math.max(0, (charge.velocity[1] + Math.sqrt(charge.velocity[1] ** 2 + 19.62 * Math.max(0, charge.position[1]))) / 9.81);
  const time = airTime + l.weapon.detonationDepthM / l.weapon.sinkSpeed;
  stepDepthCharge(charge, time + .001);
  const predict = (a: FleetActor) => {
    const velocity = scale(motionVelocity(a.motion), time);
    return { ...a, motion: { ...a.motion, x: a.motion.x + velocity[0], z: a.motion.z + velocity[2] } };
  };
  return depthChargeReach(charge.position, predict(target)).distance < l.weapon.blastRadiusM * .75 &&
    !actors.some(a => a.team === actor.team && depthChargeReach(charge.position, predict(a)).distance < l.weapon.blastRadiusM);
}
