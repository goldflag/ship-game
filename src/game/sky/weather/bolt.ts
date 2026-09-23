/** Renderer-free shape of a cloud-to-ground channel: a tortuous main channel from the cloud base to the sea,
 * with branches forking downward from its upper part, as a list of segments `boltMesh.ts` draws.
 *
 * The main channel is a directed random walk (each leg aims at the ground point and takes a sideways kick
 * that half remembers the last), refined twice by midpoint displacement, so it turns sharply at every scale
 * as real channels do (their mean direction change is some 16° per segment). Branches are shorter walks
 * that lean away from it, and some fork once more; they fade toward their tips. */

/** Segments one channel may hold, and the longest segment it keeps (m): longer ones are split again, so the
 * channel stays jagged at the small scale everywhere. */
export const MAX_BOLT_SEGMENTS = 480;
const MAX_SEGMENT = 40;
/** Visible width of the main channel, its branches and their forks (m). The luminous channel is centimetres
 * across; these stand in for its glare, which is what a camera records. */
const WIDTH = { main: 2, branch: 1.2, fork: .8 };

export interface BoltChannel {
  /** Per segment: start x, y, z (m, relative to where the bolt meets the sea) and width (m). */
  readonly start: Float32Array;
  /** Per segment: end x, y, z and brightness, positive on the main channel, which every return stroke
   * lights, and negative on branches, which only the first stroke (the stepped leader's path) lights. */
  readonly end: Float32Array;
  count: number;
}

type Point = [number, number, number];

export function createBoltChannel(capacity = MAX_BOLT_SEGMENTS): BoltChannel {
  return { start: new Float32Array(capacity * 4), end: new Float32Array(capacity * 4), count: 0 };
}

/** A random unit vector. */
function unit(random: () => number): Point {
  const z = random() * 2 - 1, angle = random() * 2 * Math.PI, r = Math.sqrt(1 - z * z);
  return [r * Math.cos(angle), z, r * Math.sin(angle)];
}

/** `legs` legs from `from` to `to`, each aimed at the end and kicked sideways by `roughness` of its length. */
function wander(random: () => number, from: Point, to: Point, legs: number, roughness: number): Point[] {
  const points: Point[] = [from];
  let [x, y, z] = from, dx = 0, dy = 0, dz = 0;
  for (let left = legs; left > 1; left--) {
    const lx = (to[0] - x) / left, ly = (to[1] - y) / left, lz = (to[2] - z) / left;
    const length = Math.hypot(lx, ly, lz), [ux, uy, uz] = unit(random);
    dx = dx * .35 + ux * length * roughness; dy = dy * .35 + uy * length * roughness * .4; dz = dz * .35 + uz * length * roughness;
    x += lx + dx; y += ly + dy; z += lz + dz;
    points.push([x, y, z]);
  }
  points.push(to);
  return points;
}

/** Midpoint displacement: `levels` halvings, each midpoint moved by `amount` of its segment's length, then more
 * halvings of any segment still longer than `MAX_SEGMENT`. */
function refine(random: () => number, points: Point[], levels: number, amount: number): Point[] {
  for (let level = 0; level < levels + 4; level++) {
    const next: Point[] = [points[0]];
    let split = false;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i], length = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      if (level >= levels && length <= MAX_SEGMENT) { next.push(b); continue; }
      const [ux, uy, uz] = unit(random);
      next.push([(a[0] + b[0]) / 2 + ux * length * amount, (a[1] + b[1]) / 2 + uy * length * amount * .5, (a[2] + b[2]) / 2 + uz * length * amount], b);
      split = true;
    }
    points = next;
    if (!split) break;
  }
  return points;
}

/** Append a polyline's segments; brightness runs from `from` at its root to `to` at its tip, varying by up to
 * `flicker` from segment to segment as a real channel's glow does. */
function emit(channel: BoltChannel, random: () => number, points: Point[], width: number, from: number, to: number, flicker = .2): void {
  const last = points.length - 1, { start, end } = channel;
  for (let i = 1; i <= last && channel.count < start.length / 4; i++) {
    const a = points[i - 1], b = points[i], j = channel.count++ * 4;
    start[j] = a[0]; start[j + 1] = a[1]; start[j + 2] = a[2]; start[j + 3] = width;
    end[j] = b[0]; end[j + 1] = b[1]; end[j + 2] = b[2]; end[j + 3] = (from + (to - from) * i / last) * (1 - flicker * random());
  }
}

/** Fill `channel` with a bolt from `top` (on the cloud base) down to `bottom` (at or just under the sea), both
 * relative to the ground point. The same random stream gives the same bolt. */
export function buildBolt(channel: BoltChannel, random: () => number, top: Point, bottom: Point): void {
  channel.count = 0;
  const height = Math.max(1, top[1] - bottom[1]);
  const main = refine(random, wander(random, top, bottom, Math.max(6, Math.min(24, Math.round(height / 80))), .7), 2, .22);
  emit(channel, random, main, WIDTH.main, 1, 1);
  const branches = 3 + Math.floor(random() * 5);
  for (let b = 0; b < branches; b++) {
    // Branches leave the upper part of the channel, where the stepped leader forked most.
    const root = main[Math.floor((.02 + random() * .6) * (main.length - 1))];
    const drop = root[1] - bottom[1], length = drop * (.18 + random() * .35);
    if (length < 20) continue;
    const heading = random() * 2 * Math.PI, spread = .6 + random() * .9, norm = Math.hypot(spread, 1);
    const end: Point = [root[0] + Math.sin(heading) * spread / norm * length, Math.max(bottom[1] + .1 * height, root[1] - length / norm),
      root[2] + Math.cos(heading) * spread / norm * length];
    const branch = refine(random, wander(random, root, end, Math.max(3, Math.round(length / 45)), .6), 1, .2);
    const brightness = .6 + random() * .3;
    emit(channel, random, branch, WIDTH.branch, -brightness, -.15);
    if (random() < .4 && branch.length > 4) {
      const fork = branch[Math.floor(branch.length * (.3 + random() * .3))];
      const reach = (fork[1] - end[1]) * .8 + length * .15, turn = heading + (random() < .5 ? -1 : 1) * (.5 + random() * .8);
      const tip: Point = [fork[0] + Math.sin(turn) * reach * .7, Math.max(bottom[1] + .1 * height, fork[1] - reach * .7), fork[2] + Math.cos(turn) * reach * .7];
      emit(channel, random, refine(random, wander(random, fork, tip, Math.max(2, Math.round(reach / 45)), .6), 1, .2), WIDTH.fork, -brightness * .65, -.1);
    }
  }
}
