/** Read-only mount geometry over the frame's mount state: where each barrel's
 * muzzle is, which way a shot leaves, the low arc to a point, how many rounds
 * of a type a mount holds. The authority fires; this only reads and draws. */
import type { Ammunition, ShipDefinition, Vec3 } from '../ships/blueprint';
import { barrelOffset, barrelHeightOffset } from '../ships/blueprint';
import { add, clamp, localToWorld, normalize, radians, rotate, scale, sub, type Pose } from './geometry';
import { GRAVITY, solveDragArc } from './ballistics';
import { mountBearing, mountPosition } from './mountFrames';
import type { MountState as SessionMount } from './session/elements';
export { GRAVITY } from './ballistics';
export type MountDefinition = ShipDefinition['mounts'][number];
export const availableAmmunition = (state: Pick<SessionMount, 'loaded' | 'ammo' | 'heAmmo'>, type = state.loaded): number => type === 'he' ? Math.max(0, Math.min(state.ammo, state.heAmmo)) : Math.max(0, state.ammo - state.heAmmo);
/** Reload, traverse and elevation all slow together as electrical power fails. The HUD divides displayed reload by the same rate. */
export const gunWorkRate = (power: number): number => .25 + .75 * clamp(power, 0, 1);
export function muzzleLocal(m: MountDefinition, state: Pick<SessionMount, 'train' | 'elevation' | 'carrier'>, barrel: number): Vec3 {
  const bearing = mountBearing(m, state), w = m.weapon;
  const forward = w.trunnionForward + (w.muzzleForward - w.trunnionForward) * Math.cos(state.elevation) - barrelHeightOffset(w, barrel) * Math.sin(state.elevation);
  const lateral = barrelOffset(w, barrel);
  return add(mountPosition(m, state), [Math.cos(bearing) * lateral + Math.sin(bearing) * forward, w.pivotHeight + barrelHeightOffset(w, barrel) * Math.cos(state.elevation) + (w.muzzleForward - w.trunnionForward) * Math.sin(state.elevation), Math.sin(bearing) * lateral - Math.cos(bearing) * forward]);
}
export const muzzleWorld = (m: MountDefinition, state: SessionMount, barrel: number, pose: Pose) => localToWorld(muzzleLocal(m, state, barrel), pose);
/** Upright immersion needs only muzzle height; heading cannot affect it. */
export function muzzleHeight(m: MountDefinition, state: SessionMount, pose: Pose): number {
  if (pose.roll !== 0 || pose.pitch !== 0) return muzzleWorld(m, state, 0, pose)[1];
  const w = m.weapon;
  return mountPosition(m, state)[1] + (w.pivotHeight + barrelHeightOffset(w, 0) * Math.cos(state.elevation)
    + (w.muzzleForward - w.trunnionForward) * Math.sin(state.elevation)) + pose.y;
}
/** The aiming reference is the battery mount's barrel center, including odd/single layouts. */
export function muzzleCenterLocal(m: MountDefinition, state: Pick<SessionMount, 'train' | 'elevation' | 'carrier'>): Vec3 {
  const w = m.weapon, count = w.barrelCount, bearing = mountBearing(m, state), position = mountPosition(m, state);
  const forward = w.trunnionForward + (w.muzzleForward - w.trunnionForward) * Math.cos(state.elevation);
  const cosine = Math.cos(bearing), sine = Math.sin(bearing);
  const vertical = w.pivotHeight + (w.muzzleForward - w.trunnionForward) * Math.sin(state.elevation);
  let x = 0, y = 0, z = 0;
  // Preserve the barrel-by-barrel division/addition order exactly; share only
  // invariant trigonometry and avoid intermediate vectors.
  for (let barrel = 0; barrel < count; barrel++) {
    const lateral = barrelOffset(w, barrel), row = barrelHeightOffset(w, barrel);
    const boreForward = forward - row * Math.sin(state.elevation);
    x += (position[0] + (cosine * lateral + sine * boreForward)) / count;
    y += (position[1] + vertical + row * Math.cos(state.elevation)) / count;
    z += (position[2] + (sine * lateral - cosine * boreForward)) / count;
  }
  return [x, y, z];
}
export const muzzleCenterWorld = (m: MountDefinition, state: SessionMount, pose: Pose) => localToWorld(muzzleCenterLocal(m, state), pose);
export function shotDirection(m: MountDefinition, state: SessionMount, pose: Pose): Vec3 {
  const bearing = mountBearing(m, state);
  return rotate([Math.sin(bearing) * Math.cos(state.elevation), Math.sin(state.elevation), -Math.cos(bearing) * Math.cos(state.elevation)], pose);
}
/** Low ballistic arc. Same gravity and speed as projectile integration. */
export function solveBallistic(from: Vec3, target: Vec3, speed: number, dragPerSecond = 0): { direction: Vec3; time: number } | null {
  const delta = sub(target, from), range = Math.hypot(delta[0], delta[2]);
  if (range < 1 || range > 30000 || !target.every(Number.isFinite)) return null;
  if (dragPerSecond > 1e-8) return solveDragArc(from, target, speed, dragPerSecond);
  const v2 = speed * speed;
  const discriminant = v2 * v2 - GRAVITY * (GRAVITY * range * range + 2 * delta[1] * v2);
  if (discriminant < 0) return null;
  const angle = Math.atan((v2 - Math.sqrt(discriminant)) / (GRAVITY * range));
  return { direction: [delta[0] / range * Math.cos(angle), Math.sin(angle), delta[2] / range * Math.cos(angle)], time: range / (speed * Math.cos(angle)) };
}
/** Return true when the barrel has reached a valid firing solution (used by bots). */
