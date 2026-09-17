import { envelopeVertices } from '../../ships/freeformShape';
import type { ConstructionPrimitive, ConstructionSource, Vec3 } from '../../ships/blueprint';
import { cornerVertices, rotateVertex, worldVertex } from '../../ships/constructionVertex';

const EPS = 1e-7;
const dot = (a: Vec3, b: Vec3) => a.reduce((n, v, k) => n + v * b[k], 0);
interface Bounds { center: Vec3; half: Vec3; axes: Vec3[] }

/** Editing clearance uses oriented block envelopes, including deformed corners.
 * This is a conservative placement aid, not the native physical union/fit solver. */
function bounds(p: ConstructionPrimitive): Bounds {
  const corners = envelopeVertices(p);
  const min = [0, 1, 2].map(k => Math.min(...corners.map(v => v[k]))) as Vec3;
  const max = [0, 1, 2].map(k => Math.max(...corners.map(v => v[k]))) as Vec3;
  return {
    center: worldVertex(p, min.map((n, k) => (n + max[k]) / 2) as Vec3),
    half: min.map((n, k) => (max[k] - n) * p.size[k] / 2) as Vec3,
    axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map(v => rotateVertex(v as Vec3, p.rotationDeg)),
  };
}
const radius = (box: Bounds, axis: Vec3) => box.axes.reduce((n, v, k) => n + Math.abs(dot(v, axis)) * box.half[k], 0);

/** Continuous SAT for yaw-only oriented boxes: no skipped collision on a fast
 * pointer jump. Touching faces/edges are allowed, and tangent moves stay free. */
function contact(a: Bounds, b: Bounds, delta: Vec3): number {
  let enter = -Infinity, exit = Infinity;
  let initialOverlap = true, penetration = Infinity, escapeVelocity = 0;
  for (const axis of [...a.axes, b.axes[0], b.axes[2]]) {
    const distance = dot(a.center.map((n, k) => n - b.center[k]) as Vec3, axis);
    const extent = radius(a, axis) + radius(b, axis), velocity = dot(delta, axis);
    const depth = extent - Math.abs(distance);
    if (depth <= EPS) initialOverlap = false;
    if (depth < penetration - EPS) { penetration = depth; escapeVelocity = distance === 0 ? Math.abs(velocity) : Math.sign(distance) * velocity; }
    else if (Math.abs(depth - penetration) <= EPS) escapeVelocity = Math.max(escapeVelocity, distance === 0 ? Math.abs(velocity) : Math.sign(distance) * velocity);
    if (Math.abs(velocity) < EPS) {
      if (depth <= EPS) return 1;
      continue;
    }
    const t1 = (-extent - distance) / velocity, t2 = (extent - distance) / velocity;
    enter = Math.max(enter, Math.min(t1, t2)); exit = Math.min(exit, Math.max(t1, t2));
  }
  // Older drafts and curved face seating may already overlap their envelopes.
  // Permit recovery along a shortest separating direction, never deeper motion.
  if (initialOverlap) return escapeVelocity > EPS ? 1 : 0;
  if (enter >= exit - EPS || exit <= EPS || enter >= 1) return 1;
  return Math.max(0, enter);
}

/** Freeze obstacle bounds once per source/selection, then reuse during a drag. */
export function blockMoveConstraint(source: ConstructionSource, selected: ReadonlySet<string>): (delta: Vec3) => Vec3 {
  const moving = source.construction.primitives.filter(p => selected.has(p.id)).map(bounds);
  const fixed = source.construction.primitives.filter(p => !selected.has(p.id)).map(bounds);
  return delta => {
    if (!delta.every(Number.isFinite)) return [0, 0, 0];
    let fraction = 1;
    for (const a of moving) for (const b of fixed) fraction = Math.min(fraction, contact(a, b, delta));
    return delta.map(v => Math.abs(v * fraction) < EPS ? 0 : v * fraction) as Vec3;
  };
}
