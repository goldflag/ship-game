import type { Armor, ShipDefinition, Vec3 } from '../ships/blueprint';
import { add, dot, localToWorld, normalize, rotate, scale, segmentOverlapsBox, sub, worldToLocal } from './geometry';
import { mountFrame } from './mountFrames';

const cross = (a: Vec3, b: Vec3): Vec3 => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
/** Intersect the mid-surface once. Thickness is consumed along the incidence normal.
 * Starting on a plate only produces a hit when moving through it; visited IDs dedupe ticks. */
export function segmentPlate(from: Vec3, to: Vec3, vertices: Vec3[]) {
  const normal = normalize(cross(sub(vertices[1], vertices[0]), sub(vertices[2], vertices[0])));
  const delta = sub(to, from), denominator = dot(normal, delta);
  if (Math.abs(denominator) < 1e-10) return null;
  const t = dot(normal, sub(vertices[0], from)) / denominator;
  if (t < -1e-9 || t > 1+1e-9) return null;
  const point = add(from, scale(delta, Math.max(0, Math.min(1,t))));
  let onEdge = false;
  for (let i=0; i<vertices.length; i++) {
    const side = dot(cross(sub(vertices[(i+1)%vertices.length], vertices[i]), sub(point, vertices[i])), normal);
    if (side < -1e-7) return null;
    onEdge ||= Math.abs(side) < 1e-7;
  }
  return { t: Math.max(0, Math.min(1,t)), point, normal, onEdge };
}
export function plateHit(from: Vec3, to: Vec3, armor: Armor, def: ShipDefinition, trains: number[]) {
  if (!armor.plate) return null;
  const index = armor.plate.mountId ? def.mounts.findIndex(m => m.id === armor.plate!.mountId) : -1;
  if (index < 0) return segmentOverlapsBox(from, to, armor) ? segmentPlate(from, to, armor.plate.vertices) : null;
  const pose = mountFrame(def, index, trains);
  const a = worldToLocal(from, pose), b = worldToLocal(to, pose);
  const hit = segmentOverlapsBox(a, b, armor) ? segmentPlate(a, b, armor.plate.vertices) : null;
  return hit ? { ...hit, point:localToWorld(hit.point,pose), normal:rotate(hit.normal,pose) } : null;
}