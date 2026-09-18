import { meshFaces } from '../../ships/constructionMesh';
import type { ConstructionPrimitive, ConstructionSource, ConstructionSurface, Vec3 } from '../../ships/blueprint';
import { projectConstructionSurfaces } from '../../ships/constructionEditor';
import { CONSTRUCTION_SHAPES } from '../../ships/constructionShapes';
import { customHullFaces } from '../../ships/customHullModel';
import { customHullPanels } from '../../ships/constructionPanels';
import { balconyFaces } from '../../ships/constructionBalcony';
import { shapedFaces, cross, sub } from '../../ships/freeformShape';
import { rotateVertex } from '../../ships/constructionVertex';

type Face = { vertices: Vec3[]; face?: string; panelId?: string };
function sourceFaces(primitive: ConstructionPrimitive): Face[] {
  if (primitive.kind === 'custom-hull' && primitive.customHull) {
    const panels = customHullPanels(primitive);
    const sides = (primitive.customHull.stations.length - 1) * primitive.customHull.stations[0].points.length * 2;
    return customHullFaces(primitive).map((f, i) => ({ vertices: f.vertices, ...panels[i < sides ? Math.floor(i / 2) : panels.length - (f.group === 'bow' ? 2 : 1)] }));
  }
  if(primitive.mesh)return meshFaces(primitive.mesh,primitive.size).map(f=>({vertices:f.points,face:f.name}));
  if (primitive.kind === 'vertex') return shapedFaces(primitive).map(f => ({ vertices: f.points, face: f.name }));
  if (primitive.kind === 'balcony') return balconyFaces(primitive.size, primitive.balcony).map(vertices => ({ vertices }));
  return (CONSTRUCTION_SHAPES[primitive.kind] ?? []).map(vertices => ({ vertices: vertices.map(v => v.map((n, axis) => n * primitive.size[axis]) as Vec3) }));
}

/** Display envelopes only: no union, mass, fit or launch authority. The native compiler
 * replaces these faces when ready. Use the same paint, smoothing and metric materials
 * as the finished hull instead of flashing the whole design to flat gray. */
export function pendingHullSurfaces(source: ConstructionSource, previous: ConstructionSource, surfaces: readonly ConstructionSurface[]): ConstructionSurface[] {
  const originals = new Map(previous.id === source.id ? previous.construction.primitives.map(p => [p.id, JSON.stringify(p)]) : []);
  const unchanged = new Set(source.construction.primitives.filter(p => originals.get(p.id) === JSON.stringify(p)).map(p => p.id));
  const next = surfaces.filter(s => unchanged.has(s.primitiveId));
  // Keep existing supports through additions; moving/removing their hull or fittings
  // discards them until the compiler has resolved their new attachments.
  if (previous.id === source.id && unchanged.size === previous.construction.primitives.length && JSON.stringify(source.construction.equipment) === JSON.stringify(previous.construction.equipment)) {
    const ids = new Set(previous.construction.primitives.map(p => p.id));
    next.push(...surfaces.filter(s => !ids.has(s.primitiveId)));
  }
  for (const primitive of source.construction.primitives) {
    if (unchanged.has(primitive.id)) continue;
    for (const [index, polygon] of sourceFaces(primitive).entries()) {
      const { vertices } = polygon;
      const normal = cross(sub(vertices[1], vertices[0]), sub(vertices[2], vertices[0]));
      const length = Math.hypot(...normal);
      if (length < 1e-10) continue;
      const localNormal = normal.map(n => n / length) as Vec3;
      const names = [['port', 'starboard'], ['bottom', 'top'], ['bow', 'stern']];
      const axis = localNormal.findIndex(n => Math.abs(n) > 1 - 1e-7);
      const face = polygon.face ?? (axis < 0 ? 'slope' : names[axis][localNormal[axis] > 0 ? 1 : 0]);
      let areaM2 = 0;
      for (let i = 1; i < vertices.length - 1; i++) areaM2 += Math.hypot(...cross(sub(vertices[i], vertices[0]), sub(vertices[i + 1], vertices[0]))) / 2;
      next.push({ id: `preview:${primitive.id}:${index}`, primitiveId: primitive.id, face, panelId: polygon.panelId,
        vertices: vertices.map(v => rotateVertex(v, primitive.rotationDeg).map((n, axis) => n + primitive.position[axis]) as Vec3), normal: rotateVertex(localNormal, primitive.rotationDeg),
        areaM2, thicknessMm: source.construction.defaultThicknessMm, material: 'steel', paint: 'naval-gray', open: false });
    }
  }
  return projectConstructionSurfaces(source, next);
}
