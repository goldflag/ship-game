import type { Ammunition, ShipDefinition, Vec3 } from '../ships/blueprint';
import { barrelOffset } from '../ships/blueprint';
import { add, clamp, length, localToWorld, normalize, radians, rotate, sub, wrapAngle, worldToLocal, type Pose } from './geometry';
import { GRAVITY, solveDragArc, travelFactor } from './ballistics';
import { segmentIntersectsBox } from './obstruction';
export { GRAVITY } from './ballistics';
export type MountDefinition = ShipDefinition['mounts'][number];
// Compiled definitions are immutable during a battle, like the hull/armor caches.
// Every barrel used to rebuild every other gunhouse box on every fixed tick.
const gunhouseBoxes = new WeakMap<ShipDefinition, { id: string; center: Vec3; size: Vec3 }[]>();
function obstructionGunhouses(definition: ShipDefinition) {
  let boxes = gunhouseBoxes.get(definition);
  if (!boxes) {
    boxes = definition.mounts.map(m => ({ id: m.id,
      center: add(m.position, [0, m.weapon.gunhouseSize[2] / 2, 0]),
      size: [m.weapon.gunhouseSize[1], m.weapon.gunhouseSize[2], m.weapon.gunhouseSize[0]] as Vec3 }));
    gunhouseBoxes.set(definition, boxes);
  }
  return boxes;
}
export interface MountState {
  id: string; train: number; elevation: number; reload: number; ammo: number; hp: number; recoil: number;
  /** Total rounds include the HE subset; rounds are consumed when fired. */
  heAmmo: number; loaded: Ammunition;
  status: 'ready' | 'reloading' | 'turning' | 'out-of-range' | 'blocked' | 'out-of-arc' | 'empty' | 'disabled' | 'submerged';
  aimCache?: { time: number; train: number; elevation: number; point: Vec3 };
  leadCache?: { time: number; point: Vec3 };
}
export const createMountState = (m: MountDefinition): MountState => ({ id: m.id, train: 0, elevation: radians(1), reload: 0,
  ammo: m.weapon.ammoPerBarrel * (m.weapon.barrelCount ?? 2), heAmmo: Math.floor(m.weapon.ammoPerBarrel * (m.weapon.he?.stockFraction ?? 0)) * (m.weapon.barrelCount ?? 2),
  loaded: 'ap', hp: 100, recoil: 0, status: 'turning' });
export const availableAmmunition = (state: MountState, type = state.loaded): number => type === 'he' ? Math.max(0, Math.min(state.ammo, state.heAmmo)) : Math.max(0, state.ammo - state.heAmmo);
/** Unloading returns the unfired round to its existing stock. Changing type
 * always requires a complete load interval, including changing back mid-load. */
export function selectAmmunition(m: MountDefinition, state: MountState, requested: Ammunition): void {
  const type = requested === 'he' && !m.weapon.he ? 'ap' : requested;
  if (state.loaded === type) return;
  state.loaded = type; state.reload = Math.max(state.reload, m.weapon.reloadSeconds);
  delete state.aimCache; delete state.leadCache;
}
export function muzzleLocal(m: MountDefinition, state: Pick<MountState, 'train' | 'elevation'>, barrel: number): Vec3 {
  const bearing = radians(m.bearingDeg) + state.train, w = m.weapon;
  const forward = w.trunnionForward + (w.muzzleForward - w.trunnionForward) * Math.cos(state.elevation);
  const lateral = barrelOffset(w, barrel);
  return add(m.position, [Math.cos(bearing) * lateral + Math.sin(bearing) * forward, w.pivotHeight + (w.muzzleForward - w.trunnionForward) * Math.sin(state.elevation), Math.sin(bearing) * lateral - Math.cos(bearing) * forward]);
}
export const muzzleWorld = (m: MountDefinition, state: MountState, barrel: number, pose: Pose) => localToWorld(muzzleLocal(m, state, barrel), pose);
/** The aiming reference is the battery mount's barrel center, including odd/single layouts. */
export function muzzleCenterLocal(m: MountDefinition, state: Pick<MountState, 'train' | 'elevation'>): Vec3 {
  const w = m.weapon, count = w.barrelCount ?? 2, bearing = radians(m.bearingDeg) + state.train;
  const forward = w.trunnionForward + (w.muzzleForward - w.trunnionForward) * Math.cos(state.elevation);
  const cosine = Math.cos(bearing), sine = Math.sin(bearing);
  const vertical = w.pivotHeight + (w.muzzleForward - w.trunnionForward) * Math.sin(state.elevation);
  let x = 0, y = 0, z = 0;
  // Preserve the barrel-by-barrel division/addition order exactly; share only
  // invariant trigonometry and avoid intermediate vectors.
  for (let barrel = 0; barrel < count; barrel++) {
    const lateral = barrelOffset(w, barrel);
    x += (m.position[0] + (cosine * lateral + sine * forward)) / count;
    y += (m.position[1] + vertical) / count;
    z += (m.position[2] + (sine * lateral - cosine * forward)) / count;
  }
  return [x, y, z];
}
export const muzzleCenterWorld = (m: MountDefinition, state: MountState, pose: Pose) => localToWorld(muzzleCenterLocal(m, state), pose);
export function shotDirection(m: MountDefinition, state: MountState, pose: Pose): Vec3 {
  const bearing = radians(m.bearingDeg) + state.train;
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
export function updateMount(m: MountDefinition, state: MountState, definition: ShipDefinition, pose: Pose, aim: Vec3 | undefined, dt: number, inheritedVelocity: Vec3 = [0, 0, 0]): boolean {
  state.reload = Math.max(0, state.reload - dt);
  state.recoil = Math.max(0, state.recoil - dt / 1.4);
  if (state.hp <= 0) { state.status = 'disabled'; return false; }
  if (availableAmmunition(state) < (m.weapon.barrelCount ?? 2)) { state.status = 'empty'; return false; }
  if ((definition.submarine && pose.y < -.5) || muzzleWorld(m, state, 0, pose)[1] <= 0) { state.status = 'submerged'; return false; }
  // Warm-start from the previous desired muzzle and flight time. Reacquisition
  // still converges in three iterations; continuous tracking needs only one.
  // Heading and inherited velocity are recomputed each tick, even for a cached
  // point; the cache only supplies the initial guess, not a stale direction.
  const cache = aim && state.aimCache && length(sub(aim, state.aimCache.point)) < 10 ? state.aimCache : undefined;
  let desiredTrain = cache?.train ?? state.train, desiredElevation = cache?.elevation ?? state.elevation;
  let reachable = !!aim;
  let flightTime = cache?.time ?? (aim ? length(sub(aim, [pose.x, pose.y, pose.z])) / m.weapon.muzzleSpeed : 0);
  for (let i = 0; aim && i < (cache ? 1 : 3); i++) {
    const midpoint = localToWorld(muzzleCenterLocal(m, { train: desiredTrain, elevation: desiredElevation }), pose);
    const drag = m.weapon.ballistics?.dragPerSecond ?? 0;
    const inheritedTravel = travelFactor(flightTime, drag);
    const relativeAim: Vec3 = [aim[0] - inheritedVelocity[0] * inheritedTravel,
      aim[1] - inheritedVelocity[1] * inheritedTravel, aim[2] - inheritedVelocity[2] * inheritedTravel];
    const solution = solveBallistic(midpoint, relativeAim, m.weapon.muzzleSpeed, drag);
    if (!solution) { reachable = false; desiredTrain = state.train; desiredElevation = state.elevation; break; }
    flightTime = solution.time;
    const direction = normalize(sub(worldToLocal(add([pose.x, pose.y, pose.z], solution.direction), pose), [0, 0, 0]));
    desiredTrain = wrapAngle(Math.atan2(direction[0], -direction[2]) - radians(m.bearingDeg));
    desiredElevation = Math.asin(clamp(direction[1], -1, 1));
  }
  state.aimCache = reachable && aim ? { time: flightTime, train: desiredTrain, elevation: desiredElevation, point: [...aim] } : undefined;
  const w = m.weapon, limit = radians(w.traverseDeg);
  const train = clamp(desiredTrain, -limit, limit), elevation = clamp(desiredElevation, radians(w.elevationMinDeg), radians(w.elevationMaxDeg));
  // Traverse through the permitted interval; never shortcut across the forbidden stern sector.
  state.train += clamp(train - state.train, -radians(w.traverseRateDeg) * dt, radians(w.traverseRateDeg) * dt);
  state.elevation += clamp(elevation - state.elevation, -radians(w.elevationRateDeg) * dt, radians(w.elevationRateDeg) * dt);
  // Readiness depends on the actual barrel path, even while tracking an unreachable reticle.
  const breech = add(m.position, [0, w.pivotHeight, 0]);
  let obstructed = false;
  for (let barrel = 0; barrel < (w.barrelCount ?? 2) && !obstructed; barrel++) {
    const muzzle = muzzleLocal(m, state, barrel);
    const direction = normalize(sub(muzzle, breech));
    const beyond: Vec3 = [muzzle[0] + direction[0] * definition.hull.length,
      muzzle[1] + direction[1] * definition.hull.length, muzzle[2] + direction[2] * definition.hull.length];
    for (const box of definition.obstructions) if (segmentIntersectsBox(breech, beyond, box)) { obstructed = true; break; }
    if (!obstructed) for (const box of obstructionGunhouses(definition)) {
      if (box.id !== m.id && segmentIntersectsBox(breech, beyond, box)) { obstructed = true; break; }
    }
  }
  if (obstructed) { state.status = 'blocked'; return false; }
  if (!reachable) { state.status = 'out-of-range'; return false; }
  if (Math.abs(desiredTrain) > limit + 1e-6 || desiredElevation < radians(w.elevationMinDeg) - 1e-6 || desiredElevation > radians(w.elevationMaxDeg) + 1e-6) { state.status = 'out-of-arc'; return false; }
  // A small angular tolerance is shared by firing and the HUD via this status.
  if (Math.abs(desiredTrain - state.train) >= .0015 || Math.abs(desiredElevation - state.elevation) >= .0008) { state.status = 'turning'; return false; }
  state.status = state.reload > 0 ? 'reloading' : 'ready';
  return true;
}
