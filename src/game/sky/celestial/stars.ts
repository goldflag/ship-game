import { DataUtils } from 'three/webgpu';
import { SKY_TIERS } from '../quality';

/** The procedural star catalog and the grid the dome finds its stars in. Renderer-free: the dome reads
 * the packed grid (`starTexels`), the tests read the catalog.
 *
 * Magnitudes follow the naked-eye sky: the cumulative count rises about threefold per magnitude down
 * to 6.5, where some 9,000 stars cover the sphere, so every tier draws the brightest part of one
 * catalog. Colours come from B−V, drawn from a mixture that puts most stars between 5,000 and 7,000 K.
 * Faint stars, and young hot ones, crowd toward the galactic plane.
 *
 * Directions are in the galactic frame (x toward the galactic centre, z toward the north galactic
 * pole), the frame the Milky Way is drawn in (`galactic.ts` turns the sky's star frame into it). */

export const STAR_SEED = 0x51a7;
/** The faintest star of the full catalog: the naked-eye limit of a dark sky. */
export const LIMITING_MAGNITUDE = 6.5;
/** Cumulative counts grow tenfold every 1/0.477 magnitudes: threefold per magnitude. */
const COUNT_SLOPE = Math.log10(3);
/** Sirius. Brighter draws are clamped here. */
const BRIGHTEST = -1.46;
export const MAX_STARS = Math.max(...Object.values(SKY_TIERS).map(tier => tier.stars));

/** B−V mixture: hot A and B stars, the F and G dwarfs most naked-eye stars are, K giants and a few M stars. */
const COLOR_POPULATIONS = [
  { share: .14, mean: -.02, spread: .13 },
  { share: .58, mean: .6, spread: .17 },
  { share: .24, mean: 1.12, spread: .16 },
  { share: .04, mean: 1.58, spread: .14 },
] as const;
export const COLOR_INDEX_RANGE = [-.3, 2] as const;

/** How strongly stars crowd toward the galactic plane: density 1 + share·exp(−|b|/scale) relative to the poles.
 * The faint stars carry the Milky Way's concentration; the bright ones are mostly near neighbours, spread evenly. */
const PLANE_SHARE = 2.6, HOT_PLANE_SHARE = 1.5, PLANE_SCALE = 11 * Math.PI / 180;

/** The dome looks stars up in cells of two cube-face grids over the sphere, the second offset half a cell,
 * each holding at most one star. A star sits in whichever grid has it at least `margin` from its cell's
 * edges, so its image never crosses into a cell the pixels around it do not read; a quarter cell is at least
 * the margin everywhere, so one grid or the other always takes a star except within a margin of the cube's
 * edges. `cells` per face edge, `margin` in radians (0.19°, over four pixels at the normal 52° field). */
export const STAR_GRID = { cells: 80, margin: .19 * Math.PI / 180 };
/** Magnitude an empty cell stores: far below anything the dome draws. */
export const EMPTY_MAGNITUDE = 40;

export interface StarSlot {
  /** 0: the grid of whole cells; 1: the grid offset half a cell (edge cells are halves). */
  readonly grid: 0 | 1;
  readonly face: number;
  readonly i: number;
  readonly j: number;
  /** Position inside the cell, 0–1 on each axis of the face. */
  readonly a: number;
  readonly b: number;
}

export interface Star {
  /** Unit vector in the galactic frame. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly magnitude: number;
  /** B−V colour index. */
  readonly colorIndex: number;
  readonly slot: StarSlot;
}

/** Mulberry32: small, fast and well mixed, for a catalog that must not change between runs. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Effective temperature (K) of a star of colour index B−V (Ballesteros, EPL 97, 2012). */
export function colorTemperature(colorIndex: number): number {
  return 4600 * (1 / (.92 * colorIndex + 1.7) + 1 / (.92 * colorIndex + .62));
}

/** Cube face (0–5: ±x, ±y, ±z) of a direction and its gnomonic coordinates on that face, each in [−1, 1]:
 * the two other components over the largest. The dome's shader makes the same choice, ties included. */
export function cubeFace(x: number, y: number, z: number): { face: number; u: number; v: number } {
  const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
  if (ax >= ay && ax >= az) return { face: x >= 0 ? 0 : 1, u: y / ax, v: z / ax };
  if (ay >= az) return { face: y >= 0 ? 2 : 3, u: z / ay, v: x / ay };
  return { face: z >= 0 ? 4 : 5, u: x / az, v: y / az };
}

/** A polynomial in place of the equal-angle warp atan(u)·4/π (within 0.002, and monotonic): cells of equal `s`
 * span nearly equal angles, for a few multiplies instead of two arctangents per pixel. The shader uses the same. */
export const WARP = [.31157, .08442] as const;
export const warp = (u: number) => { const a = Math.abs(u); return u * (1 + (1 - a) * (WARP[0] + WARP[1] * a)); };
/** ds/du of the warp. */
export const warpSlope = (u: number) => { const a = Math.abs(u); return 1 + WARP[0] + 2 * (WARP[1] - WARP[0]) * a - 3 * WARP[1] * a * a; };

/** Angle (radians) per unit of warped coordinate across the lines of constant `s` and `t` at (u, v): the
 * perpendicular widths of a cell, 1 / (s′(u)·√(C(1 + u²))) with C = 1 + u² + v², least at the middle of an edge. */
function across(u: number, v: number): { s: number; t: number } {
  const c = 1 + u * u + v * v;
  return { s: 1 / (warpSlope(u) * Math.sqrt(c * (1 + u * u))), t: 1 / (warpSlope(v) * Math.sqrt(c * (1 + v * v))) };
}

/** The cell of `grid` holding a direction, with the direction's clearance (radians) from that cell's edges. */
export function gridCell(grid: 0 | 1, x: number, y: number, z: number): StarSlot & { clearance: number } {
  const n = STAR_GRID.cells, { face, u, v } = cubeFace(x, y, z);
  const gs = (warp(u) + 1) * n / 2 + grid * .5, gt = (warp(v) + 1) * n / 2 + grid * .5;
  const i = Math.min(Math.floor(gs), n - 1 + grid), j = Math.min(Math.floor(gt), n - 1 + grid);
  const a = gs - i, b = gt - j;
  // The offset grid's first and last cells are halves: the face's edge bounds them at 0.5.
  const low = (k: number) => grid && k === 0 ? .5 : 0, high = (k: number) => grid && k === n ? .5 : 1;
  const scale = across(u, v), cell = 2 / n;
  const clearance = Math.min(Math.min(a - low(i), high(i) - a) * cell * scale.s, Math.min(b - low(j), high(j) - b) * cell * scale.t);
  return { grid, face, i, j, a, b, clearance };
}

/** Texels of the packed grid: the six faces side by side, grid 0 in the first `cells + 1` rows. */
export const STAR_TEXTURE = { width: 6 * (STAR_GRID.cells + 1), height: 2 * (STAR_GRID.cells + 1) };
export const slotTexel = (slot: StarSlot) => slot.face * (STAR_GRID.cells + 1) + slot.i + (slot.grid * (STAR_GRID.cells + 1) + slot.j) * STAR_TEXTURE.width;

/** The full catalog, brightest first. The same seed always gives the same stars. */
export function starCatalog(seed = STAR_SEED): Star[] {
  const random = seededRandom(seed), stars: Star[] = [];
  const gaussian = () => Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
  const occupied = new Uint8Array(STAR_TEXTURE.width * STAR_TEXTURE.height);
  for (let index = 0; index < MAX_STARS; index++) {
    // Stratified in the cumulative count, so every sample follows the law closely and the order is by brightness.
    const share = (index + random()) / MAX_STARS;
    const magnitude = Math.max(BRIGHTEST, LIMITING_MAGNITUDE + Math.log10(share) / COUNT_SLOPE);
    let pick = random(), population = COLOR_POPULATIONS[COLOR_POPULATIONS.length - 1] as (typeof COLOR_POPULATIONS)[number];
    for (const candidate of COLOR_POPULATIONS) { if (pick < candidate.share) { population = candidate; break; } pick -= candidate.share; }
    const colorIndex = Math.min(COLOR_INDEX_RANGE[1], Math.max(COLOR_INDEX_RANGE[0], population.mean + population.spread * gaussian()));
    const faint = Math.min(1, Math.max(0, (magnitude - 1.5) / 5));
    const plane = PLANE_SHARE * faint * faint * (3 - 2 * faint) + (colorIndex < .15 ? HOT_PLANE_SHARE : 0);
    for (;;) {
      // Uniform on the sphere, kept in proportion to the density at its galactic latitude.
      const z = 2 * random() - 1, longitude = 2 * Math.PI * random(), ring = Math.sqrt(1 - z * z);
      if (random() * (1 + plane) > 1 + plane * Math.exp(-Math.asin(Math.abs(z)) / PLANE_SCALE)) continue;
      const x = ring * Math.cos(longitude), y = ring * Math.sin(longitude);
      // The grid that holds it deeper inside a free cell; a spot neither grid can hold is drawn again.
      const cells = [gridCell(0, x, y, z), gridCell(1, x, y, z)].filter(cell => cell.clearance >= STAR_GRID.margin && !occupied[slotTexel(cell)]);
      if (!cells.length) continue;
      const { clearance: _, ...slot } = cells.reduce((best, cell) => cell.clearance > best.clearance ? cell : best);
      occupied[slotTexel(slot)] = 1;
      stars.push({ x, y, z, magnitude, colorIndex, slot });
      break;
    }
  }
  return stars;
}

/** The grid texture's RGBA half floats for the brightest `count` stars: (a, b) inside the cell, magnitude, B−V. */
export function starTexels(stars: readonly Star[], count: number, target = new Uint16Array(STAR_TEXTURE.width * STAR_TEXTURE.height * 4)): Uint16Array {
  const empty = DataUtils.toHalfFloat(EMPTY_MAGNITUDE);
  for (let texel = 0; texel < target.length; texel += 4) { target[texel] = target[texel + 1] = target[texel + 3] = 0; target[texel + 2] = empty; }
  for (const star of stars.slice(0, count)) {
    const texel = slotTexel(star.slot) * 4;
    target[texel] = DataUtils.toHalfFloat(star.slot.a);
    target[texel + 1] = DataUtils.toHalfFloat(star.slot.b);
    target[texel + 2] = DataUtils.toHalfFloat(star.magnitude);
    target[texel + 3] = DataUtils.toHalfFloat(star.colorIndex);
  }
  return target;
}

/** CIE 1931 2° colour matching functions, the multi-lobe fit of Wyman, Sloan and Shirley (JCGT 2, 2013). */
function matching(nm: number): [number, number, number] {
  const lobe = (mean: number, low: number, high: number) => { const t = (nm - mean) / (nm < mean ? low : high); return Math.exp(-.5 * t * t); };
  return [
    1.056 * lobe(599.8, 37.9, 31) + .362 * lobe(442, 16, 26.7) - .065 * lobe(501.1, 20.4, 26.2),
    .821 * lobe(568.8, 46.9, 40.5) + .286 * lobe(530.9, 16.3, 31.1),
    1.217 * lobe(437, 11.8, 36) + .681 * lobe(459, 26, 13.8),
  ];
}

/** Linear sRGB of a blackbody at `kelvin`, scaled to unit luminance and clipped to the gamut. */
export function blackbodyColor(kelvin: number): [number, number, number] {
  let x = 0, y = 0, z = 0;
  for (let nm = 380; nm <= 780; nm += 5) {
    const metres = nm * 1e-9;
    // Planck's law up to a constant: λ⁻⁵ / (exp(hc/λkT) − 1).
    const radiance = 1 / (metres ** 5 * (Math.exp(1.4388e-2 / (metres * kelvin)) - 1));
    const [xb, yb, zb] = matching(nm);
    x += radiance * xb; y += radiance * yb; z += radiance * zb;
  }
  const rgb: [number, number, number] = [
    Math.max(0, 3.2406 * x - 1.5372 * y - .4986 * z),
    Math.max(0, -.9689 * x + 1.8758 * y + .0415 * z),
    Math.max(0, .0557 * x - .204 * y + 1.057 * z),
  ];
  const luminance = .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2];
  return rgb.map(channel => channel / luminance) as [number, number, number];
}
