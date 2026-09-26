import { surfaceGunAllowed } from '../ships/armament';
import { selectedWeapon } from '../ships/weaponGroups';
import type { Battery, ShipDefinition, Vec3 } from '../ships/blueprint';
import { add, scale } from './geometry';
import { motionVelocity } from './session/motion';
import { SHELL_PACE } from '../ships/mobility';
import { supportPerformance } from './machinery';
import { ballisticStep } from './ballistics';
import type { Combatant, MountState } from '../game/session/elements';
import { muzzleCenterWorld, shotDirection } from './mountGeometry';

export interface GunAimPoint {
  id: string; number: number; name: string; point: Vec3;
  aligned: boolean; status: MountState['status']; reload: number;
}

// A round still climbing when it reaches the aim's range falls far beyond it.
// Draw it there only once it clears the aim by more than a superstructure, so
// flat fire just over a close, high aim point stays on that point.
const PASS_OVER_M = 30;

/** Preview the current barrels at sight range, at sea level if the round falls
 * short, or where it comes back down to the aim's height if it passes over.
 * Uses the same muzzle, velocity and gravity as firing; never advances combat.
 */
export function gunAimPoints(actor: Combatant, definition: ShipDefinition, battery: Battery, aim: Vec3, weaponGroupId?: string): GunAimPoint[] {
  let number = 0;
  const workRate = .25 + .75 * supportPerformance(actor, definition).power;
  return definition.mounts.flatMap((mount, i) => {
    if (!surfaceGunAllowed(definition, mount.weapon) || !selectedWeapon(mount.battery, mount.weapon, battery, weaponGroupId)) return [];
    const state = actor.mounts[i], origin = muzzleCenterWorld(mount, state, actor.motion);
    const velocity = add(scale(shotDirection(mount, state, actor.motion), mount.weapon.muzzleSpeed), scale(motionVelocity(actor.motion), 1 / SHELL_PACE));
    const range = Math.hypot(aim[0] - origin[0], aim[2] - origin[2]);
    const drag = mount.weapon.ballistics?.dragPerSecond ?? 0;
    const factor = range / Math.max(.001, Math.hypot(velocity[0], velocity[2]));
    const rangeTime = drag > 1e-8 ? (factor * drag >= 1 ? Infinity : -Math.log1p(-factor * drag) / drag) : factor;
    // Barrels still laid for a longer range would otherwise put the circle in
    // the sky above a nearer aim until they depress.
    const at = (seconds: number) => ballisticStep(origin, velocity, seconds, drag);
    let low = 0, high = Math.min(180, rangeTime), level = 0;
    const reach = at(high), over = reach.position[1] - aim[1];
    if (over > 0 && (reach.velocity[1] <= 0 || over > PASS_OVER_M)) [low, high, level] = [high, 180, aim[1]];
    if (at(high).position[1] < level) {
      for (let i = 0; i < 28; i++) {
        const mid = (low + high) / 2;
        if (at(mid).position[1] >= level) low = mid; else high = mid;
      }
    }
    const point = at(high).position;
    point[1] = Math.max(0, point[1]);
    return [{ id: mount.id, number: ++number, name: mount.name, point,
      aligned: state.status === 'ready' || state.status === 'reloading', status: state.status, reload: state.reload / workRate }];
  });
}
