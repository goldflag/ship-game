import { structuralHits, structuralSurfaces } from '../simulation/structure';
import { plateHit, segmentPlate } from '../simulation/protection';
import { segmentIntersectsBox } from '../simulation/obstruction';
import type { ShipDefinition, Vec3, Volume } from '../ships/blueprint';
import { add, localToWorld, normalize, scale, segmentBox, worldToLocal, type Pose } from '../simulation/geometry';

const MAX_AIM_DISTANCE = 30000;

/** Underwater rays need not meet the surface. A manual torpedo course ends at
 * the weapon's run limit, so an empty underwater sight can still order a shot. */
export function torpedoCourseAim(point: Vec3, ship: { x: number; z: number }, rangeM: number): Vec3 {
  const dx = point[0] - ship.x, dz = point[2] - ship.z, range = Math.hypot(dx, dz);
  const distance = Math.min(range, rangeM * .98);
  return range > 0 ? [ship.x + dx / range * distance, point[1], ship.z + dz / range * distance] : point;
}

/** CPU geometry only: the rendered ocean never chooses a gameplay aim point. */
type AimTarget = { pose: Pose; armor: ShipDefinition['armor']; definition?: ShipDefinition; trains?: number[] };
const aimBounds = new WeakMap<ShipDefinition, Pick<Volume, 'center' | 'size'>>();
/** Enclose every CPU aim surface, including the full sweep of trained armor. */
function targetBounds(def: ShipDefinition): Pick<Volume, 'center' | 'size'> {
  const cached = aimBounds.get(def);
  if (cached) return cached;
  const low: Vec3 = [Infinity, Infinity, Infinity], high: Vec3 = [-Infinity, -Infinity, -Infinity];
  const include = (center: Vec3, half: Vec3) => {
    for (let axis = 0; axis < 3; axis++) {
      low[axis] = Math.min(low[axis], center[axis] - half[axis]);
      high[axis] = Math.max(high[axis], center[axis] + half[axis]);
    }
  };
  for (const armor of def.armor) {
    const mount = armor.plate?.mountId && def.mounts.find(m => m.id === armor.plate!.mountId);
    if (mount) {
      const radius = Math.hypot(Math.abs(armor.center[0]) + armor.size[0] / 2, Math.abs(armor.center[2]) + armor.size[2] / 2);
      include([mount.position[0], mount.position[1] + armor.center[1], mount.position[2]], [radius, armor.size[1] / 2, radius]);
    } else include(armor.center, armor.size.map(n => n / 2) as Vec3);
  }
  for (const surface of structuralSurfaces(def)) include(surface.center, surface.size.map(n => n / 2) as Vec3);
  const result = { center: low.map((n, i) => (n + high[i]) / 2) as Vec3,
    // Preserve the narrow phase's edge and endpoint tolerances.
    size: low.map((n, i) => high[i] - n + .02) as Vec3 };
  aimBounds.set(def, result);
  return result;
}

export function sightAim(origin: Vec3, direction: Vec3, target?: AimTarget | AimTarget[]): Vec3 {
  const ray = normalize(direction);
  const seaDistance = ray[1] < -1e-6 ? (.5 - origin[1]) / ray[1] : Infinity;
  const distance = Math.min(MAX_AIM_DISTANCE, seaDistance > 0 ? seaDistance : Infinity);
  const end = add(origin, scale(ray, distance));
  const targets = target ? Array.isArray(target) ? target : [target] : [];
  let nearest: { t: number; point: Vec3; pose: Pose } | undefined;
  for (const candidate of targets) {
    const from = worldToLocal(origin, candidate.pose), to = worldToLocal(end, candidate.pose);
    if (candidate.definition && candidate.armor === candidate.definition.armor &&
      !segmentIntersectsBox(from, to, targetBounds(candidate.definition))) continue;
    for (const volume of candidate.armor) {
      const hit = !volume.plate ? segmentBox(from, to, volume)
        : candidate.definition ? plateHit(from, to, volume, candidate.definition, candidate.trains ?? candidate.definition.mounts.map(() => 0))
        : volume.plate.mountId ? null : segmentPlate(from, to, volume.plate.vertices);
      if (hit && (!nearest || hit.t < nearest.t)) nearest = { t: hit.t, point: hit.point, pose: candidate.pose };
    }
    if (candidate.definition) for (const hit of structuralHits(from, to, candidate.definition)) {
      if (!nearest || hit.t < nearest.t) nearest = { t: hit.t, point: hit.point, pose: candidate.pose };
    }
  }
  if (nearest) return localToWorld(nearest.point, nearest.pose);
  return [end[0], .5, end[2]];
}
