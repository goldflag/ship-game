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
  /** Protrusions shorter than this in height (bilge keels, shaft brackets) are cut back to the hull; 0 keeps them. */
  finM?: number;
  /** A turn sharper than this, in degrees, is a corner: a knuckle, chine or step kept as a crease. */
  creaseDeg?: number;
  /** At most this many corner lines besides the flat-bottom chine; default a quarter of the points on one side. */
  maxCreases?: number;
}
/** One pinned corner line along the hull: a shared outline index in every section, and a lighting crease when sharp. */
export interface LoftCrease {
  /** Port-side contour position on the 0–8 outline scale; the starboard twin is 8 minus it. */
  contour: number;
  /** Outline point index on the port side, counted from the deck edge. */
  index: number;
  kind: 'chine' | 'corner';
  /** Mean height of the corner in the sections that have it, in ship metres. */
  y: number;
  /** Sections whose measured outline turns by at least `creaseDeg` there. */
  sections: number;
  maxTurnDeg: number;
  /** Written to `customHull.creases`; false for a chine pin that only keeps a round-bilge flat bottom flat. */
  crease: boolean;
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
  /** Pinned corner lines, deck edge to keel. */
  pins: LoftCrease[];
  /** `customHull.creases`: the pinned lines sharp enough to break the side lighting. */
  creases: number[];
}

export const DEFAULT_FIN_M = 1;
export const DEFAULT_CREASE_DEG = 10;
/** Hull form without thin appendages: a width that exceeds, by more than `excessM`, what the outline returns to both
 * above and below within `finM` of height is a fin (a bilge keel, a shaft bracket) and is cut back to that width. The
 * deck edge and the keel are never cut, and a broad bulge (a forefoot, a torpedo bulge) keeps its shape. */
export function removeFins(half: Point2[], finM: number, excessM = 0.15): Point2[] {
  if (!(finM > 0)) return half;
  const fin = half.map(([x, y], j) => {
    let [above, below] = [Infinity, Infinity];
    for (let i = j - 1; i >= 0 && half[i][1] - y <= finM; i--) above = Math.min(above, half[i][0]);
    for (let i = j + 1; i < half.length && y - half[i][1] <= finM; i++) below = Math.min(below, half[i][0]);
    return Math.max(above, below) < x - excessM;
  });
  // A fin is replaced by the straight line between the hull points above and below it.
  return half.map(([x, y], j) => {
    if (!fin[j]) return [x, y] as Point2;
    let [a, b] = [j - 1, j + 1];
    while (fin[a]) a--;
    while (fin[b]) b++;
    const t = half[a][1] === half[b][1] ? 0 : (half[a][1] - y) / (half[a][1] - half[b][1]);
    return [round(half[a][0] + (half[b][0] - half[a][0]) * t, 4), y] as Point2;
  });
}
function withoutFins(station: Station, finM: number): Station {
  const half = removeFins(station.half, finM);
  let area = 0;
  for (let i = 0; i + 1 < half.length; i++) area += (half[i][0] + half[i + 1][0]) * (half[i][1] - half[i + 1][1]);
  return { ...station, half, halfBreadth: round(Math.max(...half.map((p) => p[0])), 3), areaM2: round(area, 2) };
}

/** Every station the reference actually yields, bow first. */
export function measureStations(view: MeshView, bounds: { min: Vec3; max: Vec3 }, options: LoftOptions = {}): Station[] {
  const step = Math.max(options.sampleM ?? 2, 0.1);
  const [from, to] = [bounds.min[2], bounds.max[2]];
  const found: Station[] = [];
  for (let z = from; z <= to + 1e-9; z += step) {
    const station = hullStation(view, Math.min(z, to), { maxDeckY: options.maxDeckY, samples: options.samples });
    if (station) found.push(withoutFins(station, options.finM ?? DEFAULT_FIN_M));
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
  return resamplePinned(half, [], count);
}
const arcLengths = (line: Point2[]) => {
  const lengths = [0];
  for (let i = 0; i + 1 < line.length; i++) lengths.push(lengths[i] + Math.hypot(line[i + 1][0] - line[i][0], line[i + 1][1] - line[i][1]));
  return lengths;
};
const pointAtArc = (line: Point2[], lengths: number[], target: number): Point2 => {
  let at = 1;
  while (at < lengths.length - 1 && lengths[at] < target) at++;
  const span = lengths[at] - lengths[at - 1] || 1;
  const t = Math.min(Math.max((target - lengths[at - 1]) / span, 0), 1);
  return [line[at - 1][0] + (line[at][0] - line[at - 1][0]) * t, line[at - 1][1] + (line[at][1] - line[at - 1][1]) * t];
};
/** Resample a deck-to-keel line to `count` points: each pin (an arc length and the output index it must land on)
 * is hit exactly, and the points between two pins are spaced evenly by arc length. Both ends are kept. */
export function resamplePinned(line: Point2[], pins: { arc: number; index: number }[], count: number): Point2[] {
  if (count < 2) throw new Error('A half outline needs at least two points.');
  const lengths = arcLengths(line);
  const total = lengths[lengths.length - 1];
  if (!(total > 0)) throw new Error('A hull station collapsed to a single point.');
  const anchors = [{ arc: 0, index: 0 }, ...pins, { arc: total, index: count - 1 }];
  const out: Point2[] = [line[0]];
  for (let k = 0; k + 1 < anchors.length; k++) {
    const [from, to] = [anchors[k], anchors[k + 1]];
    for (let i = from.index + 1; i <= to.index; i++)
      out.push(i === count - 1 ? line[line.length - 1] : pointAtArc(line, lengths, from.arc + ((to.arc - from.arc) * (i - from.index)) / (to.index - from.index)));
  }
  return out;
}
/** The measured half outline closed to the keel centreline. A flat bottom keeps its chine: the nearly level run at the
 * keel (under `flatDeg` of rise) ends at the chine, which stays a point of its own with the keel added beside it on the
 * centreline. Before, the keel point was dragged to the centreline, which turned a flat bottom and its bilge into a V. */
export function keelLine(half: Point2[], flatDeg = 10): { line: Point2[]; chine: boolean } {
  let j = half.length - 1;
  const rise = (a: Point2, b: Point2) => (Math.atan2(Math.abs(a[1] - b[1]), Math.abs(a[0] - b[0])) * 180) / Math.PI;
  while (j > 1 && rise(half[j - 1], half[j]) < flatDeg) j--;
  const keel: Point2 = [0, half[half.length - 1][1]];
  if (half[j][0] > 1e-3) return { line: [...half.slice(0, j + 1), keel], chine: true };
  return { line: [...half.slice(0, -1), keel], chine: false };
}
/** Corners in a deck-to-keel line: the angle between the chords reaching `reach` metres back and forward of a vertex,
 * kept where it is the sharpest within that reach. A corner turns about as much at half the reach; a smooth bilge
 * or flare turns half as much, so curvature is not mistaken for a crease. The ends are not corners. */
export function outlineCorners(line: Point2[], minDeg: number, reach = 0.3): { at: number; arc: number; y: number; turnDeg: number }[] {
  const lengths = arcLengths(line);
  const turn = (j: number, distance: number) => {
    let [b, f] = [j - 1, j + 1];
    while (b > 0 && lengths[j] - lengths[b] < distance) b--;
    while (f < line.length - 1 && lengths[f] - lengths[j] < distance) f++;
    const [ix, iy, ox, oy] = [line[j][0] - line[b][0], line[j][1] - line[b][1], line[f][0] - line[j][0], line[f][1] - line[j][1]];
    const norms = Math.hypot(ix, iy) * Math.hypot(ox, oy);
    return norms > 0 ? (Math.acos(Math.min(1, Math.max(-1, (ix * ox + iy * oy) / norms))) * 180) / Math.PI : 0;
  };
  const turns = line.map((_, j) => (j === 0 || j === line.length - 1 ? 0 : turn(j, reach)));
  const found = [];
  for (let j = 1; j + 1 < line.length; j++) {
    if (turns[j] < minDeg || turn(j, reach / 2) < 0.7 * turns[j]) continue;
    let sharpest = true;
    for (let i = 1; i + 1 < line.length && sharpest; i++)
      if (i !== j && Math.abs(lengths[i] - lengths[j]) < reach && (turns[i] > turns[j] || (turns[i] === turns[j] && i < j))) sharpest = false;
    if (sharpest) found.push({ at: j, arc: lengths[j], y: line[j][1], turnDeg: turns[j] });
  }
  return found;
}
/** Where a deck-to-keel line first comes down to height `y`, as an arc length. */
function arcAtHeight(line: Point2[], lengths: number[], y: number): number {
  if (y >= line[0][1]) return 0;
  for (let i = 0; i + 1 < line.length; i++) {
    const [a, b] = [line[i], line[i + 1]];
    if (y <= a[1] && y >= b[1]) return lengths[i] + (lengths[i + 1] - lengths[i]) * (a[1] === b[1] ? 0 : (a[1] - y) / (a[1] - b[1]));
  }
  return lengths[lengths.length - 1];
}

/** A corner line along the hull, followed through consecutive measured stations. */
interface CornerLine { members: Map<number, { y: number; arc: number; turnDeg: number }>; score: number; maxTurnDeg: number }
/** Chord reach for corner detection: 6 % of the section depth, 0.3–1 m. */
const cornerReach = (line: Point2[]) => Math.min(Math.max(0.06 * (line[0][1] - line[line.length - 1][1]), 0.3), 1);
/** Corners of one measured station that can be crease lines: clear of the deck edge lip and of the bottom. */
function stationCorners(entry: { line: Point2[]; chine: boolean }, creaseDeg: number) {
  const lengths = arcLengths(entry.line);
  const reach = cornerReach(entry.line);
  const bottom = entry.chine ? lengths[entry.line.length - 2] : lengths[lengths.length - 1];
  return outlineCorners(entry.line, creaseDeg, reach).filter((c) => c.arc > reach / 2 && c.arc < bottom - reach);
}
/** Follow corners from station to station, bow to stern: a corner continues the line whose last corner, one or two
 * stations back, is nearest in height (within `stepM`). Lines seen in at least three stations are kept. */
export function cornerLines(measured: Station[], creaseDeg: number, stepM = 0.6): CornerLine[] {
  const lines: (CornerLine & { last: number; lastY: number })[] = [];
  measured.forEach((station, s) => {
    const taken = new Set<number>();
    const corners = stationCorners(keelLine(station.half), creaseDeg).sort((a, b) => b.turnDeg - a.turnDeg);
    for (const corner of corners) {
      let best = -1;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (taken.has(i) || s - line.last > 3 || s === line.last || Math.abs(line.lastY - corner.y) > stepM) continue;
        if (best < 0 || Math.abs(line.lastY - corner.y) < Math.abs(lines[best].lastY - corner.y)) best = i;
      }
      if (best < 0) {
        best = lines.push({ members: new Map(), score: 0, maxTurnDeg: 0, last: s, lastY: corner.y }) - 1;
      }
      const line = lines[best];
      taken.add(best);
      line.members.set(station.z, { y: corner.y, arc: corner.arc, turnDeg: corner.turnDeg });
      line.score += corner.turnDeg;
      line.maxTurnDeg = Math.max(line.maxTurnDeg, corner.turnDeg);
      [line.last, line.lastY] = [s, corner.y];
    }
  });
  return lines.filter((line) => line.members.size >= 3).map(({ members, score, maxTurnDeg }) => ({ members, score, maxTurnDeg }));
}

/** Corner lines shared by the hull become pins: the same outline index in every chosen section, at the corner where a
 * section has one, at the line's interpolated height where the line runs past a section without a corner, and spaced
 * like any other point where the line does not reach. A flat bottom's chine is pinned one point above the keel so
 * the bottom stays flat. Indices follow the mean position of each pin along the side. */
export function pinCorners(chosen: Station[], lines: { line: Point2[]; chine: boolean }[], half: number, options: LoftOptions = {}, context: Station[] = chosen) {
  const creaseDeg = options.creaseDeg ?? DEFAULT_CREASE_DEG;
  const chine = lines.some((entry) => entry.chine);
  const lengths = lines.map(({ line }) => arcLengths(line));
  const chineArc = lines.map(({ line, chine: flat }, s) => (flat ? lengths[s][line.length - 2] : lengths[s][line.length - 1]));
  const slots = half - 1 - (chine ? 1 : 0);
  const limit = Math.max(0, Math.min(options.maxCreases ?? Math.floor(half / 4), slots));
  // Strongest first. A line within 0.75 m of a stronger one where both run (the two edges of a belt step) adds no pin;
  // one that continues a stronger line fore or aft, at its height, joins it.
  let found: CornerLine[] = [];
  for (const line of cornerLines(context, creaseDeg).sort((a, b) => b.score - a.score)) {
    let joined = false;
    for (const kept of found) {
      const shared = [...line.members.entries()].filter(([z]) => kept.members.has(z));
      if (shared.length) {
        if (shared.reduce((sum, [z, m]) => sum + Math.abs(m.y - kept.members.get(z)!.y), 0) / shared.length < 0.75) joined = true;
        continue;
      }
      const ends = (members: CornerLine['members']) => [...members.entries()].sort((a, b) => a[0] - b[0]);
      const [mine, theirs] = [ends(line.members), ends(kept.members)];
      const [a, b] = mine[0][0] > theirs[theirs.length - 1][0] ? [theirs[theirs.length - 1], mine[0]] : mine[mine.length - 1][0] < theirs[0][0] ? [mine[mine.length - 1], theirs[0]] : [undefined, undefined];
      if (a && b && Math.abs(a[1].y - b[1].y) < 0.75) {
        for (const [z, m] of line.members) kept.members.set(z, m);
        kept.score += line.score;
        kept.maxTurnDeg = Math.max(kept.maxTurnDeg, line.maxTurnDeg);
        joined = true;
      }
      if (joined) break;
    }
    if (!joined) found.push(line);
  }
  found.sort((a, b) => b.score - a.score).splice(limit);
  // Arc position of each line in each chosen section, or undefined where the line does not reach it.
  const reachOf = (line: CornerLine, s: number): number | undefined => {
    const member = line.members.get(chosen[s].z);
    if (member) return member.arc;
    const zs = [...line.members.keys()].sort((a, b) => a - b);
    const z = chosen[s].z;
    if (z < zs[0] || z > zs[zs.length - 1]) return undefined;
    const i = zs.findIndex((value) => value > z);
    const [a, b] = [line.members.get(zs[i - 1])!, line.members.get(zs[i])!];
    const y = a.y + ((b.y - a.y) * (z - zs[i - 1])) / (zs[i] - zs[i - 1]);
    return arcAtHeight(lines[s].line, lengths[s], y);
  };
  // Order lines by their mean position along the side, deck first.
  const fraction = (line: CornerLine) => {
    const values = chosen.flatMap((_, s) => {
      const arc = reachOf(line, s);
      return arc === undefined ? [] : [arc / (chineArc[s] || 1)];
    });
    return values.length ? values.reduce((a, b) => a + b, 0) / values.length : NaN;
  };
  const tracks = found.map((line) => ({ line, fraction: fraction(line) })).filter((track) => Number.isFinite(track.fraction)).sort((a, b) => a.fraction - b.fraction);
  // Deck edge to chine (or keel) is shared out by mean position; the flat bottom always takes one interval.
  const intervals = chine ? half - 1 : half;
  const indices = tracks.map((track) => Math.round(track.fraction * intervals));
  for (let k = 0; k < indices.length; k++) indices[k] = Math.max(indices[k], k ? indices[k - 1] + 1 : 1);
  for (let k = indices.length - 1; k >= 0; k--) indices[k] = Math.min(indices[k], k === indices.length - 1 ? intervals - 1 : indices[k + 1] - 1);
  const arcs = lines.map((_, s) => {
    const placed: (number | undefined)[] = tracks.map((track) => reachOf(track.line, s));
    // A pin its line does not reach is spaced by index between the pins either side, like an ordinary point.
    const anchor = (k: number) => (k < 0 ? { arc: 0, index: 0 } : k >= placed.length ? { arc: chineArc[s], index: intervals } : placed[k] === undefined ? undefined : { arc: placed[k]!, index: indices[k] });
    const filled = placed.map((arc, k) => {
      if (arc !== undefined) return arc;
      let [before, after] = [k - 1, k + 1];
      while (before >= 0 && placed[before] === undefined) before--;
      while (after < placed.length && placed[after] === undefined) after++;
      const [a, b] = [anchor(before)!, anchor(after)!];
      return a.arc + ((b.arc - a.arc) * (indices[k] - a.index)) / (b.index - a.index);
    });
    for (let k = 0; k < filled.length; k++) filled[k] = Math.min(Math.max(filled[k], k ? filled[k - 1] : 0), chineArc[s]);
    return [...filled.map((arc, k) => ({ arc, index: indices[k] })), ...(chine ? [{ arc: chineArc[s], index: half - 1 }] : [])];
  });
  const pins: Omit<LoftCrease, 'contour'>[] = tracks.map(({ line }, k) => {
    const members = [...line.members.values()];
    return { index: indices[k], kind: 'corner', y: round(members.reduce((sum, m) => sum + m.y, 0) / members.length, 3), sections: line.members.size, maxTurnDeg: round(line.maxTurnDeg, 1), crease: true };
  });
  if (chine) {
    const turns = lines.map((entry) => (entry.chine ? (outlineCorners(entry.line, 0, cornerReach(entry.line)).find((c) => c.at === entry.line.length - 2)?.turnDeg ?? 0) : 0));
    const sharp = turns.filter((turn) => turn >= creaseDeg).length;
    pins.push({
      index: half - 1, kind: 'chine', y: round(lines.reduce((sum, { line }) => sum + line[line.length - 2][1], 0) / lines.length, 3),
      sections: sharp, maxTurnDeg: round(Math.max(...turns), 1), crease: sharp * 2 >= lines.filter((entry) => entry.chine).length,
    });
  }
  return { pins, arcs };
}

/** Measured stations to a custom-hull source: normalized, mirrored outlines plus the size and position they need. */
export function loftHull(chosen: Station[], options: LoftOptions = {}, context: Station[] = chosen): Omit<LoftFit, 'measured' | 'candidates' | 'errorM'> {
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
  const lines = chosen.map((station) => keelLine(station.half));
  const { pins, arcs } = pinCorners(chosen, lines, half, options, context);
  const stations = chosen.map((station, index) => {
    const end = index === 0 || index === chosen.length - 1;
    const resampled = resamplePinned(lines[index].line, arcs[index], half + 1);
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
  const contoured = pins.map((pin) => ({ ...pin, contour: round((pin.index * 8) / (points - 1), 6) }));
  return { size, position, stations, clampedTips, tips, pins: contoured, creases: contoured.filter((pin) => pin.crease).map((pin) => pin.contour) };
}

/** How closely a lofted hull follows every measured station: the half-breadth error over each section's depth and
 * the section area, taking the hull between two sections as the straight blend of their outline points. */
export function fitAccuracy(fit: Pick<LoftFit, 'size' | 'position' | 'stations'>, measured: Station[]) {
  const toMetres = (station: ConstructionHullStation): Point2[] =>
    station.points.slice((station.points.length - 1) / 2).map((p) => [p.x * (fit.size[0] / 2), p.y * fit.size[1] + fit.position[1]] as Point2);
  const zAtBow = fit.position[2] - fit.size[2] / 2;
  const widthOf = (outline: Point2[], y: number) => {
    let width = 0;
    for (let i = 0; i + 1 < outline.length; i++) {
      const [a, b] = [outline[i], outline[i + 1]];
      if (y < Math.min(a[1], b[1]) - 1e-9 || y > Math.max(a[1], b[1]) + 1e-9) continue;
      width = Math.max(width, a[1] === b[1] ? Math.max(a[0], b[0]) : a[0] + ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]));
    }
    return width;
  };
  const rows = measured.flatMap((station) => {
    const t = (station.z - zAtBow) / fit.size[2];
    if (t < -1e-6 || t > 1 + 1e-6) return [];
    const j = Math.max(0, Math.min(fit.stations.length - 2, fit.stations.findIndex((s) => s.t >= t) - 1));
    const [a, b] = [toMetres(fit.stations[j]), toMetres(fit.stations[j + 1])];
    const f = Math.min(Math.max((t - fit.stations[j].t) / (fit.stations[j + 1].t - fit.stations[j].t), 0), 1);
    // Starboard half from the keel up to the deck edge.
    const blend = a.map((p, k) => [p[0] + (b[k][0] - p[0]) * f, p[1] + (b[k][1] - p[1]) * f] as Point2);
    // Half-breadth is compared from 0.25 m above the keel up, with heights clamped into the fitted section, so a deck
    // a few centimetres off or a bottom with a few centimetres of rise counts as that, not as a whole beam.
    const [low, high] = [blend[0][1], blend[blend.length - 1][1]];
    let worst = 0;
    for (const [, y] of station.half)
      if (y >= station.keelY + 0.25) worst = Math.max(worst, Math.abs(widthOf(blend, Math.min(Math.max(y, low), high)) - widthOf(station.half, y)));
    // The distance from each measured outline point to the fitted outline, which does not blow up where a side runs flat.
    let offset = 0;
    for (const p of station.half) {
      let nearest = Infinity;
      for (let i = 0; i + 1 < blend.length; i++) {
        const [a, b] = [blend[i], blend[i + 1]];
        const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
        const t = dx || dy ? Math.min(Math.max(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy), 0), 1) : 0;
        nearest = Math.min(nearest, Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t));
      }
      offset = Math.max(offset, nearest);
    }
    const deckM = Math.max(Math.abs(high - station.deckY), Math.abs(low - station.keelY));
    // Both sides: twice the area between the starboard half and the centreline.
    let area = 0;
    for (let i = 0; i + 1 < blend.length; i++) area += (blend[i][0] + blend[i + 1][0]) * (blend[i + 1][1] - blend[i][1]);
    return [{ z: station.z, errorM: round(worst, 3), offsetM: round(offset, 3), deckKeelErrorM: round(deckM, 3), areaM2: station.areaM2, fittedAreaM2: round(area, 2) }];
  });
  const errors = rows.map((row) => row.errorM);
  const areaErrors = rows.filter((row) => row.areaM2 > 1).map((row) => Math.abs(row.fittedAreaM2 - row.areaM2) / row.areaM2);
  const worst = rows.reduce((best, row) => (row.errorM > best.errorM ? row : best), rows[0]);
  const worstArea = rows.filter((row) => row.areaM2 > 1).reduce((best, row) => (Math.abs(row.fittedAreaM2 - row.areaM2) / row.areaM2 > Math.abs(best.fittedAreaM2 - best.areaM2) / best.areaM2 ? row : best), rows[0]);
  return {
    outlineOffsetM: { max: round(Math.max(...rows.map((row) => row.offsetM)), 3), mean: round(rows.reduce((sum, row) => sum + row.offsetM, 0) / rows.length, 3), atZ: rows.reduce((best, row) => (row.offsetM > best.offsetM ? row : best), rows[0]).z },
    halfBreadthErrorM: { max: round(Math.max(...errors), 3), mean: round(errors.reduce((a, b) => a + b, 0) / errors.length, 3), atZ: worst.z },
    deckKeelErrorM: { max: round(Math.max(...rows.map((row) => row.deckKeelErrorM)), 3), atZ: rows.reduce((best, row) => (row.deckKeelErrorM > best.deckKeelErrorM ? row : best), rows[0]).z },
    sectionAreaErrorPct: { max: round(Math.max(...areaErrors) * 100, 2), mean: round((areaErrors.reduce((a, b) => a + b, 0) / areaErrors.length) * 100, 2), atZ: worstArea.z },
    rows,
  };
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
    const fit = loftHull(indices.map((i) => measured[i]), options, measured);
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
