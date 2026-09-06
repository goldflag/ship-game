import type { Battery, ShipDefinition, Vec3 } from '../ships/blueprint';
import type { Combatant } from '../simulation/damage';
import { add, scale } from '../simulation/geometry';
import { motionVelocity } from '../simulation/ship';
import { muzzleCenterWorld, shotDirection, type MountState } from '../simulation/weapons';
import { ballisticStep } from '../simulation/ballistics';

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
    const state = actor.mounts[i], origin = muzzleCenterWorld(mount, state, actor.motion);
    const velocity = add(scale(shotDirection(mount, state, actor.motion), mount.weapon.muzzleSpeed), motionVelocity(actor.motion));
    const range = Math.hypot(aim[0] - origin[0], aim[2] - origin[2]);
    const drag = mount.weapon.ballistics?.dragPerSecond ?? 0;
    const factor = range / Math.max(.001, Math.hypot(velocity[0], velocity[2]));
    const rangeTime = drag > 1e-8 ? (factor * drag >= 1 ? Infinity : -Math.log1p(-factor * drag) / drag) : factor;
    let low = 0, high = Math.min(180, rangeTime);
    if (ballisticStep(origin, velocity, high, drag).position[1] < 0) {
      for (let i = 0; i < 28; i++) {
        const mid = (low + high) / 2;
        if (ballisticStep(origin, velocity, mid, drag).position[1] >= 0) low = mid; else high = mid;
      }
    }
    const point = ballisticStep(origin, velocity, high, drag).position;
    point[1] = Math.max(0, point[1]);
    return [{ id: mount.id, number: ++number, name: mount.name, point,
      aligned: state.status === 'ready' || state.status === 'reloading', status: state.status, reload: state.reload }];
  });
}
