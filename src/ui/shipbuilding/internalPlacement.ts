import type { Vec3 } from '../../ships/blueprint';
import type { BuilderPlacement } from './builderScene';
import { bearingRadians, rotateY } from './placement';

/** One surface a placement ray passes, nearest first: hull skin with its outward normal, or a deck plane. */
export interface HullCrossing<T = unknown> { point: Vec3; outward: Vec3; deck?: boolean; source?: T }

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Internal packages only fit inside the hull, so their ray continues through the skin to
 * the first floor it meets inside: a deck crossed from above or the inner hull bottom.
 * A ray that leaves through a side instead reports the span it spent inside the hull.
 * `inside` marks a ray that starts within the hull. */
export function interiorFloor<T>(crossings: readonly HullCrossing<T>[], direction: Vec3, inside = false): { floor?: HullCrossing<T>; span?: [Vec3, Vec3] } {
  let depth = inside ? 1 : 0, entry: Vec3 | undefined, span: [Vec3, Vec3] | undefined;
  for (const crossing of crossings) {
    if (crossing.deck) {
      if (depth > 0 && direction[1] < -1e-3) return { floor: crossing, span };
      continue;
    }
    if (dot(crossing.outward, direction) <= 0) { if (depth++ === 0) entry = crossing.point; continue; }
    // A camera inside the hull starts without an entry; its first exit is still an inner face.
    if (crossing.outward[1] < -.5) return { floor: crossing, span };
    if (depth > 0 && --depth === 0 && entry && !span) span = [entry, crossing.point];
  }
  return { span };
}

/** The base of an internal package: its centre and the four corners of its turned footprint. */
export function baseFootprint(piece: Extract<BuilderPlacement, { kind: 'equipment' }>, position: Vec3): Vec3[] {
  const radians = bearingRadians(piece.bearingDeg), [cx, cy, cz] = piece.boundsCenter, [sx, sy, sz] = piece.size;
  return [[0, 0], [-1, -1], [-1, 1], [1, -1], [1, 1]].map(([x, z]) =>
    rotateY([cx + x * sx / 2, cy - sy / 2, cz + z * sz / 2], radians).map((value, index) => value + position[index]) as Vec3);
}
