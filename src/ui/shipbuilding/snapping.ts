import { installedWallPart } from '../../ships/constructionWallFittings';
import type { ConstructionCatalog, ConstructionEquipmentPart, ConstructionPrimitive, ConstructionSource, Vec3 } from '../../ships/blueprint';
import { cornerVertices, VERTEX_FACES, worldVertex } from '../../ships/constructionVertex';
import { customHullFaces, customHullPrimitive, makeHull } from '../../ships/customHullModel';
import { CONSTRUCTION_SHAPES } from '../../ships/constructionShapes';
import { attachmentOffset, rotateY } from './placement';
import { add, sub, mul, dot, cross, shapedFaces } from '../../ships/freeformShape';

export interface SnapSettings { enabled: boolean; grid: boolean; centerline: boolean; geometry: boolean; guides: boolean; showCenterline: boolean }
export const DEFAULT_SNAPPING: SnapSettings = { enabled: true, grid: true, centerline: true, geometry: true, guides: true, showCenterline: true };
export interface SnapFeature { wallFrame?: boolean; id: string; owner: string; point: Vec3; kind: 'center' | 'corner' | 'edge'; edge?: [Vec3, Vec3] }
export interface SnapGuide { id: string; axis: number; movingId: string; from: Vec3; to: Vec3; edge?: [Vec3, Vec3]; centerline: boolean; active: boolean }
export const SHIP_AXES: Vec3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
export type ProjectSnap = (point: Vec3) => [number, number] | undefined;
const midpoint = (a: Vec3, b: Vec3) => mul(add(a, b), .5);

/** Center and frame edges let differently sized windows align by their tops, sills or sides. */
export function wallFrameSnapFeatures(id: string, position: Vec3, bearing: number, part: Pick<ConstructionEquipmentPart, 'size' | 'boundsCenter' | 'sockets'>): SnapFeature[] {
  const z = part.sockets?.find(s => s.id === 'attachment')?.position[2] ?? 0;
  const point = (x: number, y: number) => add(position, rotateY([part.boundsCenter[0]+x*part.size[0], part.boundsCenter[1]+y*part.size[1], z], -bearing*Math.PI/180));
  const corners = [[-.5,-.5],[.5,-.5],[.5,.5],[-.5,.5]].map(([x,y])=>point(x,y));
  return [
    { id: `${id}:mount`, owner: id, wallFrame: true, point: point(0,0), kind: 'center' },
    ...corners.map((point,i): SnapFeature => ({ id: `${id}:corner:${i}`, owner:id, wallFrame: true, point, kind:'corner' })),
    ...corners.map((point,i): SnapFeature => ({ id: `${id}:edge:${i}`, owner:id, wallFrame: true, point:midpoint(point,corners[(i+1)%4]), kind:'edge', edge:[point,corners[(i+1)%4]] })),
  ];
}

/** Authoring edges only: no gun mesh triangles, barrel bounds or render dependencies. */
export function primitiveSnapFeatures(p: ConstructionPrimitive): SnapFeature[] {
  const actual = p.kind === 'custom-hull' && !p.customHull ? { ...customHullPrimitive(makeHull(0)), ...p } : p;
  const faces: Vec3[][] = actual.kind === 'custom-hull' ? customHullFaces(actual).map(f => f.vertices.map(v => add(p.position, rotateY(v, p.rotationDeg * Math.PI / 180))))
    : p.shaping ? shapedFaces(p).map(f => f.points.map(v => add(p.position, rotateY(v, p.rotationDeg * Math.PI / 180))))
    : p.kind === 'vertex' ? VERTEX_FACES.map(f => f.corners.map(i => worldVertex(p, cornerVertices(p)[i])))
    : CONSTRUCTION_SHAPES[p.kind].map(f => f.map(v => worldVertex(p, v)));
  const out: SnapFeature[] = [{ id: `${p.id}:center`, owner: p.id, point: p.position, kind: 'center' }];
  const key = (v: Vec3) => v.map(n => n.toFixed(6)).join(',');
  const edges = new Map<string, { edge: [Vec3, Vec3]; normals: Vec3[] }>();
  for (const face of faces) {
    const n = cross(sub(face[1], face[0]), sub(face[2], face[0])), length = Math.hypot(...n);
    if (length < 1e-9) continue;
    for (let i = 0; i < face.length; i++) {
      const a = face[i], b = face[(i + 1) % face.length], id = [key(a), key(b)].sort().join('/');
      const edge = edges.get(id) ?? { edge: [a, b], normals: [] };
      edge.normals.push(mul(n, 1 / length)); edges.set(id, edge);
    }
  }
  const seen = new Set<string>();
  for (const [id, { edge, normals }] of edges) {
    // Remove coplanar tessellation seams, retaining source corners and creases.
    if (normals.length > 1 && normals.every(n => Math.abs(dot(n, normals[0])) > .99999)) continue;
    out.push({ id: `${p.id}:e:${id}`, owner: p.id, point: midpoint(...edge), kind: 'edge', edge });
    for (const point of edge) if (!seen.has(key(point))) {
      seen.add(key(point)); out.push({ id: `${p.id}:v:${key(point)}`, owner: p.id, point, kind: 'corner' });
    }
  }
  return out;
}
export function constructionSnapFeatures(source: ConstructionSource, catalog: ConstructionCatalog): SnapFeature[] {
  const parts = new Map(catalog.equipment.map(p => [p.id, p]));
  const features = source.construction.primitives.flatMap(primitiveSnapFeatures);
  for (const item of source.construction.equipment) {
    const part = parts.get(item.partId); if (!part || part.path) continue;
    if (item.wall) { features.push(...wallFrameSnapFeatures(item.id, item.position, item.bearingDeg, installedWallPart(part, item))); continue; }
    features.push({ id: `${item.id}:mount`, owner: item.id, point: add(item.position, attachmentOffset(installedWallPart(part, item), item.bearingDeg)), kind: 'center' });
  }
  for (const wall of source.construction.boundaries) {
    const point: Vec3 = [0, 0, 0]; point['xyz'.indexOf(wall.axis)] = wall.offset;
    features.push({ id: `${wall.id}:center`, owner: wall.id, point, kind: 'center' });
  }
  return features;
}
function closest(point: Vec3, edge: [Vec3, Vec3]): Vec3 {
  const direction = sub(edge[1], edge[0]), length = dot(direction, direction);
  return add(edge[0], mul(direction, length ? Math.max(0, Math.min(1, dot(sub(point, edge[0]), direction) / length)) : 0));
}
const distance = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Resolve independent movement axes against raw pointer motion. Geometry wins over
 * grid on the same axis; screen-space acquisition/release radii avoid zoom surprises.
 * Directions may be ship axes or a freeform block's rotated local axes. */
export function resolveSnap(input: {
  raw: Vec3; grid: Vec3; directions: Vec3[]; moving: SnapFeature[]; targets: SnapFeature[];
  settings: SnapSettings; project: ProjectSnap; previous?: readonly string[];
}): { delta: Vec3; guides: SnapGuide[]; latched: string[] } {
  const { raw, grid, directions, moving, targets, settings: s, project } = input;
  const screen = moving.map(f => project(add(f.point, raw))).filter((p): p is [number, number] => !!p);
  const low = [Math.min(...screen.map(p => p[0])) - 112, Math.min(...screen.map(p => p[1])) - 112];
  const high = [Math.max(...screen.map(p => p[0])) + 112, Math.max(...screen.map(p => p[1])) + 112];
  const nearby = s.geometry ? targets.filter(f => {
    const points = (f.edge ?? [f.point]).map(project).filter((p): p is [number, number] => !!p);
    return points.length && [0, 1].every(k => Math.max(...points.map(p => p[k])) >= low[k] && Math.min(...points.map(p => p[k])) <= high[k]);
  }) : [];
  let delta: Vec3 = [...raw];
  const guides: SnapGuide[] = [], latched: string[] = [];
  for (let d = 0; d < directions.length; d++) {
    const direction = directions[d];
    let best: { guide: SnapGuide; correction: number; score: number } | undefined;
    const consider = (feature: SnapFeature, target: Vec3, id: string, axis: number, edge?: [Vec3, Vec3], centerline = false) => {
      if (Math.abs(direction[axis]) < 1e-5) return;
      // Already resolved axes must stay aligned even for rotated local movement.
      if (guides.some(g => g.active && Math.abs(direction[g.axis]) > 1e-5)) return;
      const point = add(feature.point, delta), correction = (target[axis] - point[axis]) / direction[axis];
      const aligned = add(point, mul(direction, correction)), a = project(point), b = project(aligned), t = project(target);
      if (!a || !b || !t) return;
      const unit = project(add(point, direction));
      if (!unit || distance(a, unit) < .01) return; // Axis points into the camera.
      if (!centerline && distance(b, t) > 96) return;
      const pixels = distance(a, b), key = `${d}|${feature.id}|${id}|${axis}`, held = input.previous?.includes(key);
      if (pixels > (held ? 14 : 12)) return;
      const active = s.enabled && pixels <= (held ? 14 : 8);
      const score = pixels - (held && active ? 8 : 0) - (centerline ? 1 : 0);
      if (best && (Number(best.guide.active) > Number(active) || best.guide.active === active && best.score <= score)) return;
      best = { correction, score, guide: { id: key, axis, movingId: feature.id, from: active ? aligned : point, to: target, edge, centerline, active } };
    };
    for (const feature of moving) {
      const point = add(feature.point, delta);
      if (s.centerline && feature.kind === 'center') consider(feature, [0, point[1], point[2]], 'centerline', 0, undefined, true);
      if (!s.geometry) continue;
      for (const target of nearby) {
        if (feature.wallFrame && target.wallFrame && (feature.kind === 'center') !== (target.kind === 'center')) continue;
        const position = target.edge ? closest(point, target.edge) : target.point;
        // Mounting centers also reach physical edges; hull corners never align to abstract centers.
        if (target.kind === 'center' && feature.kind !== 'center') continue;
        for (let axis = 0; axis < 3; axis++) {
          if (target.edge && Math.abs(target.edge[0][axis] - target.edge[1][axis]) > 1e-6) continue;
          consider(feature, position, target.id, axis, target.edge);
        }
      }
    }
    const chosen = best as { guide: SnapGuide; correction: number; score: number } | undefined;
    if (chosen?.guide.active) { delta = add(delta, mul(direction, chosen.correction)); latched.push(chosen.guide.id); }
    else if (s.enabled && s.grid && !guides.some(g => g.active && Math.abs(direction[g.axis]) > 1e-5)) delta = add(delta, mul(direction, dot(sub(grid, delta), direction)));
    if (chosen) guides.push(chosen.guide);
  }
  // Later axis corrections also move the start of previously chosen guides.
  for (const guide of guides) {
    const feature = moving.find(f => f.id === guide.movingId);
    if (feature) guide.from = add(feature.point, delta);
  }
  return { delta, guides: s.guides ? guides : [], latched };
}
