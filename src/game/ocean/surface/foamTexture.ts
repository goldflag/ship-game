import { DataTexture, LinearFilter, LinearMipmapLinearFilter, RepeatWrapping, RGBAFormat } from 'three/webgpu';

/** Texels per edge. */
export const FOAM_TEXELS = 256;
/** Most taps the sampler averages along a grazing pixel's length. */
export const FOAM_ANISOTROPY = 8;

/** Integer hash to [0, 1): seeds and lattice indices only, no float inputs. */
function hash(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(seed, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Distances from (u, v) in [0, 1)² to the nearest and second-nearest feature points of a periodic `cells`² jittered
 * grid, in cell units. F2 − F1 is zero on the borders between cells. */
function worley(u: number, v: number, cells: number, seed: number): [number, number] {
  const x = u * cells, y = v * cells, ix = Math.floor(x), iy = Math.floor(y);
  let first = 9, second = 9;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const cx = ix + dx, cy = iy + dy, wx = ((cx % cells) + cells) % cells, wy = ((cy % cells) + cells) % cells;
    const d = Math.hypot(cx + hash(wx, wy, seed) - x, cy + hash(wx, wy, seed + 1) - y);
    if (d < first) { second = first; first = d; } else if (d < second) second = d;
  }
  return [first, second];
}

/** Smooth periodic value noise in [0, 1) on a `cellsU` × `cellsV` lattice. */
function value(u: number, v: number, cellsU: number, cellsV: number, seed: number): number {
  const x = u * cellsU, y = v * cellsV, ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const at = (i: number, j: number) => hash(((i % cellsU) + cellsU) % cellsU, ((j % cellsV) + cellsV) % cellsV, seed);
  const top = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * sx, bottom = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * sx;
  return top + (bottom - top) * sy;
}

/** Replace every value by its rank, so the channel is uniform on [0, 1]: a threshold at 1 − c then keeps
 * exactly a share c of the texture, which is what the surface's foam coverages mean. */
function equalize(field: Float32Array): Float32Array {
  const order = Array.from(field.keys()).sort((a, b) => field[a] - field[b]);
  const ranks = new Float32Array(field.length);
  order.forEach((index, rank) => { ranks[index] = (rank + .5) / field.length; });
  return ranks;
}

/** Lace scales (cells per tile), their weights, and the width of their filaments in cell units: decaying foam is a
 * network of white filaments around holes of every size, where bubbles have burst. */
const LACE_CELLS = [5, 12, 29], LACE_WEIGHTS = [.45, .35, .2], LACE_WIDTH = .09;
/** Share of a lace level from the holes' own rims (F1) rather than the filaments between them: filled foam between
 * thin threads. */
const LACE_FILL = .35;

/** The lace's coordinates meander by up to this share of its coarsest cell, so its filaments wander and vary in width
 * instead of drawing a cellular diagram. */
const LACE_WARP = .5;

/** Lace at (u, v): bright on the borders between cells at three scales, on warped coordinates. */
function lace(u: number, v: number): number {
  const warp = LACE_WARP / LACE_CELLS[0];
  const wu = u + warp * (value(u, v, 7, 7, 71) - .5), wv = v + warp * (value(u, v, 7, 7, 73) - .5);
  let sum = 0;
  LACE_CELLS.forEach((cells, i) => {
    const [first, second] = worley(wu, wv, cells, 3 + 2 * i);
    sum += LACE_WEIGHTS[i] * ((1 - LACE_FILL) * Math.exp(-(second - first) / LACE_WIDTH) + LACE_FILL * Math.min(1, first / .7));
  });
  return sum;
}

/** Convergence bands: where the wind's circulation gathers old foam into lines along itself. This many rows per tile
 * across the texture (v) at two spacings, each holding one band jittered within its row; their half-widths in
 * texels (soft Gaussian profiles, so the lines of foam laid in them fray instead of ending at a hard edge); how far
 * (in rows) they meander over the tile, so neighbours close up and part, and wiggle over a few metres of their length;
 * and how many times per tile each breaks along its length (u) and swells and narrows. */
const STREAK_ROWS = [5, 13], STREAK_WIDTH_MIN = 1.5, STREAK_WIDTH_MAX = 4, STREAK_MEANDER = 1.3, STREAK_BREAKS = 41;
const STREAK_WIGGLE = .3, STREAK_WIGGLES = 70, STREAK_SWELLS = 53;
/** Value of a band's own noise along it below which the band breaks, and the width of the fade into each gap. */
const STREAK_GAP = .42, STREAK_GAP_EDGE = .25;

/** One set of `rows` bands along u at (u, v): each row's band has its own place, width, strength and breaks. */
function streakLines(u: number, v: number, rows: number, seed: number): number {
  const y = v * rows + STREAK_MEANDER * (value(u, v, 3, 5, seed + 7) - .5) + STREAK_WIGGLE * (value(u, v, STREAK_WIGGLES, rows, seed + 9) - .5);
  const row = Math.floor(y);
  let line = 0;
  for (let offset = -1; offset <= 1; offset++) {
    const cell = row + offset, id = ((cell % rows) + rows) % rows;
    const centre = cell + .2 + .6 * hash(id, 0, seed);
    const swell = .4 + 1.2 * value(u + hash(id, 4, seed), 0, STREAK_SWELLS, 1, seed * 37 + id);
    const width = (STREAK_WIDTH_MIN + (STREAK_WIDTH_MAX - STREAK_WIDTH_MIN) * hash(id, 1, seed)) * swell * rows / FOAM_TEXELS;
    const strength = .25 + .75 * hash(id, 3, seed), along = value(u + hash(id, 2, seed), 0, STREAK_BREAKS, 1, seed * 131 + id);
    const profile = Math.exp(-(((y - centre) / width) ** 2));
    line = Math.max(line, profile * strength * smooth((along - STREAK_GAP) / STREAK_GAP_EDGE));
  }
  return line;
}

/** 3t² − 2t³ on t clamped to [0, 1]. */
function smooth(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

/** Convergence bands at (u, v): soft lines along u that meander and break, at two spacings; where two cross, the
 * stronger. */
function streaks(u: number, v: number): number {
  return STREAK_ROWS.reduce((most, rows, i) => Math.max(most, streakLines(u, v, rows, 23 + 10 * i)), 0);
}

/** Channel holding the band mask, which keeps its values (the others are equalised). */
const STREAK_CHANNEL = 2;
/** Levels this many texels on an edge or more are equalised; smaller ones only average. Equalised, a 4 × 4 level would
 * spread its sixteen texels over the whole range and draw a full-contrast grid of the tile across the distant sea;
 * those levels lie beyond `foam.ts`'s pattern blur, where the surface takes the coverage itself. */
const EQUALIZED_TEXELS = 16;

/** Churned white water: clumps of foam heaped into rounded billows at three scales (domes over each cell of a jittered
 * grid, 1 − F1), so the surface shades each billow on its sunward side and darkens in the creases between them. */
const CHURN_CELLS = [23, 53, 127], CHURN_WEIGHTS = [.5, .32, .18];

/** Churn at (u, v): heaped billows. */
function churn(u: number, v: number): number {
  return CHURN_CELLS.reduce((sum, cells, i) => sum + CHURN_WEIGHTS[i] * (1 - Math.min(1, worley(u, v, cells, 51 + 2 * i)[0])), 0);
}

/** The periodic `size`² field averaged over 2 × 2 blocks. */
function halve(field: Float32Array, size: number): Float32Array {
  const half = size / 2, out = new Float32Array(half * half);
  for (let y = 0; y < half; y++) for (let x = 0; x < half; x++) {
    const i = 2 * y * size + 2 * x;
    out[y * half + x] = (field[i] + field[i + 1] + field[i + size] + field[i + size + 1]) / 4;
  }
  return out;
}

/** The four channels of one mip level as RGBA bytes: each equalised on levels of EQUALIZED_TEXELS or more, but the band
 * mask as it is. */
function levelPixels(fields: Float32Array[], size: number): Uint8Array {
  const pixels = new Uint8Array(fields[0].length * 4);
  fields.map((field, channel) => channel === STREAK_CHANNEL || size < EQUALIZED_TEXELS ? field : equalize(field))
    .forEach((field, channel) => field.forEach((level, i) => { pixels[i * 4 + channel] = Math.round(Math.min(1, Math.max(0, level)) * 255); }));
  return pixels;
}

/** The ocean's one foam texture, generated at startup and tiling in both axes. Red: lace, the structure of thinning
 * white water. Green: broad patches (fbm). Alpha: churn, the heaped billows of fresh and churned white water. These three are
 * equalised, and each mip level down to EQUALIZED_TEXELS averages the raw fields and is equalised again: an averaged
 * pattern narrows toward its mean, so thresholding the GPU's own mips for a coverage would thin foam with distance,
 * where these keep the share. Blue: the band mask, soft lines along the texture (u) that meander and break, where the
 * wind gathers old foam into windrows (the surface lays u along the wind); it is not thresholded but scaled, so its
 * levels are plain averages whose mean, `userData.streakMean`, holds at every distance. */
export function foamTexture(): DataTexture {
  const n = FOAM_TEXELS;
  let fields: Float32Array[] = [new Float32Array(n * n), new Float32Array(n * n), new Float32Array(n * n), new Float32Array(n * n)];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const u = (x + .5) / n, v = (y + .5) / n, i = y * n + x;
    let broad = 0, weight = .5;
    for (let octave = 0; octave < 4; octave++, weight *= .5) broad += weight * value(u, v, 4 << octave, 4 << octave, 11 + octave);
    fields[0][i] = lace(u, v); fields[1][i] = broad; fields[2][i] = streaks(u, v); fields[3][i] = churn(u, v);
  }
  const streakMean = fields[STREAK_CHANNEL].reduce((sum, level) => sum + level, 0) / (n * n);
  const mipmaps = [];
  for (let size = n; ; size /= 2) {
    mipmaps.push({ data: levelPixels(fields, size), width: size, height: size });
    if (size === 1) break;
    // Below the equalised levels the fields average the last equalised one, so they settle to its mean (½).
    if (size === EQUALIZED_TEXELS) fields = fields.map((field, channel) => channel === STREAK_CHANNEL ? field : equalize(field));
    fields = fields.map(field => halve(field, size));
  }
  const map = new DataTexture(mipmaps[0].data, n, n, RGBAFormat);
  map.name = 'Ocean foam';
  map.wrapS = map.wrapT = RepeatWrapping;
  map.minFilter = LinearMipmapLinearFilter; map.magFilter = LinearFilter;
  // Anisotropic, as `foam.ts`'s blur assumes: a grazing pixel samples the level its width needs and averages taps along
  // its length. Isotropic, it took the level its length needs, whose equalised texels then thresholded into blocks.
  map.mipmaps = mipmaps; map.generateMipmaps = false;
  map.anisotropy = FOAM_ANISOTROPY;
  map.userData.streakMean = streakMean;
  map.needsUpdate = true;
  return map;
}
