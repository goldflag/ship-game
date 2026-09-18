import { unorientVector } from './constructionOrientation';
import type { ConstructionPrimitive, ConstructionSource, ConstructionSurface, Vec3 } from './blueprint';

/** The height coating supersedes the old whole-bottom red default, including on
 * saved ships. Explicit panel paint remains authoritative above the coating.
 * Resolve for display only: source assignments, armor and native faces stay intact. */
export function constructionHullBasePaint(data?: ConstructionSource['construction']): (surface: ConstructionSurface) => string {
  const coated = new Set(data?.primitives.filter(p => p.kind === 'custom-hull' && p.customHull?.redPaintY !== undefined).map(p => p.id));
  const defaults = new Set(data?.surfaces.filter(s => coated.has(s.primitiveId) && s.face === 'bottom' && s.panelId === undefined && s.paint === 'red-oxide').map(s => s.primitiveId));
  const panels = new Set(data?.surfaces.filter(s => s.panelId !== undefined).map(s => JSON.stringify([s.primitiveId, s.face, s.panelId])));
  return surface => defaults.has(surface.primitiveId) && surface.face === 'bottom' && surface.paint === 'red-oxide'
    && !panels.has(JSON.stringify([surface.primitiveId, surface.face, surface.panelId])) ? data?.paint ?? 'naval-gray' : surface.paint;
}

type Vertex = { point: Vec3; normal: Vec3 };
export interface PaintedHullFace { paint: string; vertices: Vec3[]; normals: Vec3[] }
/** Clip only the displayed coating. Native faces, panel IDs and physics stay intact.
 * Interpolate lighting normals at the paint edge so it introduces no shading seam. */
export function paintedHullFace(surface: ConstructionSurface, primitive?: ConstructionPrimitive, normals = surface.vertices.map(() => surface.normal), basePaint = surface.paint): PaintedHullFace[] {
  const original = surface.vertices.map((point, i) => ({ point, normal: normals[i] }));
  const face = (vertices: Vertex[], paint: string): PaintedHullFace => ({ paint, vertices: vertices.map(v => v.point), normals: vertices.map(v => v.normal) });
  const localY = primitive?.kind === 'custom-hull' ? primitive.customHull?.redPaintY : undefined;
  if (localY === undefined) return [face(original, surface.paint)];
  const y = localY;
  const height = (v: Vertex) => unorientVector(primitive!, v.point.map((n,k) => n - primitive!.position[k]) as Vec3)[1];
  if (original.every(v => height(v) >= y)) return [face(original, basePaint)];
  if (original.every(v => height(v) <= y)) return [face(original, 'red-oxide')];
  const clip = (below: boolean): Vertex[] => {
    const out: Vertex[] = [];
    for (let i = 0; i < original.length; i++) {
      const a = original[i], b = original[(i + 1) % original.length];
      const inside = (v: Vertex) => below ? height(v) <= y : height(v) >= y;
      if (inside(a)) out.push(a);
      if (inside(a) !== inside(b)) {
        const t = (y - height(a)) / (height(b) - height(a));
        const interpolate = (a: Vec3, b: Vec3) => a.map((n, axis) => n + (b[axis] - n) * t) as Vec3;
        const normal = interpolate(a.normal, b.normal), length = Math.hypot(...normal) || 1;
        out.push({ point: interpolate(a.point, b.point), normal: normal.map(n => n / length) as Vec3 });
      }
    }
    return out.filter((v, i) => v.point.some((n, axis) => Math.abs(n - out[(i + out.length - 1) % out.length].point[axis]) > 1e-10));
  };
  return [face(clip(false), basePaint), face(clip(true), 'red-oxide')].filter(f => f.vertices.length >= 3);
}
