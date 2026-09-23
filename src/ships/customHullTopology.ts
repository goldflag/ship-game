import type { ConstructionHullPoint as Point, ConstructionHullStation as Station } from './blueprint';

export const MIN_HULL_POINTS = 5;
export const MAX_HULL_POINTS = 33;
export const contourAt = (points: Point[], index: number): number => points[index].contour ?? index * 8 / (points.length - 1);
export function contourWeight(points: Point[], index: number, weights: number[]): number {
  const t = contourAt(points, index), low = Math.floor(t), high = Math.min(8, low + 1);
  return weights[low] + (weights[high] - weights[low]) * (t - low);
}
export function outlineTopologyError(stations: Station[]): string | undefined {
  const count = stations[0]?.points.length ?? 0;
  if (count < MIN_HULL_POINTS || count > MAX_HULL_POINTS || count % 2 !== 1 || stations.some(s => s.points.length !== count)) return 'Use the same odd number of outline points (5–33) in every section.';
  for (const s of stations) for (let i = 0; i < count; i++) {
    const t = contourAt(s.points, i);
    if (!Number.isFinite(t) || t < 0 || t > 8 || (i === 0 && t !== 0) || (i === count - 1 && t !== 8)
      || (i > 0 && t - contourAt(s.points, i - 1) < 1e-6)
      || Math.abs(t + contourAt(s.points, count - 1 - i) - 8) > 1e-10
      || t !== contourAt(stations[0].points, i)) return 'Keep matching, ordered outline positions mirrored around the keel in every section.';
  }
}
// Keep legacy panel identities; split/merged edges get their own stable interval.
export function hullEdgeId(start: number, end: number): string {
  return Number.isInteger(start) && end === start + 1 ? String(start) : `${start}~${end}`;
}
export function hullEdgeFace(start: number, end: number): 'port' | 'bottom' | 'starboard' | 'top' {
  const middle = (start + end) / 2;
  return start === 8 ? 'top' : middle < 3 ? 'port' : middle <= 5 ? 'bottom' : 'starboard';
}
/** Why a crease list does not fit an outline, or undefined when it does. Mirrors the native rule: port outline points
 * strictly between the deck edge (0) and the keel (4), in order. */
export function hullCreasesError(creases: unknown, points: Point[]): string | undefined {
  if (!Array.isArray(creases)) return 'Hull creases must be a list of outline positions.';
  const keel = (points.length - 1) / 2;
  let previous = 0;
  for (const c of creases) {
    if (typeof c !== 'number' || !Number.isFinite(c) || c <= previous || c >= 4 || !Array.from({ length: keel - 1 }, (_, j) => contourAt(points, j + 1)).includes(c))
      return 'Put each hull crease on a port outline point between the deck edge and the keel, in order.';
    previous = c;
  }
}
/** Lighting group of a side panel: the side, split at each crease (mirrored to starboard). */
export function hullSideSegment(start: number, creases: readonly number[] = []): string {
  const port = start < 4;
  if (!creases.length) return port ? 'port' : 'starboard';
  const below = creases.filter(c => (port ? c : 8 - c) <= start).length;
  return `${port ? 'port' : 'starboard'}:${port ? below : creases.length - below}`;
}
