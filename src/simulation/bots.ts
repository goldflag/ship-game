import type { Ammunition, ShipDefinition, Vec3 } from '../ships/blueprint';
import type { FleetActor } from './battle';
import type { HelmCommand } from './ship';
import { add, clamp, localToWorld, scale, sub, wrapAngle } from './geometry';
import { availableAmmunition, muzzleWorld, solveBallistic, type MountDefinition, type MountState } from './weapons';
import { travelFactor } from './ballistics';

export const shipVelocity = (actor: FleetActor): Vec3 => [Math.sin(actor.motion.heading) * actor.motion.speed, 0, -Math.cos(actor.motion.heading) * actor.motion.speed];
/** Provisional bot engagement limits, in meters; small AA fittings wait for close
 * range. Out-of-range mounts hold their train and acquire when entering range. */
export const botGunRange = (mount: MountDefinition): number => mount.weapon.caliberM >= .2 ? 18000 : mount.weapon.caliberM >= .1 ? 8000 : mount.weapon.caliberM >= .03 ? 3500 : 1800;
const distance = (a: FleetActor, b: FleetActor) => Math.hypot(a.motion.x - b.motion.x, a.motion.z - b.motion.z);
const shellProtection = new WeakMap<ShipDefinition, number>();
/** Simple ammunition doctrine from authored protection, never from ship names. */
export function botAmmunition(target: FleetActor, mount: MountDefinition, state: MountState): Ammunition {
  let protection = shellProtection.get(target.definition);
  if (protection === undefined) {
    protection = Math.max(0, ...target.definition.armor.filter(a => a.exterior || a.plate?.exterior).map(a => a.thicknessMm));
    shellProtection.set(target.definition, protection);
  }
  const preferred = mount.weapon.he && (mount.weapon.caliberM < .2 || protection < 80) ? 'he' : 'ap';
  const count = mount.weapon.barrelCount ?? 2;
  if (availableAmmunition(state, preferred) >= count) return preferred;
  return preferred === 'ap' && mount.weapon.he && availableAmmunition(state, 'he') >= count ? 'he' : 'ap';
}

/** Stable nearest-opponent selection, with hysteresis to prevent target flicker. */
export function botTarget(actor: FleetActor, actors: readonly FleetActor[]): FleetActor | undefined {
  const enemies = actors.filter(other => other.team !== actor.team && !other.damage.sunk && !other.damage.stability.combatLost);
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
  const exposed = state.loaded === 'he' ? target.definition.mounts.reduce<number>((best, m, i) => target.mounts[i].hp > 0 && (best < 0 || m.weapon.armorMm < target.definition.mounts[best].weapon.armorMm) ? i : best, -1) : -1;
  const gun = target.definition.mounts[exposed];
  const point = localToWorld(gun ? [gun.position[0], gun.position[1] + gun.weapon.gunhouseSize[2] / 2, gun.position[2]] : [0, .8, 0], target.motion);
  point[1] = Math.max(.5, point[1]);
  const from = muzzleWorld(mount, state, 0, actor.motion);
  const velocity = shipVelocity(target), inherited = shipVelocity(actor);
  const cache = state.leadCache && Math.hypot(...sub(point, state.leadCache.point)) < 10 ? state.leadCache : undefined;
  let time = cache?.time ?? Math.hypot(point[0] - from[0], point[2] - from[2]) / mount.weapon.muzzleSpeed;
  for (let i = 0; i < (cache ? 1 : 3); i++) {
    const drag = mount.weapon.ballistics?.dragPerSecond ?? 0;
    const solution = solveBallistic(from, sub(add(point, scale(velocity, time)), scale(inherited, travelFactor(time, drag))), mount.weapon.muzzleSpeed, drag);
    if (!solution) { state.leadCache = undefined; return add(point, scale(velocity, time)); }
    time = solution.time;
  }
  state.leadCache = { time, point: [...point] };
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
