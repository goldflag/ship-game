import type { Armor, ShipDefinition, Vec3 } from '../ships/blueprint';
import { add, dot, localToWorld, normalize, radians, rotate, scale, sub, worldToLocal } from './geometry';

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
/** Neighboring coplanar polygons share a seam, not a second physical armor layer. */
export function samePlateSeam(a: { point:Vec3; normal:Vec3; onEdge?:boolean }, b: { point:Vec3; normal:Vec3; onEdge?:boolean }, joinedSurface = false) {
  return a.onEdge && b.onEdge && (joinedSurface || Math.abs(dot(a.normal,b.normal)) > 1-1e-8) && a.point.every((n,i)=>Math.abs(n-b.point[i]) < 1e-6);
}
export function plateHit(from: Vec3, to: Vec3, armor: Armor, def: ShipDefinition, trains: number[]) {
  if (!armor.plate) return null;
  const index = def.mounts.findIndex(m => m.id === armor.plate!.mountId);
  if (index < 0) return segmentPlate(from, to, armor.plate.vertices);
  const m = def.mounts[index];
  const pose = { x:m.position[0], y:m.position[1], z:m.position[2], heading:radians(m.bearingDeg)+trains[index], roll:0, pitch:0 };
  const hit = segmentPlate(worldToLocal(from, pose), worldToLocal(to, pose), armor.plate.vertices);
  return hit ? { ...hit, point:localToWorld(hit.point,pose), normal:rotate(hit.normal,pose) } : null;
}
/** Read-only probe used by validation and local inspection artifacts. */
export function protectionTrace(from: Vec3, to: Vec3, def: ShipDefinition, trains=def.mounts.map(() => 0)) {
  const direction=normalize(sub(to,from));
  const hits=def.armor.flatMap(a => {
    const hit=plateHit(from,to,a,def,trains);
    if (!hit) return [];
    const cosine=Math.abs(dot(direction,hit.normal));
    return [{ id:a.id, name:a.name, ...hit, surfaceId:a.plate!.surfaceId, thicknessMm:a.thicknessMm, material:a.plate!.material, resistanceMm:a.plate!.material==='teak' ? 0 : a.thicknessMm/Math.max(.2,cosine), ricochet:cosine<.2 }];
  }).sort((a,b)=>a.t-b.t || b.resistanceMm-a.resistanceMm || a.id.localeCompare(b.id));
  return hits.filter((hit,i)=>!hits.slice(0,i).some(previous=>previous.material===hit.material && samePlateSeam(previous,hit, !!hit.surfaceId && hit.surfaceId === previous.surfaceId)));
}
