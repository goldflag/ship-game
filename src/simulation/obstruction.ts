import type { Vec3, Volume } from '../ships/blueprint';

/** Exact boolean counterpart of segmentBox for gun readiness. No contact point,
 * normal or temporary vectors are needed, and tangencies remain obstructions. */
export function segmentIntersectsBox(from: Vec3, to: Vec3, box: Pick<Volume, 'center' | 'size'>): boolean {
  let enter = 0, exit = 1;
  for (let axis = 0; axis < 3; axis++) {
    const delta = to[axis] - from[axis], half = box.size[axis] / 2;
    const low = box.center[axis] - half, high = box.center[axis] + half;
    if (Math.abs(delta) < 1e-10) { if (from[axis] < low || from[axis] > high) return false; continue; }
    const a = (low - from[axis]) / delta, b = (high - from[axis]) / delta;
    enter = Math.max(enter, Math.min(a, b)); exit = Math.min(exit, Math.max(a, b));
    if (enter > exit) return false;
  }
  return true;
}
