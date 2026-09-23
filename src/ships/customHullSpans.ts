// The native span cut of a custom hull (`construction_custom_hull.rs`), ported for checks and display only. Rust
// decides validity; this copy lets the loft reject a fit and the editor draw the same end caps before a compile.
import type { Vec3 } from './blueprint';

type Face = [label: string, p: Vec3, q: Vec3, r: Vec3];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const area = (p: Vec3, q: Vec3, r: Vec3) => Math.hypot(...cross(sub(q, p), sub(r, p))) / 2;
export const ringMean = (ring: readonly Vec3[]): Vec3 => {
  const sum: Vec3 = [0, 0, 0];
  for (const p of ring) for (let i = 0; i < 3; i++) sum[i] += p[i];
  // Scaled by the reciprocal, as the native `mean` does, so both agree to the last bit.
  return sum.map(v => v * (1 / ring.length)) as Vec3;
};
const midpoint = (a: Vec3, b: Vec3): Vec3 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
/** The first face that turns away from `centre`, skipping degenerate faces as the native builder does. */
const firstFold = (faces: Face[], centre: Vec3) => faces.find(([, p, q, r]) => area(p, q, r) >= 1e-10 && dot(sub(p, centre), cross(sub(q, centre), sub(r, centre))) < -1e-7)?.[0];

/** The two side triangles of outline edge `edge` between rings `a` and `b`, in the native winding. */
export function sideTriangles(a: readonly Vec3[], b: readonly Vec3[], edge: number): [Vec3, Vec3, Vec3][] {
  const n = a.length, k = (edge + 1) % n;
  return edge >= (n - 1) / 2 && edge < n - 1 ? [[a[edge], a[k], b[k]], [a[edge], b[k], b[edge]]] : [[a[edge], a[k], b[edge]], [a[k], b[k], b[edge]]];
}
/** Star test of one span about the midpoint of its ring means: the label of the first folded face, if any. */
export function starFold(a: readonly Vec3[], b: readonly Vec3[]): string | undefined {
  const n = a.length, [ca, cb] = [ringMean(a), ringMean(b)];
  const faces: Face[] = [];
  for (let edge = 0; edge < n; edge++) {
    const k = (edge + 1) % n;
    for (const [p, q, r] of sideTriangles(a, b, edge)) faces.push([`outline point ${edge}`, p, q, r]);
    faces.push([`bow cap at point ${edge}`, a[k], a[edge], ca], [`stern cap at point ${edge}`, b[edge], b[k], cb]);
  }
  return firstFold(faces, midpoint(ca, cb));
}
/** Cap triangles of one horizontal band of a ring, between mirrored pairs (`top`, n−1−top) and the pair below. */
export function bandCap(ring: readonly Vec3[], top: number, bow: boolean): [Vec3, Vec3, Vec3][] {
  const n = ring.length, [low, lowM, topM] = [top + 1, n - 2 - top, n - 1 - top];
  return bow
    ? [[ring[low], ring[top], ring[topM]], [ring[lowM], ring[low], ring[topM]]]
    : [[ring[top], ring[low], ring[topM]], [ring[low], ring[lowM], ring[topM]]];
}
/** The band cut the native builder falls back to when a span is not star-shaped: slabs of consecutive bands between
 * mirrored outline pairs, each star-shaped about its own centre. `heights`
 * are each section's own outline y values; a side whose height reverses has no band cut. True when the cut holds. */
export function bandCutHolds(a: readonly Vec3[], b: readonly Vec3[], heights: [readonly number[], readonly number[]]): boolean {
  const n = a.length, keel = (n - 1) / 2;
  if (heights.some(y => Array.from({ length: keel }, (_, j) => j).some(j => y[j] < y[j + 1]))) return false;
  const slabHolds = (top: number, bottom: number) => {
    const [topM, lowM] = [n - 1 - top, n - 1 - bottom];
    const faces: Face[] = [];
    const edges = [...Array.from({ length: bottom - top }, (_, k) => top + k), ...Array.from({ length: topM - lowM }, (_, k) => lowM + k), ...(top === 0 ? [n - 1] : [])];
    for (const edge of edges) for (const [p, q, r] of sideTriangles(a, b, edge)) faces.push(['', p, q, r]);
    if (top > 0) faces.push(['', a[topM], a[top], b[topM]], ['', a[top], b[top], b[topM]]);
    if (bottom !== keel) faces.push(['', b[lowM], a[bottom], a[lowM]], ['', b[lowM], b[bottom], a[bottom]]);
    for (let band = top; band < bottom; band++) for (const [p, q, r] of [...bandCap(a, band, true), ...bandCap(b, band, false)]) faces.push(['', p, q, r]);
    const corners: number[] = [];
    for (let i = top; i <= bottom; i++) corners.push(i);
    for (let i = Math.max(lowM, bottom + 1); i <= topM; i++) corners.push(i);
    return firstFold(faces, midpoint(ringMean(corners.map(i => a[i])), ringMean(corners.map(i => b[i])))) === undefined;
  };
  // reached[j]: bands above pair j can be cut into star-shaped slabs.
  const reached = [true];
  for (let bottom = 1; bottom <= keel; bottom++) {
    reached[bottom] = false;
    for (let top = bottom - 1; top >= 0 && !reached[bottom]; top--) if (reached[top] && slabHolds(top, bottom)) reached[bottom] = true;
  }
  return reached[keel];
}
/** Which cut the native builder uses for a span: `star`, `bands`, or a fold with the star test's label. */
export function spanCut(a: readonly Vec3[], b: readonly Vec3[], heights: [readonly number[], readonly number[]]): { cut: 'star' } | { cut: 'bands' } | { cut: 'fold'; label: string } {
  const label = starFold(a, b);
  if (label === undefined) return { cut: 'star' };
  return bandCutHolds(a, b, heights) ? { cut: 'bands' } : { cut: 'fold', label };
}
/** Exterior cap triangles of an end ring: the native fan about the ring mean, or one pair per band when the end span
 * takes the band cut. Bow caps face forward, stern caps aft. */
export function endCap(ring: readonly Vec3[], bow: boolean, banded: boolean): [Vec3, Vec3, Vec3][] {
  const n = ring.length;
  if (banded) return Array.from({ length: (n - 1) / 2 }, (_, top) => bandCap(ring, top, bow)).flat().filter(([p, q, r]) => area(p, q, r) >= 1e-10);
  const centre = ringMean(ring);
  return Array.from({ length: n }, (_, i) => (bow ? [ring[(i + 1) % n], ring[i], centre] : [ring[i], ring[(i + 1) % n], centre]) as [Vec3, Vec3, Vec3]);
}
