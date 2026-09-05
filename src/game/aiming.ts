import type { ShipDefinition, Vec3 } from '../ships/blueprint';
import { add, localToWorld, normalize, scale, segmentBox, worldToLocal, type Pose } from '../simulation/geometry';

const MAX_AIM_DISTANCE = 30000;

/** CPU geometry only: the rendered ocean never chooses a gameplay aim point. */
export function sightAim(origin: Vec3, direction: Vec3, target?: { pose: Pose; armor: ShipDefinition['armor'] }): Vec3 {
  const ray = normalize(direction);
  const seaDistance = ray[1] < -1e-6 ? (.5 - origin[1]) / ray[1] : Infinity;
  const distance = Math.min(MAX_AIM_DISTANCE, seaDistance > 0 ? seaDistance : Infinity);
  const end = add(origin, scale(ray, distance));
  if (target) {
    const from = worldToLocal(origin, target.pose), to = worldToLocal(end, target.pose);
    const hit = target.armor.map(volume => segmentBox(from, to, volume)).filter(h => h !== null).sort((a, b) => a.t - b.t)[0];
    if (hit) return localToWorld(hit.point, target.pose);
  }
  return [end[0], .5, end[2]];
}
