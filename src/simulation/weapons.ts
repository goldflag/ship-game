import type { ShipDefinition, Vec3 } from '../ships/blueprint';
import { barrelIds, barrelOffset } from '../ships/blueprint';
import { add, clamp, length, localToWorld, normalize, radians, rotate, segmentBox, sub, wrapAngle, worldToLocal, type Pose } from './geometry';
export const GRAVITY = 9.81;
export type MountDefinition = ShipDefinition['mounts'][number];
export interface MountState { id: string; train: number; elevation: number; reload: number; ammo: number; hp: number; recoil: number; status: 'ready' | 'turning' | 'reloading' | 'blocked' | 'out-of-arc' | 'out-of-range' | 'empty' | 'disabled' | 'submerged'; }
export const createMountState = (m: MountDefinition): MountState => ({ id: m.id, train: 0, elevation: radians(1), reload: 0, ammo: m.weapon.ammoPerBarrel * (m.weapon.barrelCount ?? 2), hp: 100, recoil: 0, status: 'turning' });
export function muzzleLocal(m: MountDefinition, state: Pick<MountState, 'train' | 'elevation'>, barrel: number): Vec3 {
  const bearing = radians(m.bearingDeg) + state.train, w = m.weapon;
  const forward = w.trunnionForward + (w.muzzleForward - w.trunnionForward) * Math.cos(state.elevation);
  const lateral = barrelOffset(w, barrel);
  return add(m.position, [Math.cos(bearing) * lateral + Math.sin(bearing) * forward, w.pivotHeight + (w.muzzleForward - w.trunnionForward) * Math.sin(state.elevation), Math.sin(bearing) * lateral - Math.cos(bearing) * forward]);
}
export const muzzleWorld = (m: MountDefinition, state: MountState, barrel: number, pose: Pose) => localToWorld(muzzleLocal(m, state, barrel), pose);
/** The aiming reference is the battery mount's barrel center, including odd/single layouts. */
export function muzzleCenterLocal(m: MountDefinition, state: Pick<MountState, 'train' | 'elevation'>): Vec3 {
  const count = m.weapon.barrelCount ?? 2;
  let center: Vec3 = [0, 0, 0];
  for (let barrel = 0; barrel < count; barrel++) center = add(center, muzzleLocal(m, state, barrel).map(n => n / count) as Vec3);
  return center;
}
export const muzzleCenterWorld = (m: MountDefinition, state: MountState, pose: Pose) => localToWorld(muzzleCenterLocal(m, state), pose);
export function shotDirection(m: MountDefinition, state: MountState, pose: Pose): Vec3 {
  const bearing = radians(m.bearingDeg) + state.train;
  return rotate([Math.sin(bearing) * Math.cos(state.elevation), Math.sin(state.elevation), -Math.cos(bearing) * Math.cos(state.elevation)], pose);
}
/** Low ballistic arc. Same gravity and speed as projectile integration. */
export function solveBallistic(from: Vec3, target: Vec3, speed: number): { direction: Vec3; time: number } | null {
  const delta = sub(target, from), range = Math.hypot(delta[0], delta[2]);
  if (range < 1 || range > 30000 || !target.every(Number.isFinite)) return null;
  const v2 = speed * speed;
  const discriminant = v2 * v2 - GRAVITY * (GRAVITY * range * range + 2 * delta[1] * v2);
  if (discriminant < 0) return null;
  const angle = Math.atan((v2 - Math.sqrt(discriminant)) / (GRAVITY * range));
  return { direction: [delta[0] / range * Math.cos(angle), Math.sin(angle), delta[2] / range * Math.cos(angle)], time: range / (speed * Math.cos(angle)) };
}
/** Shared player/bot fire eligibility. Reload and aim are independent; status explains why a gun cannot fire. */
export function updateMount(m: MountDefinition, state: MountState, definition: ShipDefinition, pose: Pose, aim: Vec3, dt: number, inheritedVelocity: Vec3 = [0, 0, 0]): boolean {
  state.reload = Math.max(0, state.reload - dt);
  state.recoil = Math.max(0, state.recoil - dt / 1.4);
  if (state.hp <= 0) { state.status = 'disabled'; return false; }
  if (state.ammo < (m.weapon.barrelCount ?? 2)) { state.status = 'empty'; return false; }
  if (definition.submarine && pose.y < -.5 || muzzleWorld(m, state, 0, pose)[1] <= 0) { state.status = 'submerged'; return false; }
  // Iterate from the actual muzzle so the long barrel offset doesn't bias close shots.
  let desiredTrain = state.train, desiredElevation = state.elevation;
  let reachable = true;
  let flightTime = length(sub(aim, [pose.x, pose.y, pose.z])) / m.weapon.muzzleSpeed;
  for (let i = 0; i < 3; i++) {
    const midpoint = localToWorld(muzzleCenterLocal(m, { train: desiredTrain, elevation: desiredElevation }), pose);
    const relativeAim = sub(aim, inheritedVelocity.map(n => n * flightTime) as Vec3);
    const solution = solveBallistic(midpoint, relativeAim, m.weapon.muzzleSpeed);
    if (!solution) { reachable = false; desiredTrain = state.train; desiredElevation = state.elevation; break; }
    flightTime = solution.time;
    const direction = normalize(sub(worldToLocal(add([pose.x, pose.y, pose.z], solution.direction), pose), [0, 0, 0]));
    desiredTrain = wrapAngle(Math.atan2(direction[0], -direction[2]) - radians(m.bearingDeg));
    desiredElevation = Math.asin(clamp(direction[1], -1, 1));
  }
  const w = m.weapon, limit = radians(w.traverseDeg);
  const train = clamp(desiredTrain, -limit, limit), elevation = clamp(desiredElevation, radians(w.elevationMinDeg), radians(w.elevationMaxDeg));
  // Traverse through the permitted interval; never shortcut across the forbidden stern sector.
  state.train += clamp(train - state.train, -radians(w.traverseRateDeg) * dt, radians(w.traverseRateDeg) * dt);
  state.elevation += clamp(elevation - state.elevation, -radians(w.elevationRateDeg) * dt, radians(w.elevationRateDeg) * dt);
  // Readiness depends on the actual barrel path, even while tracking an unreachable reticle.
  const obstructed = barrelIds(w).some((_, barrel) => {
    const muzzle = muzzleLocal(m, state, barrel);
    const direction = normalize(sub(muzzle, add(m.position, [0, w.pivotHeight, 0])));
    const beyond = add(muzzle, direction.map(n => n * definition.hull.length) as Vec3);
    const breech = add(m.position, [0, w.pivotHeight, 0]);
    return definition.obstructions.some(box => segmentBox(breech, beyond, box)) || definition.mounts.some(other => other.id !== m.id && segmentBox(breech, beyond, { center: add(other.position, [0, other.weapon.gunhouseSize[2] / 2, 0]), size: [other.weapon.gunhouseSize[1], other.weapon.gunhouseSize[2], other.weapon.gunhouseSize[0]] }));
  });
  if (obstructed) { state.status = 'blocked'; return false; }
  if (!reachable) { state.status = 'out-of-range'; return false; }
  if (Math.abs(desiredTrain) > limit + 1e-6 || desiredElevation < radians(w.elevationMinDeg) - 1e-6 || desiredElevation > radians(w.elevationMaxDeg) + 1e-6) { state.status = 'out-of-arc'; return false; }
  // A small angular tolerance is shared by firing and the HUD via this status.
  if (Math.abs(desiredTrain - state.train) >= .0015 || Math.abs(desiredElevation - state.elevation) >= .0008) { state.status = 'turning'; return false; }
  state.status = state.reload > 0 ? 'reloading' : 'ready';
  return true;
}
