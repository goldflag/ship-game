import { unorientVector } from './constructionOrientation';
import type { ConstructionPrimitive, ConstructionSurface, Vec3 } from './blueprint';

type Vertex = { point: Vec3; normal: Vec3 };
export interface PaintedHullFace { paint: string; vertices: Vec3[]; normals: Vec3[] }
/** Clip only the displayed coating. Native faces, panel IDs and physics stay intact.
 * Interpolate lighting normals at the paint edge so it introduces no shading seam. */
export function paintedHullFace(surface: ConstructionSurface, primitive?: ConstructionPrimitive, normals = surface.vertices.map(() => surface.normal)): PaintedHullFace[] {
  const original = surface.vertices.map((point, i) => ({ point, normal: normals[i] }));
  const face = (vertices: Vertex[], paint: string): PaintedHullFace => ({ paint, vertices: vertices.map(v => v.point), normals: vertices.map(v => v.normal) });
  const localY = primitive?.kind === 'custom-hull' ? primitive.customHull?.redPaintY : undefined;
  if (localY === undefined) return [face(original, surface.paint)];
  const y = localY;
  const height = (v: Vertex) => unorientVector(primitive!, v.point.map((n,k) => n - primitive!.position[k]) as Vec3)[1];
  if (original.every(v => height(v) >= y)) return [face(original, surface.paint)];
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
  return [face(clip(false), surface.paint), face(clip(true), 'red-oxide')].filter(f => f.vertices.length >= 3);
}
