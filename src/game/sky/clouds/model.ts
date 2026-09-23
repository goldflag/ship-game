/** The cloud layer's renderer-free model, shared by the shaders and the tests: the shell's geometry, the
 * weather and cirrus maps (built on the CPU once, a few milliseconds each), and the formulas that turn a
 * scene's coverage into cloud: local cover, cloud type and height profile. The formulas are written once
 * over `Arithmetic`, so the GPU compiles exactly what the tests check on numbers. */

/** The planet under the camera (m). The sea at y = 0 below the camera is its surface. */
export const PLANET_RADIUS = 6_360_000;
/** World metres one weather-map repeat spans. Wide enough that a sortie never sees it tile twice. */
export const WEATHER_TILE = 36_000;
/** Texels per edge of the weather map: 140 m each, finer than a fair-weather cumulus. */
export const WEATHER_SIZE = 256;
/** Height of the cirrus layer (m), and the world metres its pattern repeats over. */
export const CIRRUS_ALTITUDE = 9_000;
export const CIRRUS_TILE = 42_000;
export const CIRRUS_SIZE = 256;

/** Weather-map potentials are rank-equalised, so a coverage c leaves exactly the share c of the map above
 * 1 − c. The cover ramps in over this band around that threshold: below it clear, above it solid. */
export const COVER_BELOW = .04, COVER_ABOVE = .22;
/** From this coverage the cover swells past 1, by up to the second share at full coverage. */
const DECK_FILL = [.72, .45] as const;
/** Cloud types on a 0–1 axis: flat stratus, stratocumulus, cumulus, a thick nimbostratus deck, cumulonimbus. */
export const TYPE = { stratus: 0, stratocumulus: .3, cumulus: .52, nimbostratus: .72, cumulonimbus: 1 } as const;
/** How far the weather map's type noise moves a cloud off its sky's type: some cumulus tower, some stay shallow. */
const TYPE_SPREAD = .34;
/** Coverage at which cumulus flatten into stratocumulus, and at which the sky closes into a storm deck. */
const FLATTEN = [.55, .86] as const, DECK = [.87, .96] as const;
/** Storm-cell potential (rank) over which a deck cell becomes a cumulonimbus; the anvil lowers it near the top. */
const CELL = [.66, .84] as const, ANVIL_SPREAD = .3;
/** Share of the shell a stratus fills, and the height fraction over which every base rounds in. */
const STRATUS_TOP = .16, BASE_RISE = .07;

/** Arithmetic both on numbers and on shader nodes, so a formula is written once. */
export interface Arithmetic<T> {
  add(a: T | number, b: T | number): T;
  sub(a: T | number, b: T | number): T;
  mul(a: T | number, b: T | number): T;
  mix(a: T | number, b: T | number, t: T | number): T;
  smoothstep(edge0: T | number, edge1: T | number, x: T | number): T;
  saturate(x: T | number): T;
  min(a: T | number, b: T | number): T;
  max(a: T | number, b: T | number): T;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
export const numbers: Arithmetic<number> = {
  add: (a, b) => a + b,
  sub: (a, b) => a - b,
  mul: (a, b) => a * b,
  mix: (a, b, t) => a + (b - a) * t,
  smoothstep: (e0, e1, x) => { const t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); },
  saturate: clamp01,
  min: Math.min,
  max: Math.max,
};

/** The scene's coverage at a horizontal distance from the camera: distant clouds bank up toward the
 * horizon by `horizon` (the scene's `horizonCoverage`), fully from 50 km. */
export function liftedCoverage<T>(m: Arithmetic<T>, coverage: T | number, horizon: T | number, distance: T | number): T {
  return m.min(m.add(coverage, m.mul(horizon, m.smoothstep(6_000, 50_000, distance))), 1);
}

/** Share of a column that is cloud (0 clear … 1 solid, and beyond 1 in a closing sky, where it fills the
 * shape noise's hollows into a deck) where the weather map's rank-equalised potential is `potential`. */
export function localCover<T>(m: Arithmetic<T>, potential: T | number, coverage: T | number): T {
  const threshold = m.sub(1, coverage);
  const fill = m.add(1, m.mul(m.smoothstep(DECK_FILL[0], 1, coverage), DECK_FILL[1]));
  return m.mul(m.smoothstep(m.sub(threshold, COVER_BELOW), m.add(threshold, COVER_ABOVE), potential), fill);
}

/** Cloud type (see `TYPE`) at a height fraction of the shell: cumulus in fair weather, flattening into
 * stratocumulus as the sky fills, then a thick nimbostratus deck whose storm cells (`storm`, the map's
 * rank-equalised cell potential) tower into cumulonimbus. Near the top a cell spreads into its anvil. */
export function cloudType<T>(m: Arithmetic<T>, coverage: T | number, variation: T | number, storm: T | number, height: T | number): T {
  const flat = m.smoothstep(FLATTEN[0], FLATTEN[1], coverage), deck = m.smoothstep(DECK[0], DECK[1], coverage);
  const sky = m.mix(m.mix(TYPE.cumulus, TYPE.stratocumulus, flat), TYPE.nimbostratus, deck);
  const own = m.add(sky, m.mul(m.sub(variation, .5), TYPE_SPREAD));
  const spread = m.mul(m.smoothstep(.62, .92, height), ANVIL_SPREAD);
  const cell = m.mul(deck, m.smoothstep(m.sub(CELL[0], spread), m.sub(CELL[1], spread), storm));
  return m.saturate(m.mix(own, TYPE.cumulonimbus, cell));
}

/** Top of a cloud type as a fraction of the shell: a stratus fills its lowest sixth, a cumulonimbus all of it. */
export function cloudTop<T>(m: Arithmetic<T>, type: T | number): T {
  return m.mix(STRATUS_TOP, 1, m.mul(type, m.sub(2, type)));
}

/** Density envelope (0–1) of a cloud type at a height fraction of the shell: a flat base rounding in over the
 * lowest few percent, then thinning toward the type's top. The coverage erosion turns the thinning into shape:
 * where the envelope is low only the strongest noise survives, so a cumulus narrows upward from its broad base
 * into a dome, a stratocumulus stays a flat slab, and a cumulonimbus holds its width to a flat anvil top. */
export function heightProfile<T>(m: Arithmetic<T>, height: T | number, type: T | number): T {
  const top = cloudTop(m, type);
  // Where the thinning starts, as a share of the top: early for cumulus, late for slabs and cumulonimbus.
  const slab = m.sub(1, m.smoothstep(TYPE.stratocumulus, TYPE.cumulus, type));
  const fade = m.mix(m.mix(.12, .55, slab), .82, m.smoothstep(.8, 1, type));
  const bottom = m.smoothstep(0, BASE_RISE, height);
  const upper = m.sub(1, m.smoothstep(m.mul(top, fade), top, height));
  return m.mul(bottom, m.mul(upper, m.sub(2, upper)));
}

// ---------------------------------------------------------------------------------------------
// CPU maps. Seeded and tiling, so every client builds the same sky.
// ---------------------------------------------------------------------------------------------

/** Integer hash to [0, 1). */
function hash(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

/** A tiling lattice of `px` × `py` cells: unit gradients or jittered feature points, built once so the maps
 * evaluate tens of thousands of texels against a few hundred hashed points. */
interface Lattice { readonly px: number; readonly py: number; readonly table: Float32Array }
function lattice(kind: 'gradient' | 'point', px: number, py: number, seed: number): Lattice {
  const table = new Float32Array(px * py * 2);
  for (let j = 0; j < py; j++) for (let i = 0; i < px; i++) {
    const k = (j * px + i) * 2;
    if (kind === 'point') { table[k] = hash(i, j, seed); table[k + 1] = hash(i, j, seed + 101); }
    else { const angle = hash(i, j, seed) * Math.PI * 2; table[k] = Math.cos(angle); table[k + 1] = Math.sin(angle); }
  }
  return { px, py, table };
}

/** Tiling gradient noise, roughly −0.7 … 0.7, at (u, v) in [0, 1). */
function gradientAt({ px, py, table }: Lattice, u: number, v: number): number {
  const x = u * px, y = v * py, x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const i0 = ((x0 % px) + px) % px, j0 = ((y0 % py) + py) % py, i1 = (i0 + 1) % px, j1 = (j0 + 1) % py;
  const a = (j0 * px + i0) * 2, b = (j0 * px + i1) * 2, c = (j1 * px + i0) * 2, d = (j1 * px + i1) * 2;
  const ga = table[a] * fx + table[a + 1] * fy, gb = table[b] * (fx - 1) + table[b + 1] * fy;
  const gc = table[c] * fx + table[c + 1] * (fy - 1), gd = table[d] * (fx - 1) + table[d + 1] * (fy - 1);
  const sx = fade(fx), sy = fade(fy), top = ga + (gb - ga) * sx, bottom = gc + (gd - gc) * sx;
  return top + (bottom - top) * sy;
}

/** Tiling Worley F1 distance at (u, v) in [0, 1), in cell units: 0 at a feature point, about 0.7 at most. */
function worleyAt({ px: cells, table }: Lattice, u: number, v: number): number {
  const x = u * cells, y = v * cells, ix = Math.floor(x), iy = Math.floor(y);
  let nearest = 9;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = (((ix + i) % cells) + cells) % cells, cy = (((iy + j) % cells) + cells) % cells, k = (cy * cells + cx) * 2;
    const dx = ix + i + table[k] - x, dy = iy + j + table[k + 1] - y;
    nearest = Math.min(nearest, dx * dx + dy * dy);
  }
  return Math.sqrt(nearest);
}

/** Octaves of gradient noise, periods doubling from `px` × `py`, amplitudes halving from 1. */
function fbm(octaves: readonly Lattice[], u: number, v: number, warp = 0): number {
  let sum = 0;
  for (let o = 0, amplitude = 1; o < octaves.length; o++, amplitude *= .5) sum += gradientAt(octaves[o], u, v + warp) * amplitude;
  return sum;
}
const octaves = (count: number, px: number, py: number, seed: number) => Array.from({ length: count }, (_, o) => lattice('gradient', px << o, py << o, seed + o));

/** Replace every value by its rank (0–1), through a fine histogram: the result is uniformly distributed. */
export function equalise(values: Float32Array): Float32Array {
  let lo = Infinity, hi = -Infinity;
  for (const v of values) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  const bins = 8192, counts = new Float64Array(bins + 1), scale = (bins - 1) / Math.max(hi - lo, 1e-9);
  for (const v of values) counts[Math.round((v - lo) * scale) + 1]++;
  // Mid-rank of each bin: its values spread evenly over the ranks it covers.
  for (let i = 1; i <= bins; i++) counts[i] += counts[i - 1];
  const n = values.length, out = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const b = Math.round((values[k] - lo) * scale);
    out[k] = (counts[b] + counts[b + 1]) / 2 / n;
  }
  return out;
}

const toBytes = (channels: Float32Array[], size: number) => {
  const bytes = new Uint8Array(size * size * 4);
  for (let k = 0; k < size * size; k++) for (let c = 0; c < 4; c++) bytes[k * 4 + c] = Math.round(clamp01(channels[c]?.[k] ?? 1) * 255);
  return bytes;
};

/** The weather map's first three channels over `WEATHER_TILE`: coverage potential, type variation and
 * storm-cell potential, the potentials rank-equalised (see `localCover`). */
export function weatherChannels(size = WEATHER_SIZE, seed = 7): Float32Array[] {
  const n = size * size, cover = new Float32Array(n), variation = new Float32Array(n), storm = new Float32Array(n);
  // Clusters and gaps from a few octaves of gradient noise; individual cells from Worley points about 2.6 km
  // apart (and finer ones between), so a thin sky still breaks into separate cumulus rather than one ragged blob.
  const clusters = octaves(4, 3, 3, seed), cells = lattice('point', 14, 14, seed + 20), small = lattice('point', 29, 29, seed + 23);
  const types = octaves(2, 4, 4, seed + 30), stormCells = lattice('point', 6, 6, seed + 40), stormNoise = lattice('gradient', 5, 5, seed + 41);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = (x + .5) / size, v = (y + .5) / size, k = y * size + x;
    cover[k] = fbm(clusters, u, v) * .62 + (1 - Math.min(worleyAt(cells, u, v) / .75, 1)) * .5 + (1 - Math.min(worleyAt(small, u, v) / .75, 1)) * .14;
    variation[k] = fbm(types, u, v);
    storm[k] = (1 - Math.min(worleyAt(stormCells, u, v) / .8, 1)) + gradientAt(stormNoise, u, v) * .45;
  }
  return [equalise(cover), equalise(variation), equalise(storm)];
}

/** Texels of clear air the weather map's alpha can express: farther reads as this far. */
export const CLEAR_RANGE = 48;

/** Distance (texels, wrapping) from every texel of a `size`² map to the nearest one whose potential reaches
 * `threshold`: how far a ray may cross the sky knowing it meets no cloud. A two-pass chamfer transform, run
 * twice so distances carry across the wrap; `CLEAR_RANGE` when nothing reaches the threshold. */
export function clearDistance(potential: Float32Array, threshold: number, size = WEATHER_SIZE): Float32Array {
  const n = size * size, d = new Float32Array(n);
  for (let k = 0; k < n; k++) d[k] = potential[k] >= threshold ? 0 : CLEAR_RANGE;
  const at = (x: number, y: number) => ((y + size) % size) * size + ((x + size) % size);
  const relax = (k: number, x: number, y: number, dx: number, dy: number, cost: number) => { const v = d[at(x + dx, y + dy)] + cost; if (v < d[k]) d[k] = v; };
  for (let repeat = 0; repeat < 2; repeat++) {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const k = y * size + x;
      relax(k, x, y, -1, 0, 1); relax(k, x, y, 0, -1, 1); relax(k, x, y, -1, -1, Math.SQRT2); relax(k, x, y, 1, -1, Math.SQRT2);
    }
    for (let y = size - 1; y >= 0; y--) for (let x = size - 1; x >= 0; x--) {
      const k = y * size + x;
      relax(k, x, y, 1, 0, 1); relax(k, x, y, 0, 1, 1); relax(k, x, y, 1, 1, Math.SQRT2); relax(k, x, y, -1, 1, Math.SQRT2);
    }
  }
  // The chamfer metric overstates true distance by up to 1 / cos 22.5°: scaled down, it never promises too much.
  for (let k = 0; k < n; k++) if (d[k] < CLEAR_RANGE) d[k] *= Math.cos(Math.PI / 8);
  return d;
}

/** Potential below which a column is certainly clear for a coverage (the horizon's lift included). */
export function clearThreshold(coverage: number, horizon: number): number {
  return 1 - Math.min(coverage + Math.max(horizon, 0), 1) - COVER_BELOW;
}

/** The weather map, RGBA8: the three `weatherChannels` and, in alpha, the clear distance as a share of `CLEAR_RANGE`. */
export function weatherMap(channels: Float32Array[], clear: Float32Array, size = WEATHER_SIZE): Uint8Array {
  return toBytes([...channels, clear.map(d => d / CLEAR_RANGE)], size);
}

/** The cirrus map, RGBA8 over `CIRRUS_TILE`: (fibrous cirrus, a patchy cirrostratus veil, where cirrus
 * grows in clusters, unused). The fibres run along +u; the shader turns them to the wind. */
export function cirrusMap(size = CIRRUS_SIZE, seed = 11): Uint8Array {
  const n = size * size, fibres = new Float32Array(n), veil = new Float32Array(n), clusters = new Float32Array(n);
  // Two slow warps bend the streaks into hooks and fans; the streaks are ridged noise stretched six times
  // along u, so each is a thin bright filament with soft sides rather than a band.
  const warpU = octaves(3, 2, 2, seed), warpV = octaves(3, 3, 3, seed + 5), streaks = octaves(3, 4, 24, seed + 2);
  const veils = octaves(4, 3, 3, seed + 10), groups = octaves(3, 2, 2, seed + 20);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = (x + .5) / size, v = (y + .5) / size, k = y * size + x;
    const wu = u + fbm(warpU, u, v) * .16, wv = v + fbm(warpV, u, v) * .1;
    let sum = 0;
    for (let o = 0, amplitude = 1; o < streaks.length; o++, amplitude *= .55) {
      const ridge = 1 - Math.abs(gradientAt(streaks[o], ((wu % 1) + 1) % 1, ((wv % 1) + 1) % 1)) * 2.2;
      sum += Math.max(ridge, 0) ** 3 * amplitude;
    }
    fibres[k] = sum;
    veil[k] = fbm(veils, u, v);
    clusters[k] = fbm(groups, u, v);
  }
  const f = equalise(fibres), c = equalise(clusters);
  // Filaments only where a patch of cirrus gathers them: a third of the sky, thickest at the patches' hearts.
  for (let k = 0; k < n; k++) f[k] = numbers.smoothstep(.55, .97, f[k]) * numbers.smoothstep(.62, .92, c[k]);
  return toBytes([f, equalise(veil), c, new Float32Array(n).fill(1)], size);
}
