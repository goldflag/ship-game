import type { ConstructionCatalog, ConstructionEquipment, ConstructionEquipmentPart, ConstructionSource, Vec3 } from '../../ships/blueprint';
import { pathWorldPoint } from '../../ships/constructionPaths';
import { pathDistance } from '../../../assets/parts/construction/path_geometry';
import { gridCoordinate } from './editorNumbers';

/** Keep pending clicks outside source/history until the complete route is accepted. */
export function appendPathPoint(points: readonly Vec3[], point: Vec3): Vec3[] {
  if (points.length >= 64 || points.length && pathDistance(points.at(-1)!, point) < .05) return points.slice();
  return [...points, [...point]];
}
export function pathEquipment(id: string, partId: string, points: readonly Vec3[], slackM = 0, bearingDeg = 0): ConstructionEquipment {
  const position = [...points[0]] as Vec3;
  const r=bearingDeg*Math.PI/180,c=Math.cos(r),s=Math.sin(r);
  return { id, partId, position, bearingDeg, path: { points: points.map(p => { const q=p.map((v,k)=>v-position[k]);return [q[0]*c+q[2]*s,q[1],-q[0]*s+q[2]*c] as Vec3; }), slackM } };
}
/** Hull clicks retain the exact supporting plane. Equipment clicks choose only
 * the fitting's declared support/rigging socket, never arbitrary model geometry. */
export function pathAnchor(part: ConstructionEquipmentPart, source: ConstructionSource, catalog: ConstructionCatalog, hit: { id?: string; point: Vec3; normal?: Vec3; axis: 0 | 1 | 2 }, step: number | null): Vec3 | undefined {
  const profile = part.path;
  if (!profile) return undefined;
  const fitting = source.construction.equipment.find(item => item.id === hit.id);
  if (fitting) {
    if (profile.kind === 'railing' || profile.kind === 'ladder') return undefined;
    const support = catalog.equipment.find(p => p.id === fitting.partId);
    if (!support || support.path) return undefined;
    return support.sockets?.filter(s => s.id !== 'attachment' && (s.kind === 'support' || s.kind === 'rigging')).map(s => pathWorldPoint(fitting, s.position)).sort((a, b) => pathDistance(a, hit.point) - pathDistance(b, hit.point))[0];
  }
  if (!source.construction.primitives.some(p => p.id === hit.id)) return undefined;
  const normal = hit.normal ?? [0, 1, 0], point = hit.point.map((v, k) => k === hit.axis ? v : gridCoordinate(v, step)) as Vec3;
  if(profile.kind === 'ladder' && Math.abs(normal[1]) >= .9) return undefined;
  const error = normal.reduce((sum, v, k) => sum + v * (point[k] - hit.point[k]), 0);
  point[hit.axis] -= error / (normal[hit.axis] || 1);
  const radius = profile.kind === 'railing' || profile.kind === 'ladder' ? 0 : profile.diameterM * (profile.kind === 'chain' ? 2 : .5);
  return point.map((v, k) => v + normal[k] * radius) as Vec3;
}
