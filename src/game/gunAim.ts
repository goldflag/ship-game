import type { Battery, ShipDefinition, Vec3 } from '../ships/blueprint';
import type { Combatant } from '../simulation/damage';
import { add, scale } from '../simulation/geometry';
import { motionVelocity } from '../simulation/ship';
import { GRAVITY, muzzleWorld, shotDirection, type MountState } from '../simulation/weapons';

export interface GunAimPoint {
  id: string; number: number; name: string; point: Vec3;
  aligned: boolean; status: MountState['status']; reload: number;
}

/** Preview the current barrels at sight range, or sea level if the round falls short.
 * Uses the same muzzle, velocity and gravity as firing; never advances combat.
 */
export function gunAimPoints(actor: Combatant, definition: ShipDefinition, battery: Battery, aim: Vec3): GunAimPoint[] {
  let number = 0;
  return definition.mounts.flatMap((mount, i) => {
    if (mount.battery !== battery) return [];
    const state = actor.mounts[i], count = mount.weapon.barrelCount ?? 2;
    let origin: Vec3 = [0, 0, 0];
    for (let barrel = 0; barrel < count; barrel++) origin = add(origin, scale(muzzleWorld(mount, state, barrel, actor.motion), 1 / count));
    const velocity = add(scale(shotDirection(mount, state, actor.motion), mount.weapon.muzzleSpeed), motionVelocity(actor.motion));
    const range = Math.hypot(aim[0] - origin[0], aim[2] - origin[2]);
    const seaTime = (velocity[1] + Math.sqrt(velocity[1] ** 2 + 2 * GRAVITY * Math.max(0, origin[1]))) / GRAVITY;
    const time = Math.min(60, seaTime, range / Math.max(.001, Math.hypot(velocity[0], velocity[2])));
    const point = add(origin, add(scale(velocity, time), [0, -.5 * GRAVITY * time * time, 0]));
    point[1] = Math.max(0, point[1]);
    const error = Math.hypot(point[0] - aim[0], point[1] - aim[1], point[2] - aim[2]);
    return [{ id: mount.id, number: ++number, name: mount.name, point,
      aligned: error <= Math.max(1, range * .002), status: state.status, reload: state.reload }];
  });
}
