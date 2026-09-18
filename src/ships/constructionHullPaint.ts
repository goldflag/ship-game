import { hullPaintBands } from './hullPaintBands';
import { unorientVector } from './constructionOrientation';
import type { ConstructionPrimitive, ConstructionSource, ConstructionSurface, Vec3 } from './blueprint';

/** The height coating supersedes the old whole-bottom red default, including on
 * saved ships. Explicit panel paint remains authoritative above the coating.
 * Resolve for display only: source assignments, armor and native faces stay intact. */
export function constructionHullBasePaint(data?: ConstructionSource['construction']): (surface: Pick<ConstructionSurface, 'primitiveId' | 'face' | 'panelId' | 'paint'>) => string {
  const coated = new Set(data?.primitives.filter(p => p.kind === 'custom-hull' && hullPaintBands(p.customHull).length > 0).map(p => p.id));
  const defaults = new Set(data?.surfaces.filter(s => coated.has(s.primitiveId) && s.face === 'bottom' && s.panelId === undefined && s.paint === 'red-oxide').map(s => s.primitiveId));
  const panels = new Set(data?.surfaces.filter(s => s.panelId !== undefined).map(s => JSON.stringify([s.primitiveId, s.face, s.panelId])));
  return surface => defaults.has(surface.primitiveId) && surface.face === 'bottom' && surface.paint === 'red-oxide'
    && !panels.has(JSON.stringify([surface.primitiveId, surface.face, surface.panelId])) ? data?.paint ?? 'naval-gray' : surface.paint;
}

type Vertex = { point: Vec3; normal: Vec3; interpolated?: boolean };
export interface PaintedHullFace { paint: string; vertices: Vec3[]; normals: Vec3[] }
/** Clip only the displayed coating. Native faces, panel IDs and physics stay intact.
 * Interpolate lighting normals at the paint edge so it introduces no shading seam. */
export function paintedHullFace(surface: ConstructionSurface, primitive?: ConstructionPrimitive, normals = surface.vertices.map(() => surface.normal), basePaint = surface.paint): PaintedHullFace[] {
  const bands = primitive?.kind === 'custom-hull' ? hullPaintBands(primitive.customHull) : [];
  if (!bands.length) return [{ paint: surface.paint, vertices: surface.vertices, normals }];
  const original = surface.vertices.map((point, i) => ({ point, normal: normals[i] }));
  const height = (v: Vertex) => unorientVector(primitive!, v.point.map((n, k) => n - primitive!.position[k]) as Vec3)[1];
  const face = (vertices: Vertex[], paint: string): PaintedHullFace => ({ paint, vertices: vertices.map(v => v.point), normals: vertices.map(v => {
    if (!v.interpolated) return v.normal;
    const length = Math.hypot(...v.normal) || 1;
    return v.normal.map(n => n / length) as Vec3;
  }) });
  const clip = (polygon: Vertex[], y: number, below: boolean): Vertex[] => {
    const out: Vertex[] = [];
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i], b = polygon[(i + 1) % polygon.length];
      const ay = height(a), by = height(b);
      const insideA = below ? ay <= y : ay >= y, insideB = below ? by <= y : by >= y;
      if (insideA) out.push(a);
      if (insideA !== insideB) {
        const t = (y - ay) / (by - ay);
        const interpolate = (a: Vec3, b: Vec3) => a.map((n, axis) => n + (b[axis] - n) * t) as Vec3;
        // Keep raw interpolants until emission so several cuts retain the same lighting field.
        out.push({ point: interpolate(a.point, b.point), normal: interpolate(a.normal, b.normal), interpolated: true });
      }
    }
    return out.filter((v, i) => v.point.some((n, axis) => Math.abs(n - out[(i + out.length - 1) % out.length].point[axis]) > 1e-10));
  };
  // Emit in the original upper/lower order for byte-identical legacy exports.
  const output: PaintedHullFace[] = [];
  let remaining: Vertex[] = original;
  for (let i = bands.length - 1; i >= 0; i--) {
    const band = bands[i];
    if (remaining.every(v => height(v) >= band.upperY)) {
      if (remaining.length >= 3) output.push(face(remaining, i === bands.length - 1 ? basePaint : bands[i + 1].paint));
      return output;
    }
    if (!remaining.every(v => height(v) <= band.upperY)) {
      const above = clip(remaining, band.upperY, false);
      if (above.length >= 3) output.push(face(above, i === bands.length - 1 ? basePaint : bands[i + 1].paint));
      remaining = clip(remaining, band.upperY, true);
    }
  }
  if (remaining.length >= 3) output.push(face(remaining, bands[0].paint));
  return output;
}
