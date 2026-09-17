import type { ConstructionSurface, Vec3 } from '../../ships/blueprint';
import { surfaceSelectionKey } from '../../ships/constructionEditor';
type Edge = { a: Vec3; b: Vec3; surface: ConstructionSurface };
const key = (v: Vec3) => v.map(n => Math.round(n * 1e6)).join(',');
/** Draw the boundary of a logical face, including openings, without triangle
 * diagonals. Split collinear edges first so clipped T-junctions cancel too. */
export function surfaceOutline(surfaces: readonly ConstructionSurface[]): Edge[] {
  const vertices = [...new Map(surfaces.flatMap(s => s.vertices).map(v => [key(v), v])).values()];
  const edges = new Map<string, { edge: Edge; count: number }>();
  for (const surface of surfaces) for (let i = 0; i < surface.vertices.length; i++) {
    const a = surface.vertices[i], b = surface.vertices[(i + 1) % surface.vertices.length];
    const d = b.map((v, axis) => v - a[axis]), length2 = d.reduce((sum, v) => sum + v * v, 0);
    if (length2 < 1e-16) continue;
    const stops: { t: number; v: Vec3 }[] = [{ t: 0, v: a }, { t: 1, v: b }];
    for (const v of vertices) {
      const t = v.reduce((sum, n, axis) => sum + (n - a[axis]) * d[axis], 0) / length2;
      if (t <= 1e-8 || t >= 1 - 1e-8) continue;
      if (v.reduce((sum, n, axis) => sum + (n - a[axis] - t * d[axis]) ** 2, 0) < 1e-12) stops.push({ t, v });
    }
    stops.sort((a, b) => a.t - b.t);
    for (let j = 1; j < stops.length; j++) {
      const a = stops[j - 1].v, b = stops[j].v, ka = key(a), kb = key(b);
      if (ka === kb) continue;
      const id = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`, existing = edges.get(id);
      if (existing) existing.count++; else edges.set(id, { edge: { a, b, surface }, count: 1 });
    }
  }
  return [...edges.values()].filter(e => e.count === 1).map(e => e.edge);
}
export function surfaceGroups(surfaces: readonly ConstructionSurface[]): ConstructionSurface[][] {
  const groups = new Map<string, ConstructionSurface[]>();
  for (const surface of surfaces) { const key = surfaceSelectionKey(surface); const group = groups.get(key); if (group) group.push(surface); else groups.set(key, [surface]); }
  return [...groups.values()];
}
