import { PerspectiveCamera, Vector3 } from 'three/webgpu';
import type { Vec3 } from '../ships/blueprint';
import { localToWorld, worldToLocal } from './geometry';
import { segmentIntersectsBox } from './obstruction';
import { landHeight, type Island } from '../maps/catalog';
import type { RangeObservation } from './Rangefinder';

export interface RangeTarget {
  id: string;
  name: string;
  position: Vec3;
  heading: number;
  length: number;
  beam: number;
  height: number;
}
export interface SightObservation extends RangeObservation { sightDistance: number }
export const rangingRadius = (width: number, height: number): number => Math.min(80, Math.max(32, Math.min(width, height) * .07));

/** Generous screen-space hull bounds, so a distant ship need not occupy the exact
 * center pixel. World distances always come from admitted CPU poses/reports. */
export function observeRangeTarget(target: RangeTarget, camera: PerspectiveCamera, ship: { x: number; z: number }, width: number, height: number): SightObservation | undefined {
  const [x, y, z] = target.position;
  if (camera.position.y <= .5 || y + target.height <= .5) return;
  const rangeM = Math.hypot(x - ship.x, z - ship.z);
  if (rangeM < 1 || rangeM > 30000) return;
  const pose = { x, y, z, heading: target.heading, pitch: 0, roll: 0 };
  let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
  for (const dx of [-target.beam / 2, target.beam / 2]) for (const dz of [-target.length / 2, target.length / 2]) for (const dy of [Math.max(.5 - y, 0), target.height]) {
    const point = new Vector3(...localToWorld([dx, dy, dz], pose));
    if (point.clone().applyMatrix4(camera.matrixWorldInverse).z >= -camera.near) continue;
    point.project(camera);
    const sx = point.x * width / 2, sy = point.y * height / 2;
    left = Math.min(left, sx); right = Math.max(right, sx);
    top = Math.min(top, sy); bottom = Math.max(bottom, sy);
  }
  if (right < -width / 2 || left > width / 2 || bottom < -height / 2 || top > height / 2 || !Number.isFinite(left)) return;
  const sightDistance = Math.hypot(Math.max(left, -right, 0), Math.max(top, -bottom, 0));
  return { id: target.id, name: target.name, rangeM, sightDistance, nearSight: sightDistance <= rangingRadius(width, height) };
}

/** Land and intervening hulls block optical observations. Test multiple heights
 * so a visible bridge can still be ranged when the waterline is concealed. */
export function rangeTargetVisible(target: RangeTarget, origin: Vec3, targets: readonly RangeTarget[], islands: readonly Island[]): boolean {
  const dx = target.position[0] - origin[0], dz = target.position[2] - origin[2], distance = Math.hypot(dx, dz);
  // Most optical paths stay in the shipping lane. Skip distant islands before
  // sampling their detailed terrain along a long-range sight line.
  const nearbyIslands = islands.filter(island => {
    const t = Math.max(0, Math.min(1, ((island.x - origin[0]) * dx + (island.z - origin[2]) * dz) / Math.max(1, distance ** 2)));
    return Math.hypot(origin[0] + dx * t - island.x, origin[2] + dz * t - island.z) <= Math.hypot(island.rx, island.rz) * 2;
  });
  return [.45, .9].some(fraction => {
    const end: Vec3 = [target.position[0], target.position[1] + target.height * fraction, target.position[2]];
    if (end[1] <= .5) return false;
    const steps = Math.max(1, Math.ceil(distance / 50));
    if (nearbyIslands.length) for (let step = 1; step < steps; step++) {
      const t = step / steps;
      if (landHeight(nearbyIslands, origin[0] + (end[0] - origin[0]) * t, origin[2] + (end[2] - origin[2]) * t) >= origin[1] + (end[1] - origin[1]) * t) return false;
    }
    return !targets.some(other => {
      if (other.id === target.id) return false;
      const [x, y, z] = other.position;
      const pose = { x, y, z, heading: other.heading, pitch: 0, roll: 0 };
      return segmentIntersectsBox(worldToLocal(origin, pose), worldToLocal(end, pose), {
        center: [0, other.height / 2, 0], size: [other.beam, other.height, other.length],
      });
    });
  });
}

export function pickRangeTarget(targets: readonly RangeTarget[], camera: PerspectiveCamera, ship: { x: number; z: number }, width: number, height: number, islands: readonly Island[]): SightObservation | undefined {
  const observations = targets.flatMap(target => {
    const observation = observeRangeTarget(target, camera, ship, width, height);
    return observation?.nearSight ? [{ target, observation }] : [];
  }).sort((a, b) => a.observation.sightDistance - b.observation.sightDistance || a.observation.rangeM - b.observation.rangeM);
  return observations.find(({ target }) => rangeTargetVisible(target, camera.position.toArray(), targets, islands))?.observation;
}
