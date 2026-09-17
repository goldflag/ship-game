import { hullDepth } from '../game/session/motion';
import { gunTraverseLimitsDeg } from '../ships/armament';
import type { Ammunition, ShipDefinition, Vec3 } from '../ships/blueprint';
import { barrelOffset, barrelHeightOffset } from '../ships/blueprint';
import { add, clamp, length, localToWorld, normalize, radians, rotate, sub, wrapAngle, worldToLocal, type Pose } from '../game/geometry';
import { GRAVITY, solveDragArc, travelFactor } from '../game/ballistics';
import { BarrelObstructionTree, gunMountObstructions, segmentIntersectsBox } from '../game/obstruction';
import { mountBearing, mountPosition, mountFrame, type CarrierFrame } from '../game/mountFrames';
import { moveMountWithClearance } from './mountClearance';
import type { MountState as SessionMount } from '../game/session/elements';
import { availableAmmunition, gunWorkRate, muzzleHeight, muzzleLocal, muzzleWorld, muzzleCenterLocal, muzzleCenterWorld, shotDirection, solveBallistic, type MountDefinition } from '../game/mountGeometry';
export { GRAVITY, availableAmmunition, gunWorkRate, muzzleLocal, muzzleWorld, muzzleCenterLocal, muzzleCenterWorld, shotDirection, solveBallistic, type MountDefinition } from '../game/mountGeometry';
// Compiled definitions are immutable during a battle, like the hull/armor caches.
// Every barrel used to rebuild every other gunhouse box on every fixed tick.
const barrelObstructions = new WeakMap<MountState, { definition: ShipDefinition; mount: MountDefinition; train: number; elevation: number; blocked: boolean; carriers: number[] }>();
const obstructionTrees = new WeakMap<ShipDefinition, BarrelObstructionTree>();
const carriedIndices = new WeakMap<ShipDefinition, number[]>();
function carriedMounts(definition: ShipDefinition): number[] {
  let indices = carriedIndices.get(definition);
  if (!indices) { indices = definition.mounts.flatMap((m, i) => m.parentMountId ? [i] : []); carriedIndices.set(definition, indices); }
  return indices;
}
function obstructionTree(definition: ShipDefinition) {
  let tree = obstructionTrees.get(definition);
  if (!tree) {
    tree = new BarrelObstructionTree([
      ...definition.obstructions.map(box => ({ box })),
      ...definition.mounts.filter(m => !m.parentMountId).flatMap(gunMountObstructions),
    ]);
    obstructionTrees.set(definition, tree);
  }
  return tree;
}
/** The engine's mount keeps what the frame drops: the derived carrier pose,
 * AA discipline and lead/aim caches. The published shape is the generated one. */
export interface MountState extends Omit<import('../game/session/elements').MountState, 'aimCache'> {
  aaDiscipline?: import('./airGunnery').FireDiscipline;
  aimCache?: { time: number; train: number; elevation: number; point: Vec3 };
  leadCache?: { time: number; point: Vec3 };
}
export const createMountState = (m: MountDefinition): MountState => ({ id: m.id, train: 0, elevation: radians(m.initialElevationDeg ?? 1), reload: 0,
  ammo: m.weapon.ammoPerBarrel * m.weapon.barrelCount, heAmmo: Math.floor(m.weapon.ammoPerBarrel * (m.weapon.he?.stockFraction ?? 0)) * m.weapon.barrelCount,
  loaded: 'ap', hp: 100, recoil: 0, status: 'turning' });
/** Spend one complete salvo of the loaded type and begin the reload and recoil.
 * Readiness is the caller's decision; the shared stock model (total rounds with an
 * HE subset) and the post-salvo state live here for every firing path. */
export function expendSalvo(m: MountDefinition, state: MountState, reloadSeconds = m.weapon.reloadSeconds): number {
  const barrels = m.weapon.barrelCount;
  state.ammo -= barrels;
  if (state.loaded === 'he') state.heAmmo -= barrels;
  state.reload = reloadSeconds; state.recoil = 1; state.status = 'reloading';
  return barrels;
}
/** Unloading returns the unfired round to its existing stock. Changing type
 * always requires a complete load interval, including changing back mid-load. */
export function selectAmmunition(m: MountDefinition, state: MountState, requested: Ammunition): void {
  const type = requested === 'he' && !m.weapon.he ? 'ap' : requested;
  delete state.queued;
  if (state.loaded === type) return;
  state.loaded = type; state.reload = Math.max(state.reload, m.weapon.reloadSeconds);
  delete state.aimCache; delete state.leadCache;
}
/** Keep the current salvo; use the requested stock when the current reload completes. */
export function queueAmmunition(m: MountDefinition, state: MountState, requested: Ammunition): void {
  const type = requested === 'he' && !m.weapon.he ? 'ap' : requested;
  if (type === state.loaded) { delete state.queued; return; }
  if (availableAmmunition(state, type) < m.weapon.barrelCount) return;
  state.queued = type;
  // An empty gun has no current salvo to preserve.
  if (state.reload === 0 && availableAmmunition(state) < m.weapon.barrelCount) selectAmmunition(m, state, type);
}
export function updateMount(m: MountDefinition, state: MountState, definition: ShipDefinition, pose: Pose & { waveHeave?: number }, aim: Vec3 | undefined, dt: number, inheritedVelocity: Vec3 = [0, 0, 0], power = 1, mountedStates?: readonly MountState[]): boolean {
  const workRate = gunWorkRate(power);
  const wasReloading = state.reload > 0;
  state.reload = Math.max(0, state.reload - dt * workRate);
  if (wasReloading && state.reload === 0 && state.queued) {
    state.loaded = state.queued;
    delete state.queued; delete state.aimCache; delete state.leadCache;
  }
  state.recoil = Math.max(0, state.recoil - dt / 1.4);
  if (state.hp <= 0) { state.status = 'disabled'; return false; }
  if (availableAmmunition(state) < m.weapon.barrelCount) { state.status = 'empty'; return false; }
  if ((definition.submarine && hullDepth(pose) > .5) || muzzleHeight(m, state, pose) <= (pose.waveHeave ?? 0)) { state.status = 'submerged'; return false; }
  // Warm-start from the previous desired muzzle and flight time. Reacquisition
  // still converges in three iterations; continuous tracking needs only one.
  // Heading and inherited velocity are recomputed each tick, even for a cached
  // point; the cache only supplies the initial guess, not a stale direction.
  const cache = aim && state.aimCache && length(sub(aim, state.aimCache.point)) < 10 ? state.aimCache : undefined;
  let desiredTrain = cache?.train ?? state.train, desiredElevation = cache?.elevation ?? state.elevation;
  let reachable = !!aim;
  let flightTime = cache?.time ?? (aim ? length(sub(aim, [pose.x, pose.y, pose.z])) / m.weapon.muzzleSpeed : 0);
  for (let i = 0; aim && i < (cache ? 1 : 3); i++) {
    const midpoint = localToWorld(muzzleCenterLocal(m, { train: desiredTrain, elevation: desiredElevation, carrier: state.carrier }), pose);
    const drag = m.weapon.ballistics.dragPerSecond;
    const inheritedTravel = travelFactor(flightTime, drag);
    const relativeAim: Vec3 = [aim[0] - inheritedVelocity[0] * inheritedTravel,
      aim[1] - inheritedVelocity[1] * inheritedTravel, aim[2] - inheritedVelocity[2] * inheritedTravel];
    const solution = solveBallistic(midpoint, relativeAim, m.weapon.muzzleSpeed, drag);
    if (!solution) { reachable = false; desiredTrain = state.train; desiredElevation = state.elevation; break; }
    flightTime = solution.time;
    const direction = normalize(sub(worldToLocal(add([pose.x, pose.y, pose.z], solution.direction), pose), [0, 0, 0]));
    desiredTrain = wrapAngle(Math.atan2(direction[0], -direction[2]) - radians(m.bearingDeg) - (state.carrier?.heading ?? 0));
    desiredElevation = Math.asin(clamp(direction[1], -1, 1));
  }
  state.aimCache = reachable && aim ? { time: flightTime, train: desiredTrain, elevation: desiredElevation, point: [...aim] } : undefined;
  const w = m.weapon, [minimumTrain, maximumTrain] = gunTraverseLimitsDeg(m).map(radians);
  const train = clamp(desiredTrain, minimumTrain, maximumTrain), elevation = clamp(desiredElevation, radians(w.elevationMinDeg), radians(w.elevationMaxDeg));
  // Traverse through the permitted interval; never shortcut across the forbidden stern sector.
  const next = {
    train: state.train + clamp(train - state.train, -radians(w.traverseRateDeg) * dt * workRate, radians(w.traverseRateDeg) * dt * workRate),
    elevation: state.elevation + clamp(elevation - state.elevation, -radians(w.elevationRateDeg) * dt * workRate, radians(w.elevationRateDeg) * dt * workRate),
  };
  const mountIndex = definition.mountClearance ? definition.mounts.findIndex(other => other.id === m.id) : 0;
  let motionClear = moveMountWithClearance(definition, mountIndex, state, next, mountedStates);
  if (!motionClear) {
    // A blocked elevation must not prevent traversing away from a platform.
    moveMountWithClearance(definition, mountIndex, state, { train: next.train, elevation: state.elevation }, mountedStates);
    moveMountWithClearance(definition, mountIndex, state, { train: state.train, elevation: next.elevation }, mountedStates);
    motionClear = Math.abs(state.train-next.train)<1e-9 && Math.abs(state.elevation-next.elevation)<1e-9;
  }
  // Readiness depends on the actual barrel path, even while tracking an unreachable reticle.
  const previousObstruction = barrelObstructions.get(state);
  const carried = carriedMounts(definition);
  const unchanged = !m.parentMountId && previousObstruction?.definition === definition && previousObstruction.mount === m
    && previousObstruction.train === state.train && previousObstruction.elevation === state.elevation
    && (!carried.length || previousObstruction.carriers.every((train, i) => train === (mountedStates?.[i].train ?? 0)));
  const trains = !unchanged && carried.length ? definition.mounts.map((_, i) => mountedStates?.[i].train ?? 0) : [];
  const breech = add(mountPosition(m, state), [0, w.pivotHeight, 0]);
  let obstructed = unchanged ? previousObstruction.blocked : false;
  for (let barrel = 0; !unchanged && barrel < w.barrelCount && !obstructed; barrel++) {
    const muzzle = muzzleLocal(m, state, barrel);
    const direction = normalize(sub(muzzle, breech));
    const beyond: Vec3 = [muzzle[0] + direction[0] * definition.hull.length,
      muzzle[1] + direction[1] * definition.hull.length, muzzle[2] + direction[2] * definition.hull.length];
    obstructed = obstructionTree(definition).intersects(breech, beyond, m.id);
    for (const index of carried) {
      const child = definition.mounts[index];
      if (obstructed || child.id === m.id) continue;
      const frame = mountFrame(definition, index, trains), from = worldToLocal(breech, frame), to = worldToLocal(beyond, frame);
      obstructed = gunMountObstructions({ ...child, position: [0, 0, 0] }).some(entry => segmentIntersectsBox(from, to, entry.box));
    }
  }
  // Obstructions are fixed in hull coordinates. Ship motion, reload and recoil
  // cannot change this test; any actual traverse/elevation change recomputes it.
  if (!unchanged) barrelObstructions.set(state, { definition, mount: m, train: state.train, elevation: state.elevation, blocked: obstructed, carriers: trains });
  if (obstructed || !motionClear) { state.status = 'blocked'; return false; }
  if (!reachable) { state.status = 'out-of-range'; return false; }
  if (desiredTrain < minimumTrain - 1e-6 || desiredTrain > maximumTrain + 1e-6 || desiredElevation < radians(w.elevationMinDeg) - 1e-6 || desiredElevation > radians(w.elevationMaxDeg) + 1e-6) { state.status = 'out-of-arc'; return false; }
  // A small angular tolerance is shared by firing and the HUD via this status.
  if (Math.abs(desiredTrain - state.train) >= .0015 || Math.abs(desiredElevation - state.elevation) >= .0008) { state.status = 'turning'; return false; }
  state.status = state.reload > 0 ? 'reloading' : 'ready';
  return true;
}
