/** `ship:lines <id> [--ref <vehicle>]`: measure hull lines from a cached GameModels3D reference and write the
 * ship's authoring lines file, the table a Blender-recipe preset lofts its hull from.
 *
 * Replaces the per-ship measure_hull.py / make_lines.py scratch scripts of the Hood, Hipper, KGV and cruiser
 * passes. Each station is cut across the reference hull; the starboard shell is followed up and down from its
 * widest point below `--widest-below` or near the waterline, whichever outline encloses more, by extrapolating
 * from the last crossings, so shaft bossings, bilge keels,
 * rails and flush deckhouse walls are not followed; the deck is the lowest horizontal plating that reaches the
 * shell and spans inboard. Decks are smoothed by a running median between deck breaks (found where the deck
 * steps by more than 0.5 m between neighbouring stations), keels by a running median that only rises toward
 * the stem and the stern. Control stations are 0.5 m apart within 6 m of either end, 1 m within 22 m and 2 m
 * elsewhere, plus a pair either side of each break.
 *
 * Two formats, both in the runtime frame (+X starboard, +Y up with y = 0 the waterline, −Z bow, metres) with the
 * hull centred on its overall length:
 * - `offsets` (Hood, Hipper, Baltimore, Fubuki): rows `[z, keel, deck, half-breadths]`, the half-breadths at the
 *   `LOW` fractions from the keel to `H0` and the `HIGH` fractions from `H0` to the deck; near the ends, where the
 *   keel rises above `H0 - endMargin`, `H0` becomes `keel + (deck - keel) * endFraction`.
 * - `sections` (Fletcher, and `author-blueprint.py --loft` of a `ship:new --legacy` scaffold): sections by
 *   station from the transom (0) to the stem (length), each `[[half-breadth, height], …]` at the same levels.
 *
 * Measurement only: numbers from ignored `.build/references/`; no reference geometry is written. */
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { readReference, selectTriangles, type ReferenceMesh } from '../construction/reference';
import { suggestedVehicles } from '../../tools/ship-overlay/reference';

const ROOT = resolve(import.meta.dir, '../..');
type Pair = [number, number];

export interface LevelRule {
  LOW: number[];
  HIGH: number[];
  H0: number;
  endMargin: number;
  endFraction: number;
}
/** Hood's and Hipper's levels: twenty from the keel to H0, four from H0 to the deck, so a deck break moves only the top four. */
export const DEFAULT_RULE: LevelRule = {
  LOW: [0, 0.004, 0.012, 0.025, 0.045, 0.07, 0.1, 0.14, 0.19, 0.25, 0.32, 0.4, 0.48, 0.56, 0.64, 0.72, 0.8, 0.87, 0.94, 1],
  HIGH: [0.25, 0.5, 0.75, 1],
  H0: 1.5,
  endMargin: 1,
  endFraction: 0.75,
};
export function levelHeights(keel: number, deck: number, rule: LevelRule): number[] {
  const h0 = keel < rule.H0 - rule.endMargin ? rule.H0 : keel + (deck - keel) * rule.endFraction;
  return [...rule.LOW.map((u) => keel + (h0 - keel) * u), ...rule.HIGH.map((u) => h0 + (deck - h0) * u)];
}

/** Hull triangles binned by z, so a station cut visits only the triangles that can cross it. */
export class HullSlicer {
  readonly tris: Float64Array;
  readonly zMin: number;
  readonly zMax: number;
  private readonly bins: Uint32Array[];
  private static readonly BIN = 1;
  constructor(positions: ArrayLike<number>, index: ArrayLike<number>, ranges: { first: number; count: number }[]) {
    const count = ranges.reduce((n, r) => n + r.count, 0);
    this.tris = new Float64Array(count * 9);
    let at = 0, lo = Infinity, hi = -Infinity;
    for (const r of ranges)
      for (let t = r.first; t < r.first + r.count; t++)
        for (let c = 0; c < 3; c++) {
          const v = index[t * 3 + c] * 3;
          for (let k = 0; k < 3; k++) this.tris[at++] = positions[v + k];
          lo = Math.min(lo, positions[v + 2]); hi = Math.max(hi, positions[v + 2]);
        }
    this.zMin = lo; this.zMax = hi;
    const n = Math.max(1, Math.ceil((hi - lo) / HullSlicer.BIN) + 1);
    const lists: number[][] = Array.from({ length: n }, () => []);
    for (let t = 0; t < count; t++) {
      const z0 = Math.min(this.tris[t * 9 + 2], this.tris[t * 9 + 5], this.tris[t * 9 + 8]);
      const z1 = Math.max(this.tris[t * 9 + 2], this.tris[t * 9 + 5], this.tris[t * 9 + 8]);
      for (let b = Math.floor((z0 - lo) / HullSlicer.BIN); b <= Math.floor((z1 - lo) / HullSlicer.BIN); b++) lists[b].push(t);
    }
    this.bins = lists.map((l) => Uint32Array.from(l));
  }
  static fromReference(mesh: ReferenceMesh, parts = ['hull']) {
    const hasHull = mesh.meta.parts.some((p) => parts.includes(p.group) || parts.includes(p.key));
    return new HullSlicer(mesh.positions, mesh.index, selectTriangles(mesh.meta, hasHull ? parts : undefined));
  }
  /** Segments (x, y) where the plane at `z` crosses the hull. */
  cut(z: number): [Pair, Pair][] {
    const b = Math.floor((z - this.zMin) / HullSlicer.BIN);
    if (b < 0 || b >= this.bins.length) return [];
    const out: [Pair, Pair][] = [];
    const T = this.tris;
    for (const t of this.bins[b]) {
      const hits: Pair[] = [];
      for (let e = 0; e < 3; e++) {
        const a = t * 9 + e * 3, c = t * 9 + ((e + 1) % 3) * 3;
        const da = T[a + 2] - z, dc = T[c + 2] - z;
        if (da < 0 === dc < 0) continue;
        const s = da / (da - dc);
        hits.push([T[a] + (T[c] - T[a]) * s, T[a + 1] + (T[c + 1] - T[a + 1]) * s]);
      }
      if (hits.length === 2 && (hits[0][0] !== hits[1][0] || hits[0][1] !== hits[1][1])) out.push([hits[0], hits[1]]);
    }
    return out;
  }
}

export interface StationOptions {
  /** Height sampling step in metres. */
  dy?: number;
  /** The walk starts from the widest crossing below this height (else below 9 m), or from the widest between 0.5 m
   * below the waterline and this height, whichever outline encloses more. */
  widestBelow?: number;
  /** The downward walk stops where the shell comes within this of the centreline: the keel. */
  keelWidth?: number;
  /** No deck above this height: caps the walk where deckhouse sides run flush with the hull's. */
  deckBelow?: number;
}
export interface MeasuredStation {
  z: number;
  deck: number;
  keel: number;
  top: number;
  /** (height, half-breadth), keel up to the deck. */
  points: Pair[];
}

/** Follow the crossings one height step at a time from `k0`, taking the one nearest a linear extrapolation. */
function walk(outer: number[][], k0: number, w0: number, step: 1 | -1, stopAt: number): Map<number, number> {
  const profile = new Map<number, number>([[k0, w0]]);
  const hist = [w0];
  let k = k0 + step, miss = 0;
  while (k >= 0 && k < outer.length) {
    const c = outer[k];
    const slope = hist.length > 1 ? hist[hist.length - 1] - hist[hist.length - 2] : 0;
    const pred = hist[hist.length - 1] + slope;
    if (c.length) {
      let x = c[0];
      for (const v of c) if (Math.abs(v - pred) < Math.abs(x - pred)) x = v;
      const tol = 0.12 + 0.5 * Math.abs(slope) + miss * 0.08;
      if (Math.abs(x - pred) <= tol && !(step < 0 && x < stopAt)) {
        profile.set(k, x); hist.push(x); miss = 0; k += step;
        continue;
      }
    }
    if (++miss > 12) break;
    k += step;
  }
  return profile;
}

/** One hull station from its cut segments: the starboard shell from the keel to the deck edge. */
export function measureStation(segments: [Pair, Pair][], z: number, options: StationOptions = {}): MeasuredStation | undefined {
  if (!segments.length) return undefined;
  const dy = options.dy ?? 0.04;
  let y0 = Infinity, y1 = -Infinity;
  for (const [a, b] of segments) { y0 = Math.min(y0, a[1], b[1]); y1 = Math.max(y1, a[1], b[1]); }
  const count = Math.ceil((y1 + dy - y0) / dy - 1e-9);
  const ys = Array.from({ length: count }, (_, k) => y0 + k * dy);
  const outer: number[][] = ys.map(() => []);
  for (const [a, b] of segments) {
    if (Math.abs(a[1] - b[1]) < 1e-4) continue;
    const lo = Math.min(a[1], b[1]), hi = Math.max(a[1], b[1]);
    for (let k = Math.max(0, Math.ceil((lo - y0) / dy - 1e-9)); k < count && ys[k] <= hi + 1e-9; k++) {
      const x = a[0] + ((ys[k] - a[1]) / (b[1] - a[1])) * (b[0] - a[0]);
      if (x > 0) outer[k].push(x);
    }
  }
  const widest = (above: number, below: number) => {
    let best: Pair | undefined;
    for (let k = 0; k < count; k++) if (outer[k].length && ys[k] >= above && ys[k] < below) {
      const w = Math.max(...outer[k]);
      if (!best || w > best[1]) best = [k, w];
    }
    return best;
  };
  // Walk from the widest crossing below `widestBelow` and from the widest in the waterline band, and keep the
  // outline that encloses more: a bilge keel standing out past the shell starts a short walk that ends at its root,
  // and a start on an inner surface misses the bulge outside it.
  const below = options.widestBelow ?? 3;
  let profile: Map<number, number> | undefined, score = -1;
  const starts = [widest(-Infinity, below) ?? widest(-Infinity, 9), widest(-0.5, below)];
  for (const start of starts) {
    if (!start || (profile && start === starts[0])) continue;
    const [k0, w0] = start;
    const candidate = walk(outer, k0, w0, 1, 0);
    for (const [k, w] of walk(outer, k0, w0, -1, options.keelWidth ?? 0.3)) candidate.set(k, w);
    let sum = 0;
    for (const w of candidate.values()) sum += w;
    if (sum > score + 1e-9) { profile = candidate; score = sum; }
  }
  if (!profile) return undefined;
  const ks = [...profile.keys()].sort((a, b) => a - b);
  const top = ys[ks[ks.length - 1]];
  const widthNear = (y: number) => {
    let best = ks[0];
    for (const k of ks) if (Math.abs(ys[k] - y) < Math.abs(ys[best] - y)) best = k;
    return Math.abs(ys[best] - y) < 0.2 ? profile.get(best)! : undefined;
  };
  // Horizontal plating that does not cross the centreline: (height, inboard end, outboard end).
  const flats: [number, number, number][] = [];
  for (const [a, b] of segments)
    if (Math.abs(a[1] - b[1]) < 1e-3 && a[0] * b[0] >= -1e-6)
      flats.push([a[1], Math.min(Math.abs(a[0]), Math.abs(b[0])), Math.max(Math.abs(a[0]), Math.abs(b[0]))]);
  let deck: number | undefined;
  const cap = Math.min(top + 0.06, options.deckBelow ?? Infinity);
  const heights = [...new Set(flats.filter((f) => f[0] > 1 && f[0] <= cap).map((f) => Math.round(f[0] * 1000) / 1000))].sort((a, b) => a - b);
  for (const y of heights) {
    const w = widthNear(y - 0.03);
    if (w === undefined || w < 0.15) continue;
    const spans = flats.filter((f) => Math.abs(f[0] - y) < 0.004 && f[2] > w - 0.7);
    if (spans.length && Math.min(...spans.map((f) => f[1])) < Math.max(0.5 * w, w - 2.5)) { deck = y; break; }
  }
  deck ??= Math.min(top, options.deckBelow ?? Infinity);
  const points = ks.filter((k) => ys[k] <= deck! + 1e-6).map((k): Pair => [ys[k], profile.get(k)!]);
  if (points.length < 5) return undefined;
  return { z, deck, keel: ys[ks[0]], top, points };
}

/** Linear interpolation of the half-breadth at `y`, held at the end values outside the measured heights. */
export function widthAt(points: Pair[], y: number): number {
  if (y <= points[0][0]) return points[0][1];
  if (y >= points[points.length - 1][0]) return points[points.length - 1][1];
  let i = 1;
  while (points[i][0] < y) i++;
  const [ya, wa] = points[i - 1], [yb, wb] = points[i];
  return yb - ya < 1e-12 ? wb : wa + ((y - ya) / (yb - ya)) * (wb - wa);
}

const median = (values: number[]) => {
  const s = [...values].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/** Deck breaks: where the running median of the deck (thirteen stations) steps by more than `minStep`. A run of up
 * to six stations whose deck was misread (a bulwark, a flush deckhouse wall) does not move the median, and a longer
 * one that returns to the same deck within `minRun` metres is dropped. Each break is placed at the largest raw step
 * near the median's. */
export function findBreaks(stations: { z: number; deck: number }[], minStep = 0.5, minRun = 12): number[] {
  const run = stations.map((_, i) => median(stations.slice(Math.max(0, i - 6), i + 7).map((s) => s.deck)));
  const found: { z: number; before: number; after: number }[] = [];
  for (let i = 1; i < stations.length; i++) {
    if (Math.abs(run[i] - run[i - 1]) <= minStep) continue;
    let at = i;
    for (let j = Math.max(1, i - 6); j < Math.min(stations.length, i + 7); j++)
      if (Math.abs(stations[j].deck - stations[j - 1].deck) > Math.abs(stations[at].deck - stations[at - 1].deck)) at = j;
    const z = (stations[at - 1].z + stations[at].z) / 2;
    const last = found[found.length - 1];
    if (last && z - last.z <= 2) last.after = run[i];
    else found.push({ z, before: run[i - 1], after: run[i] });
  }
  // A deck that steps and comes back within `minRun` metres is a misread stretch (a deckhouse flush with the side,
  // a bulwark), not a break: drop both steps.
  const out: typeof found = [];
  for (const b of found) {
    const last = out[out.length - 1];
    if (last && b.z - last.z < minRun && Math.abs(b.after - last.before) <= minStep) out.pop();
    else out.push(b);
  }
  return out.map((b) => b.z);
}

/** Stations close together near the ends, where the lines change fastest, plus a pair either side of each break. */
export function controlStations(bow: number, stern: number, breaks: number[] = []): number[] {
  const out: number[] = [];
  for (let z = bow + 0.25; z < stern - 0.2;) {
    out.push(Math.round(z * 1000) / 1000);
    const edge = Math.min(z - bow, stern - z);
    z += edge < 6 ? 0.5 : edge < 22 ? 1 : 2;
  }
  for (const b of breaks) out.push(Math.round((b - 0.15) * 1000) / 1000, Math.round((b + 0.15) * 1000) / 1000);
  return [...new Set(out)].sort((a, b) => a - b);
}

export interface Smoothed {
  zs: number[];
  deck: number[];
  keel: number[];
  segment: number[];
  breaks: number[];
}
/** Running medians of the dense deck (within each deck-break segment) and keel, the keel only rising toward the ends. */
export function smoothDense(dense: MeasuredStation[], breaks: number[], bow: number, stern: number): Smoothed {
  const zs = dense.map((s) => s.z);
  const segment = zs.map((z) => breaks.filter((b) => b < z).length);
  const window = (i: number, r: number, same: boolean) => {
    const idx: number[] = [];
    for (let j = i - r; j <= i + r; j++) if (j >= 0 && j < dense.length && (!same || segment[j] === segment[i])) idx.push(j);
    return idx;
  };
  const deck = dense.map((_, i) => median(window(i, 4, true).map((j) => dense[j].deck)));
  const keel = dense.map((_, i) => median(window(i, 3, false).map((j) => dense[j].keel)));
  const length = stern - bow;
  const bowZone = bow + 0.085 * length, sternZone = stern - 0.13 * length;
  const raw = [...keel];
  for (let i = 0; i < zs.length; i++) {
    if (zs[i] < bowZone) for (let j = i; j < zs.length && zs[j] <= bowZone; j++) keel[i] = Math.max(keel[i], raw[j]);
    if (zs[i] > sternZone) for (let j = i; j >= 0 && zs[j] >= sternZone; j--) keel[i] = Math.max(keel[i], raw[j]);
  }
  return { zs, deck, keel, segment, breaks };
}

export interface LinesRow { z: number; keel: number; deck: number; widths: number[]; heights: number[] }
/** The control row at reference `z`: smoothed keel and deck from the nearest dense station on the same side of any break. */
export function rowAt(station: MeasuredStation, smooth: Smoothed, rule: LevelRule): LinesRow {
  const segment = smooth.breaks.filter((b) => b < station.z).length;
  let best = -1;
  for (let i = 0; i < smooth.zs.length; i++)
    if (smooth.segment[i] === segment && (best < 0 || Math.abs(smooth.zs[i] - station.z) < Math.abs(smooth.zs[best] - station.z))) best = i;
  if (best < 0) best = 0;
  const deck = smooth.deck[best];
  const keel = Math.min(smooth.keel[best], deck - 0.3);
  const profile = [...station.points].sort((a, b) => a[0] - b[0]);
  const heights = levelHeights(keel, deck, rule);
  const widths = heights.map((y, j) => (j === 0 ? 0 : Math.max(0, widthAt(profile, y))));
  return { z: station.z, keel, deck, widths, heights };
}

export interface LinesOptions extends StationOptions {
  rule?: LevelRule;
  /** Deck breaks in reference z; found from the dense deck when absent. */
  breaks?: number[];
  /** Hull ends in reference z. When absent, the hull parts' extent, trimmed to the longest run of measurable
   * stations: a staff, walk or rudder standing clear of the hull does not lengthen it. */
  span?: Pair;
  /** Added to reference z to reach the ship frame; centres the hull on its length when absent. */
  shift?: number;
  /** Dense station spacing for the deck and keel medians. */
  denseStep?: number;
  /** Within this fraction of the length from the bow, the keel width is `bowKeelWidth` (default 0.033 and 0.06 m). */
  bowZone?: number;
  bowKeelWidth?: number;
}
export interface MeasuredLines {
  bow: number;
  stern: number;
  /** Added to reference z to reach the ship frame: centres the hull on its overall length. */
  zShift: number;
  breaks: number[];
  rows: LinesRow[];
  smooth: Smoothed;
  station: (z: number) => MeasuredStation | undefined;
}
export function measureLines(slicer: HullSlicer, options: LinesOptions = {}): MeasuredLines {
  const rule = options.rule ?? DEFAULT_RULE;
  let [bow, stern] = options.span ?? [slicer.zMin, slicer.zMax];
  // The forefoot narrows to a stem bar: near the bow the keel is followed much closer to the centreline.
  const bowZone = bow + (options.bowZone ?? 0.033) * (stern - bow);
  const station = (z: number) => measureStation(slicer.cut(z), z, z < bowZone ? { ...options, keelWidth: options.bowKeelWidth ?? 0.06 } : options);
  const step = options.denseStep ?? 0.5;
  let dense: MeasuredStation[] = [];
  for (let z = Math.ceil((bow + 0.05) * 10) / 10; z < stern; z += step) {
    const s = station(z);
    if (s) dense.push(s);
  }
  if (!options.span && dense.length) {
    const run = longestRun(dense.map((s) => s.z), 1.5);
    dense = dense.slice(run[0], run[1] + 1);
    if (dense[0].z > bow + 1.5) bow = dense[0].z - step / 2;
    if (dense[dense.length - 1].z < stern - 1.5) stern = dense[dense.length - 1].z + step / 2;
  }
  if (dense.length < 10) throw new Error(`Only ${dense.length} hull stations measured between z ${bow.toFixed(2)} and ${stern.toFixed(2)}; is the hull group present in the reference?`);
  let breaks = options.breaks;
  if (!breaks) {
    // Bisect each step between its two dense stations to about 2 cm.
    breaks = findBreaks(dense).map((b) => {
      let lo = b - step / 2, hi = b + step / 2;
      const deckLo = station(lo)?.deck ?? 0;
      for (let k = 0; k < 5; k++) {
        const mid = (lo + hi) / 2;
        const d = station(mid)?.deck;
        if (d !== undefined && Math.abs(d - deckLo) < 0.25) lo = mid; else hi = mid;
      }
      return Math.round(((lo + hi) / 2) * 1000) / 1000;
    });
  }
  const smooth = smoothDense(dense, breaks, bow, stern);
  const rows: LinesRow[] = [];
  for (const z of controlStations(bow, stern, breaks)) {
    const s = station(z);
    if (s) rows.push(rowAt(s, smooth, rule));
  }
  return { bow, stern, zShift: options.shift ?? -(bow + stern) / 2, breaks, rows, smooth, station };
}

/** First and last index of the longest run of values no more than `gap` apart. */
export function longestRun(values: number[], gap: number): Pair {
  let best: Pair = [0, 0], start = 0;
  for (let i = 1; i <= values.length; i++)
    if (i === values.length || values[i] - values[i - 1] > gap) {
      if (i - 1 - start > best[1] - best[0]) best = [start, i - 1];
      start = i;
    }
  return best;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const r4 = (v: number) => Math.round(v * 10000) / 10000;
export type LinesFormat = 'offsets' | 'sections';
/** The authoring file: `offsets` rows or `sections` by station, in the ship frame. */
export function linesFile(lines: MeasuredLines, format: LinesFormat, rule: LevelRule, reference: string, base: Record<string, unknown> = {}) {
  const length = r3(lines.stern - lines.bow);
  const generated = {
    reference,
    zShift: r4(lines.zShift),
    breaks: lines.breaks.map((b) => r3(b + lines.zShift)),
  };
  if (format === 'offsets') {
    return {
      version: 1,
      note:
        `Control-station offsets measured with bun run ship:lines from the GameModels3D ${reference} viewing reference. ` +
        `Runtime frame (metres, +X starboard, +Y up, -Z bow, waterline Y=0), reference z + ${r4(lines.zShift)}. ` +
        'Each row is [z, keel height, deck height at side, starboard half-breadths] at the LOW fractions from the keel to H0 ' +
        'and the HIGH fractions from H0 to the deck; where the keel rises above H0 - endMargin, H0 becomes ' +
        'keel + (deck - keel) * endFraction. Measurement only: no reference mesh is stored.',
      ...base,
      ...generated,
      length, LOW: rule.LOW, HIGH: rule.HIGH, H0: rule.H0, endMargin: rule.endMargin, endFraction: rule.endFraction,
      rows: lines.rows.map((row) => [r3(row.z + lines.zShift), r3(row.keel), r3(row.deck), row.widths.map(r3)]),
    };
  }
  // Station 0 is the stern end; with the default centring shift that is length / 2 - z.
  const half = lines.stern + lines.zShift;
  return {
    note:
      `Measured starboard hull sections of the GameModels3D ${reference} viewing reference, measured with bun run ship:lines. ` +
      `Runtime z = reference z + ${r4(lines.zShift)}; station = ${r4(half)} - z, from the transom (0) to the stem (length). ` +
      'Points [half-breadth, height] run from the keel on the centreline to the deck edge. Measurement only: no reference mesh is stored.',
    ...base,
    ...generated,
    length,
    pointsPerSection: rule.LOW.length + rule.HIGH.length,
    sections: lines.rows
      .map((row) => ({ station: r4(half - (row.z + lines.zShift)), points: row.heights.map((y, j): Pair => [r4(row.widths[j]), r4(y)]) }))
      .sort((a, b) => a.station - b.station),
  };
}

/** An existing lines file as (ship z, keel, deck, [(height, half-breadth)]) sections, whichever format it uses. */
export function readSections(file: any, rule: LevelRule): { z: number; keel: number; deck: number; points: Pair[] }[] {
  if (Array.isArray(file.sections)) {
    const half = file.length / 2;
    return file.sections.map((s: { station: number; points: Pair[] }) => ({
      z: half - s.station, keel: s.points[0][1], deck: s.points[s.points.length - 1][1], points: s.points.map(([w, y]): Pair => [y, w]),
    }));
  }
  if (Array.isArray(file.rows) && file.rows.every((r: unknown[]) => r.length === 4 && Array.isArray(r[3]))) {
    return file.rows.map(([z, keel, deck, widths]: [number, number, number, number[]]) => {
      const heights = levelHeights(keel, deck, rule);
      return { z, keel, deck, points: widths.map((w, j): Pair => [heights[j], w]) };
    });
  }
  throw new Error('Unrecognised lines file: expected offsets rows [z, keel, deck, [half-breadths]] or sections [{station, points}].');
}

export interface Comparison {
  stations: number;
  keel: Stats;
  deck: Stats;
  halfBreadth: Stats;
  worst: { z: number; keel: number; deck: number; halfBreadth: number }[];
}
interface Stats { median: number; p95: number; max: number }
const stats = (values: number[]): Stats => {
  const s = [...values].sort((a, b) => a - b);
  const at = (q: number) => r3(s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0);
  return { median: at(0.5), p95: at(0.95), max: r3(s[s.length - 1] ?? 0) };
};
/** Differences between an existing file and fresh measurements at its own stations and heights. Half-breadths are
 * compared at every existing point between the higher of the two keels and the lower of the two decks, so a keel
 * or deck disagreement shows in its own column rather than as a breadth error. */
export function compareSections(existing: ReturnType<typeof readSections>, measure: (z: number) => { keel: number; deck: number; points: Pair[] } | undefined): Comparison {
  const rows: Comparison['worst'] = [];
  for (const s of existing) {
    const m = measure(s.z);
    if (!m) continue;
    const profile = [...m.points].sort((a, b) => a[0] - b[0]);
    const top = Math.min(s.deck, m.deck);
    let worst = 0;
    const bottom = Math.max(s.keel, m.keel);
    for (const [y, w] of s.points) if (y <= top + 1e-6 && y > bottom + 1e-6) worst = Math.max(worst, Math.abs(widthAt(profile, y) - w));
    rows.push({ z: r3(s.z), keel: r3(m.keel - s.keel), deck: r3(m.deck - s.deck), halfBreadth: r3(worst) });
  }
  return {
    stations: rows.length,
    keel: stats(rows.map((r) => Math.abs(r.keel))),
    deck: stats(rows.map((r) => Math.abs(r.deck))),
    halfBreadth: stats(rows.map((r) => r.halfBreadth)),
    worst: [...rows].sort((a, b) => b.halfBreadth + Math.abs(b.deck) + Math.abs(b.keel) - (a.halfBreadth + Math.abs(a.deck) + Math.abs(a.keel))).slice(0, 6),
  };
}

const HELP = `bun run ship:lines <ship-id> [options]
  --ref <name|id>          cached ship:reference (default: the ship's suggested GameModels3D vehicle; fetched if missing)
  --format offsets|sections  offsets rows (Hood, Hipper, Baltimore, Fubuki) or sections by station (Fletcher,
                           ship:new --legacy author-blueprint.py --loft); default: the existing file's, else sections
  --parts a,b              reference groups or part keys that make the hull (default hull)
  --span bow,stern         hull ends in reference z (default: the hull parts' extent, trimmed to the longest
                           run of measurable stations)
  --shift m                ship z = reference z + m (default: centres the hull on its length)
  --breaks z,…|none        deck breaks in reference z (default: found where the deck steps by more than 0.5 m
                           and does not come back within 12 m); none for a flush-decked hull
  --h0 m --low f,… --high f,… --end-margin m --end-fraction f   level rule (default: the existing file's, else
                           H0 1.5, twenty LOW and four HIGH levels, margin 1, fraction 0.75)
  --widest-below m         start each station from the widest crossing below this height, or the widest above
                           -0.5 m, whichever outline encloses more (default 3)
  --deck-below m           no deck above this height, where deckhouse sides run flush with the hull's
  --keel-width m           the keel is where the shell comes within this of the centreline (default 0.3)
  --compare <file>         compare against this lines file (default: the ship's authoring/lines.json)
  --out <file>             where to write (default: authoring/lines.json when absent, else
                           .build/ships/<id>/lines/lines.json)
  --replace                overwrite the ship's existing authoring/lines.json`;

export interface LinesCliOptions {
  id: string;
  reference?: string;
  format?: LinesFormat;
  parts: string[];
  span?: Pair;
  shift?: number;
  breaks?: number[];
  rule: Partial<LevelRule>;
  widestBelow?: number;
  keelWidth?: number;
  deckBelow?: number;
  compare?: string;
  out?: string;
  replace: boolean;
}
export function parseLinesArgs(argv: string[]): LinesCliOptions {
  const known = new Set([
    '--ref', '--format', '--parts', '--span', '--shift', '--breaks', '--deck-below', '--h0', '--low', '--high',
    '--end-margin', '--end-fraction', '--widest-below', '--keel-width', '--compare', '--out', '--replace', '--help',
  ]);
  const switches = new Set(['--replace', '--help']);
  const values = new Map<string, string>();
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { positionals.push(a); continue; }
    if (!known.has(a)) throw new Error(`Unknown flag ${a}.\n${HELP}`);
    if (switches.has(a)) { values.set(a, ''); continue; }
    const next = argv[++i];
    if (next === undefined || next.startsWith('--')) throw new Error(`${a} needs a value.`);
    values.set(a, next);
  }
  if (positionals.length !== 1) throw new Error(HELP);
  const list = (flag: string, count?: number) => {
    const text = values.get(flag);
    if (text === undefined) return undefined;
    const n = text.split(',').map(Number);
    if (n.some((v) => !Number.isFinite(v)) || (count !== undefined && n.length !== count)) throw new Error(`${flag} takes ${count ?? 'comma-separated'} numbers; got "${text}".`);
    return n;
  };
  const one = (flag: string) => list(flag, 1)?.[0];
  const format = values.get('--format');
  if (format !== undefined && format !== 'offsets' && format !== 'sections') throw new Error('--format takes offsets or sections.');
  const rule: Partial<LevelRule> = {};
  if (one('--h0') !== undefined) rule.H0 = one('--h0');
  if (list('--low')) rule.LOW = list('--low');
  if (list('--high')) rule.HIGH = list('--high');
  if (one('--end-margin') !== undefined) rule.endMargin = one('--end-margin');
  if (one('--end-fraction') !== undefined) rule.endFraction = one('--end-fraction');
  return {
    id: positionals[0], reference: values.get('--ref'), format: format as LinesFormat | undefined,
    parts: values.get('--parts')?.split(',').filter(Boolean) ?? ['hull'],
    span: list('--span', 2) as Pair | undefined, shift: one('--shift'), breaks: values.get('--breaks') === 'none' ? [] : list('--breaks'), rule,
    widestBelow: one('--widest-below'), keelWidth: one('--keel-width'), deckBelow: one('--deck-below'),
    compare: values.get('--compare'), out: values.get('--out'), replace: values.has('--replace'),
  };
}

export async function runLines(options: LinesCliOptions, root = ROOT) {
  const shipDir = join(root, 'assets/ships', options.id);
  if (!existsSync(shipDir)) throw new Error(`No ship "${options.id}" under assets/ships.`);
  const reference = options.reference ?? suggestedVehicles[options.id];
  if (!reference) throw new Error(`No suggested reference for "${options.id}"; pass --ref <name|GameModels3D id>.`);
  if (!existsSync(join(root, '.build/references', reference, 'reference.json'))) {
    console.error(`Caching reference ${reference} with ship:reference (network)…`);
    const child = Bun.spawnSync(['bun', 'scripts/construction/cli.ts', 'reference', reference], { cwd: root, stdout: 'ignore', stderr: 'inherit' });
    if (child.exitCode !== 0) throw new Error(`ship:reference ${reference} failed.`);
  }
  const authoring = join(shipDir, 'authoring/lines.json');
  const comparePath = options.compare ? resolve(options.compare) : existsSync(authoring) ? authoring : undefined;
  const existing = comparePath ? JSON.parse(await readFile(comparePath, 'utf8')) : undefined;
  const rule: LevelRule = {
    ...DEFAULT_RULE,
    ...(existing && Array.isArray(existing.LOW) ? { LOW: existing.LOW } : {}),
    ...(existing && Array.isArray(existing.HIGH) ? { HIGH: existing.HIGH } : {}),
    ...(existing && typeof existing.H0 === 'number' ? { H0: existing.H0 } : {}),
    ...(existing && typeof existing.endMargin === 'number' ? { endMargin: existing.endMargin } : {}),
    ...(existing && typeof existing.endFraction === 'number' ? { endFraction: existing.endFraction } : {}),
    ...options.rule,
  };
  const format: LinesFormat = options.format ?? (existing && Array.isArray(existing.rows) ? 'offsets' : 'sections');
  const mesh = await readReference(root, reference);
  const slicer = HullSlicer.fromReference(mesh, options.parts);
  const lines = measureLines(slicer, { rule, breaks: options.breaks, span: options.span, shift: options.shift, widestBelow: options.widestBelow, keelWidth: options.keelWidth, deckBelow: options.deckBelow });
  const keep = existing && comparePath === authoring ? Object.fromEntries(Object.entries(existing).filter(([k]) => k === 'note')) : {};
  const file = linesFile(lines, format, rule, reference, keep);
  const out = options.out ? resolve(options.out) : !existsSync(authoring) || options.replace ? authoring : join(root, '.build/ships', options.id, 'lines/lines.json');
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(file) + '\n');
  let comparison: (Comparison & { file: string; lengthDelta?: number }) | undefined;
  if (existing) {
    // Measure at the existing file's own stations, in its frame, with the fresh keel and deck medians.
    const measure = (zShip: number) => {
      const s = lines.station(zShip - lines.zShift);
      if (!s) return undefined;
      const row = rowAt(s, lines.smooth, rule);
      return { keel: row.keel, deck: row.deck, points: [...s.points].sort((a, b) => a[0] - b[0]) };
    };
    comparison = { file: relative(root, comparePath!), ...(typeof existing.length === 'number' ? { lengthDelta: r3(lines.stern - lines.bow - existing.length) } : {}), ...compareSections(readSections(existing, rule), measure) };
  }
  return {
    ship: options.id, reference, format, out: relative(root, out), length: r3(lines.stern - lines.bow), zShift: r4(lines.zShift),
    breaks: lines.breaks.map((b) => r3(b + lines.zShift)), stations: lines.rows.length,
    ...(comparison ? { comparison } : {}),
  };
}

if (import.meta.main) {
  try {
    const argv = process.argv.slice(2);
    if (!argv.length || argv.includes('--help')) { console.log(HELP); process.exit(argv.length ? 0 : 1); }
    console.log(JSON.stringify(await runLines(parseLinesArgs(argv)), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
