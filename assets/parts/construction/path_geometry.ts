/** Original path recipe. Matches the native compiler's 16 equal-t sag samples.
 * Rendering only: native compilation owns support, occupancy and loading. */
export type PathPoint = [number, number, number];
export const PATH_INTERVALS = 16;
export const pathDistance = (a: PathPoint, b: PathPoint) => Math.hypot(...a.map((v, i) => v - b[i]));
export function samplePath(points: readonly PathPoint[], slackM = 0): PathPoint[] {
  if (!points.length) return [];
  const out: PathPoint[] = [[...points[0]]];
  for (let i = 1; i < points.length; i++) for (let j = 1; j <= PATH_INTERVALS; j++) {
    const t = j / PATH_INTERVALS;
    out.push(points[i - 1].map((v, k) => v + (points[i][k] - v) * t - (k === 1 ? 4 * slackM * t * (1 - t) : 0)) as PathPoint);
  }
  return out;
}
export function railingPosts(points: readonly PathPoint[], spacing = 1.5): PathPoint[] {
  const out: PathPoint[] = [];
  for (let i = 1; i < points.length; i++) {
    const count = Math.ceil(pathDistance(points[i - 1], points[i]) / spacing);
    for (let j = 0; j <= count; j++) {
      const t = j / count;
      const point = points[i - 1].map((v, k) => v + (points[i][k] - v) * t) as PathPoint;
      if (!out.some(other => pathDistance(point, other) < 1e-6)) out.push(point);
    }
  }
  return out;
}
