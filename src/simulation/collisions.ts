import type { Hull } from '../ships/blueprint';
import type { FleetActor } from './battle';
import { motionVelocity } from './ship';

type Point = { x: number; z: number };
interface Body {
  actor: FleetActor;
  points: Point[];
  radius: number;
  minY: number;
  maxY: number;
  inverseMass: number;
  inverseInertia: number;
}
interface Contact { normal: Point; depth: number; point: Point; }
const dot = (a: Point, b: Point) => a.x * b.x + a.z * b.z;
const cross = (a: Point, b: Point) => a.x * b.z - a.z * b.x;
const profiles = new WeakMap<Hull, Point[]>();
const CONTACT_GAP = .002;
const SOLVER_PASSES = 12;

/** Convex envelope of authored hull stations. No meshes, gun barrels or renderer bounds. */
function profile(hull: Hull): Point[] {
  const cached = profiles.get(hull);
  if (cached) return cached;
  const stations = hull.halfBreadths.flatMap(([station, breadth]) => [
    { x: -breadth, z: hull.length / 2 - station }, { x: breadth, z: hull.length / 2 - station },
  ]).sort((a, b) => a.x - b.x || a.z - b.z);
  const half = (points: Point[]) => {
    const result: Point[] = [];
    for (const point of points) {
      while (result.length >= 2) {
        const a = result[result.length - 2], b = result[result.length - 1];
        if (cross({ x: b.x - a.x, z: b.z - a.z }, { x: point.x - b.x, z: point.z - b.z }) > 1e-10) break;
        result.pop();
      }
      result.push(point);
    }
    return result.slice(0, -1);
  };
  const points = [...half(stations), ...half([...stations].reverse())];
  profiles.set(hull, points);
  return points;
}

function body(actor: FleetActor): Body {
  const hull = actor.definition.hull, motion = actor.motion;
  const sin = Math.sin(motion.heading), cos = Math.cos(motion.heading);
  const mass = hull.massKg + actor.damage.compartments.reduce((sum, c) => sum + c.waterM3 * 1000, 0);
  // A conservative vertical envelope keeps a sinking hull solid until it clears
  // the other hull's keel. List/trim expand it; sea waves remain visual only.
  const tilt = Math.abs(Math.sin(motion.roll)) * hull.beam / 2 + Math.abs(Math.sin(motion.pitch)) * hull.length / 2;
  return {
    actor,
    points: profile(hull).map(p => ({ x: motion.x + cos * p.x - sin * p.z, z: motion.z + sin * p.x + cos * p.z })),
    radius: Math.hypot(hull.length, hull.beam) / 2,
    minY: motion.y - hull.draft - tilt,
    maxY: motion.y + Math.max(...hull.deckHeights.map(([, height]) => height)) + tilt,
    inverseMass: 1 / mass,
    // Rectangular waterplane inertia is a gameplay approximation.
    inverseInertia: 12 / (mass * (hull.length ** 2 + hull.beam ** 2)),
  };
}

function project(points: Point[], axis: Point): [number, number] {
  let min = Infinity, max = -Infinity;
  for (const point of points) {
    const value = dot(point, axis);
    min = Math.min(min, value); max = Math.max(max, value);
  }
  return [min, max];
}

/** Separating-axis contact, with the normal pointing from A toward B. */
function contact(a: Body, b: Body): Contact | undefined {
  const am = a.actor.motion, bm = b.actor.motion;
  if (Math.hypot(am.x - bm.x, am.z - bm.z) > a.radius + b.radius || a.maxY < b.minY || b.maxY < a.minY) return;
  let depth = Infinity, normal: Point = { x: 0, z: 0 };
  for (const points of [a.points, b.points]) for (let i = 0; i < points.length; i++) {
    const p = points[i], q = points[(i + 1) % points.length];
    const length = Math.hypot(q.x - p.x, q.z - p.z);
    if (length < 1e-8) continue;
    const axis = { x: -(q.z - p.z) / length, z: (q.x - p.x) / length };
    const [aMin, aMax] = project(a.points, axis), [bMin, bMax] = project(b.points, axis);
    if (aMax < bMin || bMax < aMin) return;
    // Taking both exit distances also handles an initially contained hull.
    const positive = aMax - bMin, negative = bMax - aMin;
    const overlap = Math.min(positive, negative);
    if (overlap < depth) {
      depth = overlap;
      const sign = positive <= negative ? 1 : -1;
      normal = { x: axis.x * sign, z: axis.z * sign };
    }
  }
  if (!Number.isFinite(depth)) return;
  const tangent = { x: -normal.z, z: normal.x };
  const [, aFace] = project(a.points, normal), [bFace] = project(b.points, normal);
  // Use the middle of the overlapping support features, so a centered ram
  // doesn't acquire an arbitrary torque from the first vertex of a broadside.
  const [aMin, aMax] = project(a.points.filter(p => aFace - dot(p, normal) < .01), tangent);
  const [bMin, bMax] = project(b.points.filter(p => dot(p, normal) - bFace < .01), tangent);
  const along = (Math.max(aMin, bMin) + Math.min(aMax, bMax)) / 2;
  const across = (aFace + bFace) / 2;
  return { normal, depth, point: { x: normal.x * across + tangent.x * along, z: normal.z * across + tangent.z * along } };
}

function impulse(body: Body, lever: Point, direction: Point, magnitude: number): void {
  const motion = body.actor.motion;
  const dx = direction.x * magnitude * body.inverseMass, dz = direction.z * magnitude * body.inverseMass;
  const sin = Math.sin(motion.heading), cos = Math.cos(motion.heading);
  motion.speed += sin * dx - cos * dz;
  motion.swaySpeed += cos * dx + sin * dz;
  motion.yawRate += cross(lever, direction) * magnitude * body.inverseInertia;
}

function translate(body: Body, normal: Point, distance: number): void {
  const dx = normal.x * distance, dz = normal.z * distance;
  body.actor.motion.x += dx; body.actor.motion.z += dz;
  for (const point of body.points) { point.x += dx; point.z += dz; }
}

/** Called after every hull moves and before aiming/firing. All teams share contacts.
 * Inelastic impulses remove closing velocity while preserving sliding motion.
 * Iteration propagates contact through a fleet pile-up in stable actor order.
 */
export function resolveShipCollisions(actors: readonly FleetActor[]): void {
  const bodies = actors.map(body);
  for (let pass = 0; pass < SOLVER_PASSES; pass++) {
    let touching = false;
    for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i], b = bodies[j], hit = contact(a, b);
      if (!hit) continue;
      touching = true;
      const am = a.actor.motion, bm = b.actor.motion;
      const ra = { x: hit.point.x - am.x, z: hit.point.z - am.z };
      const rb = { x: hit.point.x - bm.x, z: hit.point.z - bm.z };
      const av = motionVelocity(am), bv = motionVelocity(bm);
      const relative = { x: bv[0] - bm.yawRate * rb.z - av[0] + am.yawRate * ra.z,
        z: bv[2] + bm.yawRate * rb.x - av[2] - am.yawRate * ra.x };
      const closing = dot(relative, hit.normal);
      if (closing < 0) {
        const effectiveMass = a.inverseMass + b.inverseMass
          + cross(ra, hit.normal) ** 2 * a.inverseInertia + cross(rb, hit.normal) ** 2 * b.inverseInertia;
        const magnitude = -closing / effectiveMass;
        impulse(a, ra, hit.normal, -magnitude);
        impulse(b, rb, hit.normal, magnitude);
      }
      const correction = (hit.depth + CONTACT_GAP) / (a.inverseMass + b.inverseMass);
      translate(a, hit.normal, -correction * a.inverseMass);
      translate(b, hit.normal, correction * b.inverseMass);
    }
    if (!touching) break;
  }
}
