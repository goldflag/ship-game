import type { Vec3 } from '../ships/blueprint';

/** Round display corners within the adjacent legs. Orders and endpoints stay intact.
 * Sample in world space before frustum clipping so offscreen bends never bridge gaps.
 */
export function smoothMapPath(points: readonly Vec3[], closed = false): Vec3[] {
  if (points.length < 3) return [...points];
  const mix = (a: Vec3, b: Vec3, t: number): Vec3 => a.map((v, i) => v + (b[i] - v) * t) as Vec3;
  const distance = (a: Vec3, b: Vec3) => Math.hypot(...a.map((v, i) => v - b[i]));
  const result: Vec3[] = closed ? [] : [points[0]];
  for (let i = closed ? 0 : 1; i < points.length - (closed ? 0 : 1); i++) {
    const corner = points[i], previous = points[(i + points.length - 1) % points.length], next = points[(i + 1) % points.length];
    const before = distance(previous, corner), after = distance(corner, next);
    const radius = Math.min(300, before * .25, after * .25);
    if (radius < .001) { result.push(corner); continue; }
    const entry = mix(corner, previous, radius / before), exit = mix(corner, next, radius / after);
    result.push(entry);
    for (let step = 1; step <= 12; step++) {
      const t = step / 12;
      result.push(mix(mix(entry, corner, t), mix(corner, exit, t), t));
    }
  }
  if (!closed) result.push(points[points.length - 1]);
  return result;
}
