/** New Orleans hull lines: `bun assets/ships/new-orleans/authoring/measure-lines.ts [--out file]`.
 *
 * Runs the shared `ship:lines` measurement (scripts/ships/lines.ts) over the cached GameModels3D `pasc107-b`
 * reference (`bun run ship:reference pasc107 --hull B_Hull --name pasc107-b`) and writes `authoring/lines.json`
 * in the `sections` format `author-blueprint.py --loft` reads. The shared station walk and control stations are
 * used as they are; four things differ for this hull:
 *
 * - Deck edge. The reference draws its deck plating as triangles that span the centreline or stop short of the
 *   shell round anchor pipes, and the shared finder then fell back to the top of the shell: the bulwarks at the
 *   forecastle's after end, in the waist and round the bow's gun tubs. Here the deck is the lowest horizontal
 *   plating whose runs cover at least 60 % of the shell's breadth at that height, measured every 0.25 m and
 *   smoothed by a running median of five within each deck-break segment.
 * - The forecastle break is the measured step of the side plating at reference z = 5.02.
 * - Walks start from the widest crossing below 1.5 m: the propeller guards stand out past the shell at 1.6 m and
 *   started the walk off the hull at the outboard screws.
 * - Keels at the ends. The shared running median lags the stem's forefoot and the transom by up to a metre; within
 *   6 m of either end each station keeps its own keel.
 * - Eleven levels from H0 to the deck edge (the shared default has four), for the flare of the forecastle.
 *
 * Measurement only: numbers from the ignored `.build/references/` cache; no reference geometry is written. */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { readReference, selectTriangles } from '../../../../scripts/construction/reference';
import { controlStations, DEFAULT_RULE, HullSlicer, levelHeights, linesFile, measureLines, widthAt, type LevelRule, type LinesRow } from '../../../../scripts/ships/lines';

const ROOT = resolve(import.meta.dir, '../../../..');
type Pair = [number, number];

const args = process.argv.slice(2);
const outArg = args.indexOf('--out');
const out = outArg >= 0 ? resolve(args[outArg + 1]) : join(ROOT, 'assets/ships/new-orleans/authoring/lines.json');
const reference = 'pasc107-b';
const BREAK = 5.02;
const mesh = await readReference(ROOT, reference);
const slicer = new HullSlicer(mesh.positions, mesh.index, selectTriangles(mesh.meta, ['hull']));
const rule: LevelRule = { ...DEFAULT_RULE, HIGH: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.88, 0.95, 1] };
const lines = measureLines(slicer, { rule, widestBelow: 1.5, breaks: [BREAK] });

/** The lowest horizontal plating covering 60 % of the shell's breadth at its height. */
function deckAt(z: number): number | undefined {
  const segments = slicer.cut(z);
  const levels = new Map<number, Pair[]>();
  for (const [a, b] of segments) {
    if (Math.abs(a[1] - b[1]) > 0.004) continue;
    const y = Math.round(((a[1] + b[1]) / 2) * 100) / 100;
    if (y < 2.5) continue;
    const list = levels.get(y) ?? [];
    list.push([Math.min(a[0], b[0]), Math.max(a[0], b[0])]);
    levels.set(y, list);
  }
  const shellWidth = (y: number) => {
    let lo = Infinity, hi = -Infinity;
    for (const [a, b] of segments) {
      const y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
      if (y1 - y0 < 1e-4 || y < y0 || y > y1) continue;
      const x = a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]);
      lo = Math.min(lo, x); hi = Math.max(hi, x);
    }
    return hi > lo ? hi - lo : 0;
  };
  for (const y of [...levels.keys()].sort((a, b) => a - b)) {
    const spans = levels.get(y)!.sort((a, b) => a[0] - b[0]);
    let covered = 0, end = -Infinity;
    for (const [a, b] of spans) {
      const start = Math.max(a, end);
      if (b > start) covered += b - start;
      end = Math.max(end, b);
    }
    const width = shellWidth(y - 0.05);
    if (width > 0.5 && covered >= 0.6 * width) return y;
  }
  return undefined;
}

// Dense deck table, then a running median of five within each break segment.
const dense: { z: number; deck: number }[] = [];
for (let z = Math.ceil((lines.bow + 0.05) * 4) / 4; z < lines.stern; z += 0.25) {
  const d = deckAt(z);
  if (d !== undefined) dense.push({ z, deck: d });
}
const side = (z: number) => (z < BREAK ? 0 : 1);
const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const smoothDeck = dense.map((d, i) => {
  const win: number[] = [];
  for (let j = i - 2; j <= i + 2; j++) if (j >= 0 && j < dense.length && side(dense[j].z) === side(d.z)) win.push(dense[j].deck);
  return { z: d.z, deck: median(win) };
});
function deckLine(z: number): number {
  const same = smoothDeck.filter((d) => side(d.z) === side(z));
  let best = same[0];
  for (const d of same) if (Math.abs(d.z - z) < Math.abs(best.z - z)) best = d;
  const next = same.find((d) => d.z > best.z && d.z >= z) ?? best;
  const prev = [...same].reverse().find((d) => d.z <= z) ?? best;
  if (next === prev || next.z === prev.z) return best.deck;
  return prev.deck + ((z - prev.z) / (next.z - prev.z)) * (next.deck - prev.deck);
}

const rows: LinesRow[] = [];
const skipped: number[] = [];
for (const z of controlStations(lines.bow, lines.stern, [BREAK])) {
  const s = lines.station(z);
  if (!s) { skipped.push(z); continue; }
  const nearEnd = Math.min(z - lines.bow, lines.stern - z) < 6;
  let smoothKeel = lines.smooth.keel[0], nearest = Infinity;
  lines.smooth.zs.forEach((zz, i) => { if (Math.abs(zz - z) < nearest) { nearest = Math.abs(zz - z); smoothKeel = lines.smooth.keel[i]; } });
  const deck = deckLine(z);
  const keel = Math.min(nearEnd ? s.keel : smoothKeel, deck - 0.3);
  if (!nearEnd && Math.abs(s.keel - smoothKeel) > 0.8) { skipped.push(z); continue; }
  const profile = [...s.points].sort((a, b) => a[0] - b[0]);
  const heights = levelHeights(keel, deck, rule);
  const widths = heights.map((y, j) => (j === 0 ? 0 : Math.max(0, widthAt(profile, y))));
  rows.push({ z, keel, deck, widths, heights });
}
lines.rows = rows;
const file = linesFile(lines, 'sections', rule, reference);
await mkdir(dirname(out), { recursive: true });
await writeFile(out, JSON.stringify(file, null, 1) + '\n');
console.log(JSON.stringify({ out, length: file.length, zShift: file.zShift, breaks: file.breaks, stations: file.sections.length, skipped }, null, 1));
