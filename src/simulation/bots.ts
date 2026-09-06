import type { Vec3 } from '../ships/blueprint';
import type { FleetActor } from './battle';
import { motionVelocity, type HelmCommand } from './ship';
import { add, clamp, localToWorld, scale, sub, wrapAngle } from './geometry';
import { muzzleCenterWorld, solveBallistic, type MountDefinition, type MountState } from './weapons';
import { torpedoIntercept } from './torpedoes';

export const shipVelocity = (actor: FleetActor): Vec3 => motionVelocity(actor.motion);
/** Provisional bot engagement limits, in meters; small AA fittings wait for close range. */
export const botGunRange = (mount: MountDefinition): number => mount.weapon.caliberM >= .2 ? 18000 : mount.weapon.caliberM >= .1 ? 8000 : mount.weapon.caliberM >= .03 ? 3500 : 1800;
const distance = (a: FleetActor, b: FleetActor) => Math.hypot(a.motion.x - b.motion.x, a.motion.z - b.motion.z);

/** Stable nearest-opponent selection, with hysteresis to prevent target flicker. */
export function botTarget(actor: FleetActor, actors: readonly FleetActor[]): FleetActor | undefined {
  const enemies = actors.filter(other => other.team !== actor.team && !other.damage.sunk);
  const nearest = enemies.reduce<FleetActor | undefined>((best, other) => !best || distance(actor, other) < distance(actor, best) ? other : best, undefined);
  const previous = enemies.find(other => other.motion.id === actor.targetId);
  return previous && nearest && distance(actor, previous) <= distance(actor, nearest) * 1.25 ? previous : nearest;
}

/** Close at an angle, then hold a broadside while making room for nearby hulls. */
export function botHelm(actor: FleetActor, target: FleetActor | undefined, actors: readonly FleetActor[]): HelmCommand {
  if (!target || actor.damage.sunk) return { throttle: 0, rudder: 0 };
  const range = distance(actor, target);
  const bearing = Math.atan2(target.motion.x - actor.motion.x, actor.motion.z - target.motion.z);
  const side = wrapAngle(actor.motion.heading - bearing) >= 0 ? 1 : -1;
  let heading = bearing + side * (range > 4200 ? Math.PI / 3 : range < 2200 ? Math.PI * .7 : Math.PI / 2);
  const tubes = (actor.definition.torpedoTubes ?? []).filter((t, i) => (actor.torpedoTubes?.[i].ammo ?? 0) > 0 && actor.damage.modules.find(m => m.id === t.magazineId)?.hp !== 0);
  if (tubes.length) {
    const tube = tubes.reduce((a, b) => Math.abs(wrapAngle(bearing - actor.motion.heading - b.bearingDeg * Math.PI / 180)) < Math.abs(wrapAngle(bearing - actor.motion.heading - a.bearingDeg * Math.PI / 180)) ? b : a);
    const aim = torpedoIntercept(localToWorld(tube.position, actor.motion), [target.motion.x, 0, target.motion.z], shipVelocity(target), tube.weapon.speed);
    heading = (aim ? Math.atan2(aim[0] - actor.motion.x, actor.motion.z - aim[2]) : bearing) - tube.bearingDeg * Math.PI / 180;
  }
  let x = Math.sin(heading), z = -Math.cos(heading);
  for (const other of actors) {
    if (other === actor || other.motion.y < -20) continue;
    const separation = distance(actor, other);
    const clearance = (actor.definition.hull.length + other.definition.hull.length) / 2 + 180;
    if (separation > 0 && separation < clearance) {
      const weight = (1 - separation / clearance) * 4;
      x += (actor.motion.x - other.motion.x) / separation * weight;
      z += (actor.motion.z - other.motion.z) / separation * weight;
    }
  }
  heading = Math.atan2(x, -z);
  return { throttle: range > 4200 ? .75 : .5,
    rudder: clamp(wrapAngle(heading - actor.motion.heading) * 2 - actor.motion.yawRate * 5, -1, 1) };
}

/** Predict a moving target separately for every caliber and muzzle position. */
export function botAim(actor: FleetActor, target: FleetActor, mount: MountDefinition, state: MountState): Vec3 {
  const point = localToWorld([0, .8, 0], target.motion);
  point[1] = Math.max(.5, point[1]);
  const from = muzzleCenterWorld(mount, state, actor.motion);
  const velocity = shipVelocity(target), inherited = shipVelocity(actor);
  let time = Math.hypot(point[0] - from[0], point[2] - from[2]) / mount.weapon.muzzleSpeed;
  for (let i = 0; i < 3; i++) {
    const solution = solveBallistic(from, add(point, scale(sub(velocity, inherited), time)), mount.weapon.muzzleSpeed);
    if (!solution) break;
    time = solution.time;
  }
  return add(point, scale(velocity, time));
}

/** Conservatively hold fire when a friendly hull occupies the firing lane. */
export function clearFiringLane(actor: FleetActor, target: FleetActor, actors: readonly FleetActor[]): boolean {
  const dx = target.motion.x - actor.motion.x, dz = target.motion.z - actor.motion.z;
  const squaredRange = dx * dx + dz * dz;
  if (squaredRange < 1) return false;
  return !actors.some(other => {
    if (other === actor || other.team !== actor.team || other.motion.y < -20) return false;
    const along = ((other.motion.x - actor.motion.x) * dx + (other.motion.z - actor.motion.z) * dz) / squaredRange;
    if (along <= 0 || along >= 1) return false;
    return Math.hypot(other.motion.x - actor.motion.x - along * dx, other.motion.z - actor.motion.z - along * dz) < other.definition.hull.length / 2 + 35;
  });
}
