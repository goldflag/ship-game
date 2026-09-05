import type { ShipDefinition, Vec3 } from '../ships/blueprint';
import { add, localToWorld, normalize, scale, segmentBox, worldToLocal, type Pose } from '../simulation/geometry';

const MAX_AIM_DISTANCE = 30000;

/** CPU geometry only: the rendered ocean never chooses a gameplay aim point. */
type AimTarget = { pose: Pose; armor: ShipDefinition['armor'] };
export function sightAim(origin: Vec3, direction: Vec3, target?: AimTarget | AimTarget[]): Vec3 {
  const ray = normalize(direction);
  const seaDistance = ray[1] < -1e-6 ? (.5 - origin[1]) / ray[1] : Infinity;
  const distance = Math.min(MAX_AIM_DISTANCE, seaDistance > 0 ? seaDistance : Infinity);
  const end = add(origin, scale(ray, distance));
  const targets = target ? Array.isArray(target) ? target : [target] : [];
  const hits = targets.flatMap(candidate => {
    const from = worldToLocal(origin, candidate.pose), to = worldToLocal(end, candidate.pose);
    return candidate.armor.flatMap(volume => {
      const hit = segmentBox(from, to, volume);
      return hit ? [{ t: hit.t, point: localToWorld(hit.point, candidate.pose) }] : [];
    });
  }).sort((a, b) => a.t - b.t);
  if (hits[0]) return hits[0].point;
  return [end[0], .5, end[2]];
}
