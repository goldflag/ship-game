/** The interlock replay of `bun run ship:sweep`: asks the simulation's installation resolver whether each swept
 * contact is reachable. Every answer is a pure function of the definition and the poses asked about, so the
 * caches below are memoisation only. sweep.ts fills them in rounds on any number of workers (sweepWorker.ts):
 * `pending` lists the cache entries the replay still lacks, deduplicated, the workers compute them, the entries
 * are merged back, and the final `replay` runs from the caches alone. The report is therefore the same for any
 * number of workers, and the same as one sequential replay. */
import type { SweepPose } from './sweepContacts';

export type Pose = { train: number; elevation: number; recoil: number };
/** The WASM `ArticulationPreview.resolve`, parsed: each mount's pose after one requested move. */
export type Resolve = (current: Pose[], requested: Pose[]) => { pose: Pose; blocked: boolean; obstructionId: string | null }[];
export type Definition = { mounts: { id: string; initialElevationDeg?: number }[] };

/** One piece of replay work: a mount's contacts with one fixed part, or a neighbouring pair's pose pairs. */
export type ReplayUnit =
  | { kind: 'fixed'; mount: string; poses: SweepPose[] }
  | { kind: 'mount'; a: string; b: string; poses: number[][] };
export type ReplayResult = { reachable: number; example?: number[]; stopsAt?: string };
/** A question about mount `i` moving to `target` with the other mounts at `current` (the rest pose if absent). */
export type Query = { i: number; target: Pose; current?: Pose[] };
type Interval = { lo: number; hi: number } | null;
/** Cache entries, as sent between workers. */
export type ReplayCache = { intervals: [string, Interval][]; reached: [string, boolean][]; stops: [string, Pose][] };
type Answer = { reached: boolean; stop?: Pose };
type Check = (i: number, target: Pose, current?: Pose[]) => Answer;

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
const pose = (t: number, e: number, r: number): Pose => ({ train: rad(t), elevation: rad(e), recoil: r });
const close = (a: Pose, b: Pose) => Math.abs(a.train - b.train) < rad(.25) && Math.abs(a.elevation - b.elevation) < rad(.25) && Math.abs(a.recoil - b.recoil) < .02;
const within = (target: Pose, band: Interval) => !!band && target.train >= band.lo - rad(.25) && target.train <= band.hi + rad(.25);
/** Thrown by the cache-only check when an entry is missing. */
class Missing { constructor(readonly query: Query, readonly id: string) {} }

/** Without `resolve` every contact counts as reachable (`--no-interlock`). */
export function createReplay(definition: Definition, resolve?: Resolve) {
  const index = new Map(definition.mounts.map((m, i) => [m.id, i]));
  const rest: Pose[] = definition.mounts.map(m => ({ train: 0, elevation: rad(m.initialElevationDeg ?? 1), recoil: 0 }));
  const intervals = new Map<string, Interval>();
  const reached = new Map<string, boolean>();
  const stops = new Map<string, Pose>();
  const fresh: ReplayCache = { intervals: [], reached: [], stops: [] };

  const keys = (i: number, target: Pose, current: Pose[]) => {
    const others = current === rest ? 'rest' : JSON.stringify(current);
    return {
      key: `${i}|${target.train.toFixed(5)}|${target.elevation.toFixed(5)}|${target.recoil}|${others}`,
      band: `${i}|${target.elevation.toFixed(5)}|${target.recoil}|${others}`,
    };
  };
  /** Move mount `i` along `path` from its pose in `current`; the pose where it ends and whether it got there. */
  function travel(i: number, path: Pose[], current: Pose[]): { pose: Pose; reached: boolean } {
    const poses = structuredClone(current);
    for (const step of path) {
      const requested = structuredClone(poses);
      requested[i] = step;
      poses[i] = resolve!(poses, requested)[i].pose;
      if (!close(poses[i], step)) return { pose: poses[i], reached: false };
    }
    return { pose: poses[i], reached: true };
  }
  /** Can mount `i` reach `target` from `current` (every other mount at rest unless given)? The simulation's
   * interlocks stop a mount at the first contact along its move, so a pose is reachable when the mount can
   * elevate at its neutral train and then train to it, or train at its current elevation and then elevate. */
  const reachable: Check = (i, target, current = rest) => {
    if (!resolve) return { reached: true };
    const { key, band } = keys(i, target, current);
    if (!intervals.has(band)) {
      let value: Interval = null;
      const raised = travel(i, [{ train: current[i].train, elevation: target.elevation, recoil: target.recoil }], current);
      if (raised.reached) {
        const at = structuredClone(current);
        at[i] = raised.pose;
        const far = rad(400);
        const hi = travel(i, [{ ...raised.pose, train: far }], at).pose.train;
        const lo = travel(i, [{ ...raised.pose, train: -far }], at).pose.train;
        value = { lo, hi };
      }
      intervals.set(band, value);
      fresh.intervals.push([band, value]);
    }
    const interval = intervals.get(band)!;
    if (within(target, interval)) return { reached: true };
    if (!reached.has(key)) {
      const trainFirst = travel(i, [{ ...current[i], train: target.train }, target], current);
      reached.set(key, trainFirst.reached);
      fresh.reached.push([key, trainFirst.reached]);
      if (!trainFirst.reached && interval) {
        stops.set(key, { ...target, train: target.train > 0 ? interval.hi : interval.lo });
        fresh.stops.push([key, stops.get(key)!]);
      }
    }
    return { reached: reached.get(key)!, stop: stops.get(key) };
  };
  /** `reachable` from the caches alone; throws `Missing` naming the first entry it lacks (a band before a move). */
  const cached: Check = (i, target, current = rest) => {
    if (!resolve) return { reached: true };
    const { key, band } = keys(i, target, current);
    const query = { i, target, ...(current === rest ? {} : { current }) };
    if (!intervals.has(band)) throw new Missing(query, `band ${band}`);
    if (within(target, intervals.get(band)!)) return { reached: true };
    if (!reached.has(key)) throw new Missing(query, `move ${key}`);
    return { reached: reached.get(key)!, stop: stops.get(key) };
  };

  /** Each pose of a unit, replayed with `check`: a fixed contact's answer, or whether a neighbouring pair's
   * poses can be reached together. */
  function* poses(unit: ReplayUnit, check: Check): Generator<{ pose: number[]; answer: Answer }> {
    if (unit.kind === 'fixed') {
      const i = index.get(unit.mount)!;
      for (const p of unit.poses) yield { pose: p, answer: check(i, pose(p[0], p[1], p[2])) };
      return;
    }
    const a = index.get(unit.a)!, b = index.get(unit.b)!;
    for (const p of unit.poses) {
      // Either mount may be the one that moves into the other, which is already where it can reach.
      const [ta, ea, ra, tb, eb, rb] = p;
      const pa = pose(ta, ea, ra), pb = pose(tb, eb, rb);
      const withB = structuredClone(rest); withB[b] = pb;
      const withA = structuredClone(rest); withA[a] = pa;
      const bThere = check(b, pb).reached, aThere = check(a, pa).reached;
      yield { pose: p, answer: { reached: (bThere && check(a, pa, withB).reached) || (aThere && check(b, pb, withA).reached) } };
    }
  }
  function tally(unit: ReplayUnit, check: Check): ReplayResult {
    let reach = 0, example: number[] | undefined, stopsAt: string | undefined;
    for (const { pose: p, answer } of poses(unit, check)) {
      if (answer.reached) { reach++; example ??= p; }
      else if (answer.stop && !stopsAt) stopsAt = `train ${deg(answer.stop.train).toFixed(1)}°, elevation ${deg(answer.stop.elevation).toFixed(1)}°`;
    }
    return unit.kind === 'fixed' ? { reachable: reach, example, stopsAt } : { reachable: reach, example };
  }

  return {
    /** Replay a unit, asking the resolver for whatever the caches lack. */
    replay: (unit: ReplayUnit) => tally(unit, reachable),
    /** Replay a unit from the caches alone; throws if `pending` would list anything for it. */
    replayCached: (unit: ReplayUnit) => tally(unit, (i, target, current) => {
      try { return cached(i, target, current); } catch (e) { throw e instanceof Missing ? new Error(`interlock replay cache lacks ${e.id}`) : e; }
    }),
    /** The distinct cache entries the replay of `units` needs next, one query each: a pose stops at its first
     * missing entry, since later ones depend on it. Answer them, `seed` the results and ask again until empty. */
    pending(units: ReplayUnit[]): Query[] {
      const out = new Map<string, Query>();
      for (const unit of units) {
        const one = { ...unit, poses: [] as number[][] };
        for (const p of unit.poses) {
          one.poses = [p];
          try { poses(one as ReplayUnit, cached).next(); } catch (e) {
            if (!(e instanceof Missing)) throw e;
            // A band query also answers its own pose's move; other poses in the band follow next round.
            if (!out.has(e.id)) out.set(e.id, e.query);
          }
        }
      }
      // Bands first: each costs three long moves, so the pool finishes evenly.
      return [...out].sort(([a], [b]) => Number(a.startsWith('move')) - Number(b.startsWith('move'))).map(([, q]) => q);
    },
    /** Answer one query, filling the caches. */
    answer(q: Query) { reachable(q.i, q.target, q.current); },
    /** Cache entries this replay computed since the last call. */
    drain(): ReplayCache {
      return { intervals: fresh.intervals.splice(0), reached: fresh.reached.splice(0), stops: fresh.stops.splice(0) };
    },
    seed(cache: ReplayCache) {
      for (const [k, v] of cache.intervals) intervals.set(k, v);
      for (const [k, v] of cache.reached) reached.set(k, v);
      for (const [k, v] of cache.stops) stops.set(k, v);
    },
  };
}
