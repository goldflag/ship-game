import type { ConstructionSurface, Vec3 } from '../../ships/blueprint';
import { surfaceSelectionKey } from '../../ships/constructionEditor';
type Edge = { a: Vec3; b: Vec3; surface: ConstructionSurface };
const key = (v: Vec3) => v.map(n => Math.round(n * 1e6)).join(',');
/** Draw the boundary of a logical face, including openings, without triangle
 * diagonals. Split collinear edges first so clipped T-junctions cancel too. */
function surfaceEdges(surfaces: readonly ConstructionSurface[]): { edge: Edge; normals: Vec3[] }[] {
  const vertices = [...new Map(surfaces.flatMap(s => s.vertices).map(v => [key(v), v])).values()];
  // Limit split candidates by the tightest axis range. A whole hull can contain
  // thousands of vertices, while each clipped edge touches only a few of them.
  const sorted = [0, 1, 2].map(axis => [...vertices].sort((a, b) => a[axis] - b[axis]));
  const lowerBound = (axis: number, value: number) => {
    const list = sorted[axis]; let lo = 0, hi = list.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (list[mid][axis] < value) lo = mid + 1; else hi = mid; }
    return lo;
  };
  const edges = new Map<string, { edge: Edge; normals: Vec3[] }>();
  for (const surface of surfaces) for (let i = 0; i < surface.vertices.length; i++) {
    const a = surface.vertices[i], b = surface.vertices[(i + 1) % surface.vertices.length];
    const d = b.map((v, axis) => v - a[axis]), length2 = d.reduce((sum, v) => sum + v * v, 0);
    if (length2 < 1e-16) continue;
    const stops: { t: number; v: Vec3 }[] = [{ t: 0, v: a }, { t: 1, v: b }];
    const ranges = [0, 1, 2].map(axis => ({ axis,
      start: lowerBound(axis, Math.min(a[axis], b[axis]) - 1e-6),
      end: lowerBound(axis, Math.max(a[axis], b[axis]) + 1e-6),
    }));
    const range = ranges.reduce((best, next) => next.end - next.start < best.end - best.start ? next : best);
    for (let index = range.start; index < range.end; index++) {
      const v = sorted[range.axis][index];
      const t = v.reduce((sum, n, axis) => sum + (n - a[axis]) * d[axis], 0) / length2;
      if (t <= 1e-8 || t >= 1 - 1e-8) continue;
      if (v.reduce((sum, n, axis) => sum + (n - a[axis] - t * d[axis]) ** 2, 0) < 1e-12) stops.push({ t, v });
    }
    stops.sort((a, b) => a.t - b.t);
    for (let j = 1; j < stops.length; j++) {
      const a = stops[j - 1].v, b = stops[j].v, ka = key(a), kb = key(b);
      if (ka === kb) continue;
      const id = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`, existing = edges.get(id);
      if (existing) existing.normals.push(surface.normal); else edges.set(id, { edge: { a, b, surface }, normals: [surface.normal] });
    }
  }
  return [...edges.values()];
}
/** Selection boundaries retain the complete logical face. */
export function surfaceOutline(surfaces: readonly ConstructionSurface[]): Edge[] {
  return surfaceEdges(surfaces).filter(e => e.normals.length === 1).map(e => e.edge);
}

/** Exterior creases cross source-block boundaries; coplanar seams disappear.
 * Unpaired edges remain visible around actual openings and surface boundaries. */
export function surfaceCreases(surfaces: readonly ConstructionSurface[], angleDeg = 20): Edge[] {
  const threshold = Math.cos(angleDeg * Math.PI / 180);
  return surfaceEdges(surfaces).filter(({ normals }) => normals.length === 1 || normals.some((a, i) =>
    normals.slice(i + 1).some(b => {
      const dot = a.reduce((sum, n, axis) => sum + n * b[axis], 0);
      return dot / (Math.hypot(...a) * Math.hypot(...b)) < threshold - 1e-10;
    }),
  )).map(e => e.edge);
}
export function surfaceGroups(surfaces: readonly ConstructionSurface[]): ConstructionSurface[][] {
  const groups = new Map<string, ConstructionSurface[]>();
  for (const surface of surfaces) { const key = surfaceSelectionKey(surface); const group = groups.get(key); if (group) group.push(surface); else groups.set(key, [surface]); }
  return [...groups.values()];
}
