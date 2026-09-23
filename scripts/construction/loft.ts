import type { ConstructionHullStation } from '../../src/ships/blueprint/constructionTypes';
import type { Vec3 } from '../../src/ships/blueprint/blueprintTypes';
import { spanCut } from '../../src/ships/customHullSpans';
import { hullStation, round, type MeshView, type Point2, type Station } from './slice';

/** Fitting an adjustable custom hull to a measured reference: pick the stations that matter, resample each
 * outline, and reject a set that would fold before the native compiler sees it. Pure geometry — no files. */
export const MAX_STATIONS = 24;
export const MIN_STATIONS = 4;
export const MIN_POINTS = 5;
export const MAX_POINTS = 33;

export interface LoftOptions {
  /** Candidate stations are measured every `sampleM` along the hull. */
  sampleM?: number;
  maxStations?: number;
  /** Odd outline point count, 5–33, the same in every station. */
  points?: number;
  /** Stop adding stations once the worst half-breadth error falls below this, in metres. */
  toleranceM?: number;
  /** Interior stations are never allowed to taper to nothing; only the two ends may. */
  minInteriorHalfBreadthM?: number;
  /** An end station narrower than this fraction of the maximum half-breadth is collapsed to a point. */
  tipFraction?: number;
  maxDeckY?: number;
  samples?: number;
}
export interface LoftFit {
  size: Vec3;
  position: Vec3;
  stations: ConstructionHullStation[];
  measured: Station[];
  candidates: number;
  /** Worst and mean half-breadth error against the measured stations that were not chosen, in metres. */
  errorM: { max: number; mean: number; atZ: number };
  clampedTips: string[];
  /** End stations collapsed to a stem or transom point by the tip rule. */
  tips: string[];
}

/** Every station the reference actually yields, bow first. */
export function measureStations(view: MeshView, bounds: { min: Vec3; max: Vec3 }, options: LoftOptions = {}): Station[] {
  const step = Math.max(options.sampleM ?? 2, 0.1);
  const [from, to] = [bounds.min[2], bounds.max[2]];
  const found: Station[] = [];
  for (let z = from; z <= to + 1e-9; z += step) {
    const station = hullStation(view, Math.min(z, to), { maxDeckY: options.maxDeckY, samples: options.samples });
    if (station) found.push(station);
  }
  return found;
}

/** Half-breadth of a measured station at a height, used to compare two stations on the same scale. */
const widthAt = (station: Station, y: number): number => {
  const half = station.half;
  if (y >= half[0][1]) return half[0][0];
  if (y <= half[half.length - 1][1]) return half[half.length - 1][0];
  for (let i = 0; i + 1 < half.length; i++) {
    const [a, b] = [half[i], half[i + 1]];
    if (y <= a[1] && y >= b[1]) return a[0] + ((b[0] - a[0]) * (a[1] - y)) / (a[1] - b[1] || 1);
  }
  return 0;
};
/** Error of a station against the linear blend of its two chosen neighbours, sampled over the shared height range. */
function blendError(station: Station, low: Station, high: Station): number {
  const t = high.z === low.z ? 0 : (station.z - low.z) / (high.z - low.z);
  let worst = 0;
  for (let i = 0; i <= 8; i++) {
    const f = i / 8;
    const y = station.deckY - (station.deckY - station.keelY) * f;
    const blend = (1 - t) * widthAt(low, low.deckY - (low.deckY - low.keelY) * f) + t * widthAt(high, high.deckY - (high.deckY - high.keelY) * f);
    worst = Math.max(worst, Math.abs(widthAt(station, y) - blend));
  }
  const ends = Math.max(Math.abs(station.deckY - ((1 - t) * low.deckY + t * high.deckY)), Math.abs(station.keelY - ((1 - t) * low.keelY + t * high.keelY)));
  return Math.max(worst, ends);
}
/** Greedy refinement: keep both ends, then repeatedly add the station the current set represents worst. */
export function chooseStations(measured: Station[], options: LoftOptions = {}): { chosen: Station[]; indices: number[]; errorM: { max: number; mean: number; atZ: number } } {
  const limit = Math.min(Math.max(options.maxStations ?? MAX_STATIONS, MIN_STATIONS), MAX_STATIONS);
  if (measured.length < 2) throw new Error('The reference yielded fewer than two hull stations. Widen --box, add --parts hull, or cap the deck with --y.');
  const picked = new Set([0, measured.length - 1]);
  const worst = () => {
    const order = [...picked].sort((a, b) => a - b);
    let best = { error: 0, at: -1, z: measured[0].z };
    let total = 0;
    let counted = 0;
    for (let s = 0; s + 1 < order.length; s++)
      for (let i = order[s] + 1; i < order[s + 1]; i++) {
        const error = blendError(measured[i], measured[order[s]], measured[order[s + 1]]);
        total += error;
        counted++;
        if (error > best.error) best = { error, at: i, z: measured[i].z };
      }
    return { ...best, mean: counted ? total / counted : 0 };
  };
  let current = worst();
  while (picked.size < limit && current.at >= 0 && current.error > (options.toleranceM ?? 0.05)) {
    picked.add(current.at);
    current = worst();
  }
  // A four-station minimum is a format rule, not a fit choice: fill from the widest remaining gaps.
  while (picked.size < MIN_STATIONS && picked.size < measured.length) {
    const order = [...picked].sort((a, b) => a - b);
    let gap = { size: -1, at: -1 };
    for (let s = 0; s + 1 < order.length; s++) if (order[s + 1] - order[s] > gap.size) gap = { size: order[s + 1] - order[s], at: Math.floor((order[s] + order[s + 1]) / 2) };
    if (gap.at < 0 || picked.has(gap.at)) break;
    picked.add(gap.at);
  }
  const indices = [...picked].sort((a, b) => a - b);
  return { chosen: indices.map((i) => measured[i]), indices, errorM: { max: round(current.error, 4), mean: round(current.mean, 4), atZ: round(current.z, 3) } };
}

/** Resample a deck-to-keel half outline to `count` points spaced evenly by arc length, ends preserved. */
export function resampleHalf(half: Point2[], count: number): Point2[] {
  if (count < 2) throw new Error('A half outline needs at least two points.');
  const lengths = [0];
  for (let i = 0; i + 1 < half.length; i++) lengths.push(lengths[i] + Math.hypot(half[i + 1][0] - half[i][0], half[i + 1][1] - half[i][1]));
  const total = lengths[lengths.length - 1];
  if (!(total > 0)) throw new Error('A hull station collapsed to a single point.');
  const out: Point2[] = [half[0]];
  for (let i = 1; i < count - 1; i++) {
    const target = (total * i) / (count - 1);
    let at = 1;
    while (at < lengths.length - 1 && lengths[at] < target) at++;
    const span = lengths[at] - lengths[at - 1] || 1;
    const t = (target - lengths[at - 1]) / span;
    out.push([half[at - 1][0] + (half[at][0] - half[at - 1][0]) * t, half[at - 1][1] + (half[at][1] - half[at - 1][1]) * t]);
  }
  out.push(half[half.length - 1]);
  return out;
}

/** Measured stations to a custom-hull source: normalized, mirrored outlines plus the size and position they need. */
export function loftHull(chosen: Station[], options: LoftOptions = {}): Omit<LoftFit, 'measured' | 'candidates' | 'errorM'> {
  const points = options.points ?? 17;
  if (!Number.isInteger(points) || points % 2 !== 1 || points < MIN_POINTS || points > MAX_POINTS) throw new Error(`Outline points must be an odd whole number from ${MIN_POINTS} to ${MAX_POINTS}.`);
  if (chosen.length < MIN_STATIONS || chosen.length > MAX_STATIONS) throw new Error(`A custom hull needs ${MIN_STATIONS}–${MAX_STATIONS} stations; ${chosen.length} were chosen.`);
  const half = (points - 1) / 2;
  const zMin = chosen[0].z;
  const zMax = chosen[chosen.length - 1].z;
  const deck = Math.max(...chosen.map((station) => station.deckY));
  const keel = Math.min(...chosen.map((station) => station.keelY));
  const beam = Math.max(...chosen.map((station) => station.halfBreadth)) * 2;
  if (!(zMax - zMin > 0) || !(deck - keel > 0) || !(beam > 0)) throw new Error('The chosen stations have no length, depth or beam.');
  const size: Vec3 = [round(beam, 4), round(deck - keel, 4), round(zMax - zMin, 4)];
  const position: Vec3 = [0, round((deck + keel) / 2, 4), round((zMin + zMax) / 2, 4)];
  const minInterior = options.minInteriorHalfBreadthM ?? 0.05;
  const tipFraction = options.tipFraction ?? 0.2;
  const clampedTips: string[] = [];
  const tips: string[] = [];
  const stations = chosen.map((station, index) => {
    const end = index === 0 || index === chosen.length - 1;
    const resampled = resampleHalf(station.half, half + 1);
    // The tip rule: a narrow stem or transom becomes a true point. Only an end station may, and a sliver ring
    // makes the end cap fan degenerate, which the native builder rejects as a fold.
    if (end && station.halfBreadth < (beam / 2) * tipFraction) {
      tips.push('st' + index);
      for (const point of resampled) point[0] = 0;
    }
    // Only an end station may taper to nothing; an interior one is widened to the smallest legal width.
    if (!end && Math.max(...resampled.map((p) => p[0])) < minInterior) {
      clampedTips.push(station.z.toString());
      for (const point of resampled) point[0] = Math.max(point[0], minInterior);
    }
    const norm = (p: Point2) => [round((p[0] / beam) * 2, 6), round((p[1] - position[1]) / size[1], 6)] as Point2;
    const starboard = resampled.map(norm);
    // Port from the deck edge down, the keel, then starboard back up: the order the source format requires.
    const outline = [
      ...starboard.slice(0, half).map(([x, y]) => ({ x: -x, y })),
      { x: 0, y: starboard[half][1] },
      ...starboard.slice(0, half).reverse().map(([x, y]) => ({ x, y })),
    ];
    return { id: 'st' + index, t: round((station.z - zMin) / (zMax - zMin), 6), points: outline };
  });
  return { size, position, stations, clampedTips, tips };
}

/** World ring of a lofted station, using the same mapping the native compiler uses when rake and bulb are zero. */
export const stationRing = (station: ConstructionHullStation, size: Vec3, position: Vec3): Vec3[] =>
  station.points.map((point) => [point.x * (size[0] / 2) + position[0], point.y * size[1] + position[1], (station.t - 0.5) * size[2] + position[2]] as Vec3);
/** The native span check, ported so a fit is rejected here with the failing span named rather than by a compile that
 * only says a hull folds. A span that is not star-shaped falls back to the native band cut, as the compiler does;
 * only a span that neither cut accepts is reported. `construction_custom_hull.rs` remains the authority. */
export function foldFailures(stations: ConstructionHullStation[], size: Vec3, position: Vec3): { span: number; message: string }[] {
  const rings = stations.map((station) => stationRing(station, size, position));
  const failures: { span: number; message: string }[] = [];
  for (let span = 0; span + 1 < rings.length; span++) {
    const heights: [number[], number[]] = [stations[span].points.map((p) => p.y), stations[span + 1].points.map((p) => p.y)];
    const cut = spanCut(rings[span], rings[span + 1], heights);
    if (cut.cut === 'fold') failures.push({ span, message: `Sections "${stations[span].id}" and "${stations[span + 1].id}" fold through each other at the ${cut.label}.` });
  }
  return failures;
}
/** Spans the native builder will cut into horizontal bands rather than about one centre. */
export function bandedSpans(stations: ConstructionHullStation[], size: Vec3, position: Vec3): string[] {
  const rings = stations.map((station) => stationRing(station, size, position));
  return rings.slice(0, -1).flatMap((ring, span) =>
    spanCut(ring, rings[span + 1], [stations[span].points.map((p) => p.y), stations[span + 1].points.map((p) => p.y)]).cut === 'bands' ? [`${stations[span].id}–${stations[span + 1].id}`] : []);
}

/** Fit, then repair: a span the native check rejects is split by the measured station nearest its middle and
 * the fit is redone, until nothing folds or the station budget runs out. Folds that survive are reported. */
export function fitHull(measured: Station[], options: LoftOptions = {}): LoftFit & { folds: string[] } {
  const limit = Math.min(Math.max(options.maxStations ?? MAX_STATIONS, MIN_STATIONS), MAX_STATIONS);
  const first = chooseStations(measured, options);
  const picked = new Set(first.indices);
  let errorM = first.errorM;
  for (let attempt = 0; ; attempt++) {
    const indices = [...picked].sort((a, b) => a - b);
    const fit = loftHull(indices.map((i) => measured[i]), options);
    const folds = foldFailures(fit.stations, fit.size, fit.position);
    const room = picked.size < limit && attempt < MAX_STATIONS;
    if (!folds.length || !room)
      return { ...fit, measured, candidates: measured.length, errorM, folds: folds.map((failure) => failure.message) };
    let added = false;
    for (const { span } of folds) {
      const middle = Math.round((indices[span] + indices[span + 1]) / 2);
      if (middle > indices[span] && middle < indices[span + 1] && !picked.has(middle) && picked.size < limit) {
        picked.add(middle);
        added = true;
      }
    }
    if (!added) return { ...fit, measured, candidates: measured.length, errorM, folds: folds.map((failure) => failure.message) };
    errorM = chooseStations(measured, options).errorM;
  }
}
