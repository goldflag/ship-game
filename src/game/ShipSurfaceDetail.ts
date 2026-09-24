import * as THREE from 'three/webgpu';
import {
  Fn, If, abs, attribute, cross, dFdx, dFdy, dot, exp, faceDirection, float, materialColor, materialRoughness, max, mix, mx_noise_float, normalGeometry, normalView,
  positionGeometry, positionView, pow, select, smoothstep, texture, uniform, vec2, vec3, vec4,
} from 'three/tsl';
import type { Node } from 'three/webgpu';

/** Physically scaled surface detail for ship paint and teak, evaluated in each mesh's own
 * (pre-batching) geometry space, so it follows turrets and every other articulated owner.
 *
 * Nothing here is baked into the ship assets. Small repeating textures are generated once and
 * read through shared nodes:
 * - plating: 2 m strakes, 8 m butts with staggered offsets, welded seams and slight
 *   dishing between frames as a height gradient, plus a low-frequency roughness field;
 * - teak: 16 cm planks with staggered 5.12 m butts, caulking, grain and relief, stretched to
 *   each deck's declared plank size (`deckPlanks`).
 * Relief is applied as a surface gradient (Mikkelsen) from the per-pixel derivatives of
 * the geometry and view positions, so it needs no tangents and holds for batched,
 * instanced and mirrored meshes alike. Mipmaps average the gradients towards zero, so
 * the detail recedes with distance and the approved scheme reads unchanged.
 *
 * Every ship, premade or player-built, draws its plating from a finish tile on the same seams:
 * weld beads between shrinkage hollows, a line of grime along every seam and each plate's own
 * shade, roller strips and marks as painted, on decks and roofs too, so even a fresh ship reads
 * as plated steel. Paint wears here too, by the amounts and distances measured per vertex when
 * the model was assembled or loaded (`shipWear`, see constructionWear): metric mottling from the
 * plating tile's alpha, runoff streaks from a third tile hanging below top edges and, shorter
 * and closer set, below every strake seam, rust bleeding from the seams, a tide stain at the
 * rest waterline and soot at funnel tops. Paint that wears nothing takes the same program and
 * skips all of it. */

/** Whether a source material's paint is welded steel plate (per vertex, so materials that share one palette entry keep their
 * own class). The same paints weather (constructionWear). */
export { isPlatedPaint } from './constructionWear';

export type ShipSurfaceMode = 'surface' | 'teak';

const scale = new THREE.Vector3(), extent = new THREE.Vector3();
/** A mesh broad enough to be built from plates: at least two sides of two metres. Doors,
 * vents, barrels, masts and other small fittings stay plain. */
export function isPlateSized(mesh: THREE.Mesh): boolean {
  const geometry = mesh.geometry;
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  geometry.boundingBox!.getSize(extent).multiply(mesh.getWorldScale(scale));
  return [extent.x, extent.y, extent.z].filter(side => Math.abs(side) >= 2).length >= 2;
}

/** A timber deck's planks, all in metres: their width, their length between butts and the width of the caulked seams
 * between them. Premade decks declare theirs in their appearance (`decking`), which the model carries as material extras;
 * player-built timber takes the default, the shared teak tile's own 16 cm by 5.12 m. */
export interface DeckPlanks { width: number; length: number; seam: number }
export function deckPlanks(material: THREE.Material): DeckPlanks {
  const { deckPlankWidth: width, deckPlankLength: length, deckSeamWidth: seam } = material.userData;
  const within = (value: unknown, low: number, high: number): value is number => typeof value === 'number' && value >= low && value <= high;
  return { width: within(width, .05, .5) ? width : TEAK.plank, length: within(length, .5, 20) ? length : TEAK.butt, seam: within(seam, .001, .02) ? seam : TEAK.caulk };
}

/** Every timber deck, premade or player-built, is planked by the shared teak at its own plank size (`deckPlanks`). Its stain is
 * the mean of a repeating map, or the colour of a whole-deck image, which keeps the markings and boundaries it paints. A
 * timber surface with a normal map of its own keeps its authored planks. */
export function shipSurfaceMode(material: THREE.MeshStandardMaterial): ShipSurfaceMode {
  return material.userData.deckSubstrate === 'timber' && !material.normalMap && !material.userData.deckModeled ? 'teak' : 'surface';
}

// Plating tile: 16 m square, eight 2 m strakes, two 8 m plates per strake.
export const PLATE = { tile: 16, size: 1024, strake: 2, butt: 8, frame: 1, gradientScale: .25 } as const;
// Runoff tile: 16 m along a top edge by 16 m down from it, one channel per wear preset.
export const STREAK = { along: 16, down: 16, width: 1024, height: 256 } as const;
/** The construction wear presets' amounts, which the runoff tile's channels are drawn for. */
export const WEAR_LEVELS = [.1, .4, .7, 1] as const;
// Teak tile: 16 planks of 16 cm across, 20.48 m along with four 5.12 m butts per plank.
export const TEAK = { across: 2.56, along: 20.48, width: 512, length: 2048, plank: .16, butt: 5.12, caulk: .004, gradientScale: .5 } as const;

const fract = (x: number) => x - Math.floor(x);
const hash = (a: number, b = 0, c = 0) => fract(Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453);
const smooth = (t: number) => t * t * (3 - 2 * t);
/** Periodic value noise on a square tile: `cells` lattice cells across the period. */
function tileNoise(u: number, v: number, cells: number, seed: number): number {
  const x = u * cells, y = v * cells, ix = Math.floor(x), iy = Math.floor(y), fx = smooth(x - ix), fy = smooth(y - iy);
  const at = (i: number, j: number) => hash(((i % cells) + cells) % cells, ((j % cells) + cells) % cells, seed);
  const a = at(ix, iy), b = at(ix + 1, iy), c = at(ix, iy + 1), d = at(ix + 1, iy + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
/** `tileNoise` with its lattice tabulated once, for whole-tile fields. */
function noiseTable(cells: number, seed: number): (u: number, v: number) => number {
  const lattice = Float32Array.from({ length: cells * cells }, (_, k) => hash(k % cells, Math.floor(k / cells), seed));
  return (u, v) => {
    const x = u * cells, y = v * cells, ix = Math.floor(x), iy = Math.floor(y), fx = smooth(x - ix), fy = smooth(y - iy);
    const i0 = ((ix % cells) + cells) % cells, j0 = ((iy % cells) + cells) % cells, i1 = (i0 + 1) % cells, j1 = (j0 + 1) % cells;
    const a = lattice[j0 * cells + i0], b = lattice[j0 * cells + i1], c = lattice[j1 * cells + i0], d = lattice[j1 * cells + i1];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}
/** How far along the tile a strake's first butt sits, in whole frames. The plating and finish tiles share it, so
 * their seams coincide. */
const buttOffset = (row: number) => Math.round(hash(row, 3) * PLATE.butt / PLATE.frame) * PLATE.frame;
/** Pitch caulking darkens the board colour by this fraction at full coverage. */
const CAULK_DARKENING = .62;
/** Mean board colour without caulking over mean with it: the pattern's mean while caulking fades. */
let teakAlbedoRatio = 1.03;
const encode = (value: number, scale: number) => Math.max(0, Math.min(255, Math.round(127.5 + value / scale * 127.5)));

/** RGBA plating texels: R,G height gradient along u (length or beam) and v (height), per
 * metre of surface; B roughness field (0.5 neutral); A paint mottling for worn paint (0.5
 * neutral, peaks at 0 and 1), as the premade finish's 1.3 m and 0.31 m blotches plus a slight
 * tone per plate. Rows, columns and plates are tabulated so the per-texel work stays small. */
export function plateTexels(size: number = PLATE.size): Uint8Array {
  const { tile, strake, butt, frame } = PLATE, texel = tile / size, plates = tile / butt;
  const height = new Float32Array(size * size), weld = .018, depth = .0045, reach = 3 * weld;
  const mottle = new Float32Array(size * size), coarse = noiseTable(12, 21), fine = noiseTable(52, 23);
  const bay = new Float32Array(size);
  for (let x = 0; x < size; x++) bay[x] = Math.sin(Math.PI * (((x + .5) * texel) % frame) / frame);
  // Low-frequency roughness on a quarter-resolution lattice; it varies over metres.
  const low = size >> 2, field = new Float32Array(low * low);
  for (let y = 0; y < low; y++) for (let x = 0; x < low; x++) field[y * low + x] = .6 * tileNoise((x + .5) / low, (y + .5) / low, 4, 11) + .4 * tileNoise((x + .5) / low, (y + .5) / low, 12, 13);
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    const v = (y + .5) * texel, row = Math.floor(v / strake), across = v - row * strake, rowSin = Math.sin(Math.PI * across / strake);
    const offset = buttOffset(row), rim = Math.min(across, strake - across);
    const dish = Array.from({ length: plates }, (_, plate) => .002 + .003 * hash(row, plate, 7));
    const tint = Array.from({ length: plates }, (_, plate) => .22 * (hash(row, plate, 5) - .5));
    const tone = Array.from({ length: plates }, (_, plate) => .5 * (hash(row, plate, 19) - .5));
    for (let x = 0; x < size; x++) {
      const run = (x + .5) * texel + offset, plate = Math.floor(run / butt) % plates, along = run % butt;
      const seam = Math.min(rim, along, butt - along), u = (x + .5) / size, w = (y + .5) / size;
      mottle[y * size + x] = .65 * (2 * coarse(u, w) - 1) + .35 * (2 * fine(u, w) - 1) + tone[plate];
      // Welded butts and seams: a shallow groove about two centimetres either side;
      // plates dish slightly between transverse frames and strake edges.
      height[y * size + x] = (seam < reach ? -depth * Math.exp(-((seam / weld) ** 2)) : 0) - dish[plate] * bay[x] * rowSin;
      pixels[(y * size + x) * 4 + 2] = Math.max(0, Math.min(255, Math.round((.5 + .7 * (field[(y >> 2) * low + (x >> 2)] - .5) + tint[plate]) * 255)));
    }
  }
  // Mottling averages out with distance: centre it, and scale its peaks to the encoding's.
  let mean = 0, peak = 0;
  for (const value of mottle) mean += value / mottle.length;
  for (const value of mottle) peak = Math.max(peak, Math.abs(value - mean));
  for (let y = 0; y < size; y++) {
    const up = ((y + 1) % size) * size, down = ((y + size - 1) % size) * size;
    for (let x = 0; x < size; x++) {
      const right = (x + 1) % size, left = (x + size - 1) % size, i = (y * size + x) * 4;
      pixels[i] = encode((height[y * size + right] - height[y * size + left]) / (2 * texel), PLATE.gradientScale);
      pixels[i + 1] = encode((height[up + x] - height[down + x]) / (2 * texel), PLATE.gradientScale);
      pixels[i + 3] = encode(mottle[y * size + x] - mean, peak);
    }
  }
  return pixels;
}

/** Construction plating as welded and painted, on the plating tile's own seams. Heights and widths in metres. */
export const FINISH = {
  gradientScale: .25,
  /** A weld bead stands proud of the plate; the shrinkage of the weld pulls a shallow hollow either side of it. */
  bead: .0018, beadWidth: .014, hollow: .003, hollowWidth: .09,
  /** Plates dish between frames (hungry horse) by this range, deeper than the premade tile's. */
  dish: [.003, .007],
  /** Half-width of the line along a seam where paint pools and grime gathers. */
  seamLine: .016,
  /** Width of the painters' roller strips down a plate; the size across and along of the roller's own marks, and their
   * share of the tone beside a plate's shade. */
  strip: .6, mark: [.05, .5], markTone: .25,
} as const;

/** RGBA finish texels for construction ships on the plating tile's layout: R,G height gradient along u and v per
 * metre, of weld beads between shrinkage hollows and plates dishing between frames; B seam line coverage; A paint
 * tone as applied (0.5 neutral, peaks at 0 and 1): each plate's own shade, the roller strips down it, the roller's
 * marks and faint cloudiness. */
export function finishTexels(size: number = PLATE.size): Uint8Array {
  const { tile, strake, butt, frame } = PLATE, texel = tile / size, plates = tile / butt, n = size * size;
  const perStrake = Math.round(strake / texel), perButt = Math.round(butt / texel), at = (k: number) => (k + .5) * texel;
  // Every seam falls on a texel boundary, so a texel lies a whole number of texels and a half from its nearest seam.
  const reach = Math.min(perStrake >> 1, Math.ceil(4 * FINISH.hollowWidth / texel));
  const profile = Float32Array.from({ length: reach }, (_, k) =>
    FINISH.bead * Math.exp(-((at(k) / FINISH.beadWidth) ** 2)) - FINISH.hollow * Math.exp(-((at(k) / FINISH.hollowWidth) ** 2)));
  const line = Float32Array.from({ length: reach }, (_, k) => Math.exp(-((at(k) / FINISH.seamLine) ** 2)));
  const bay = Float32Array.from({ length: size }, (_, x) => Math.sin(Math.PI * (at(x) % frame) / frame));
  // Slow fields on a quarter-resolution lattice, read bilinearly: cloudiness about 0.8 m across (even entries) and
  // how much grime a seam holds (odd entries).
  const low = size >> 2, cloud = noiseTable(20, 41), fleck = noiseTable(64, 43), slow = new Float32Array(low * low * 2);
  for (let y = 0; y < low; y++) for (let x = 0; x < low; x++) {
    const i = 2 * (y * low + x);
    slow[i] = cloud(x / low, y / low) - .5; slow[i + 1] = .7 + .3 * fleck(x / low, y / low);
  }
  const lattice = (t: number) => { const l = (t - 1.5) / 4, c = Math.floor(l); return [((c % low) + low) % low, (c + 1) % low, l - c] as const; };
  const column = Array.from({ length: size }, (_, x) => lattice(x));
  const stripCells = Math.round(tile / FINISH.strip), strips = noiseTable(stripCells, 47);
  // The roller's own marks: narrow runs of thicker and thinner paint, a few centimetres across and half a metre long,
  // as value noise on a lattice that long and that narrow. Each row blends two lattice rows, then reads across them.
  const across = Math.round(tile / FINISH.mark[0]), along = Math.round(tile / FINISH.mark[1]);
  const markLattice = Float32Array.from({ length: across * along }, (_, k) => hash(k % across, Math.floor(k / across), 53) - .5);
  const markCell = Int32Array.from({ length: size }, (_, x) => Math.floor(at(x) / tile * across));
  const markFraction = Float32Array.from({ length: size }, (_, x) => smooth(at(x) / tile * across - markCell[x]));
  const markRow = new Float32Array(across), marks = new Float32Array(size);
  const height = new Float32Array(n), tone = new Float32Array(n), seams = new Float32Array(n), strip = new Float32Array(size);
  for (let y = 0; y < size; y++) {
    const row = Math.floor(y / perStrake), k = y - row * perStrake, rim = Math.min(k, perStrake - 1 - k);
    const rowSin = Math.sin(Math.PI * at(k) / strake), offset = Math.round(buttOffset(row) / texel);
    const dish = Array.from({ length: plates }, (_, plate) => FINISH.dish[0] + (FINISH.dish[1] - FINISH.dish[0]) * hash(row, plate, 31));
    const shade = Array.from({ length: plates }, (_, plate) => hash(row, plate, 29) - .5);
    // Roller strips run down each strake, so one row of them serves the whole strake.
    if (k === 0) for (let x = 0; x < size; x++) strip[x] = .45 * (strips(at(x) / tile, row / stripCells) - .5);
    const mv = at(y) / tile * along, m0 = Math.floor(mv), mf = smooth(mv - m0), l0 = (m0 % along) * across, l1 = ((m0 + 1) % along) * across;
    for (let c = 0; c < across; c++) markRow[c] = markLattice[l0 + c] + (markLattice[l1 + c] - markLattice[l0 + c]) * mf;
    for (let x = 0; x < size; x++) { const c = markCell[x]; marks[x] = FINISH.markTone * (markRow[c] + (markRow[(c + 1) % across] - markRow[c]) * markFraction[x]); }
    const strakeSeam = rim < reach ? line[rim] : 0, [y0, y1, fy] = lattice(y), r0 = y0 * low, r1 = y1 * low;
    let j = offset % perButt, plate = Math.floor(offset / perButt) % plates;
    for (let x = 0; x < size; x++, j++) {
      if (j === perButt) { j = 0; plate = (plate + 1) % plates; }
      const gap = Math.min(j, perButt - 1 - j), nearest = Math.min(rim, gap), i = y * size + x, [x0, x1, fx] = column[x];
      const a = 2 * (r0 + x0), b = 2 * (r0 + x1), c = 2 * (r1 + x0), d = 2 * (r1 + x1);
      const wa = (1 - fx) * (1 - fy), wb = fx * (1 - fy), wc = (1 - fx) * fy, wd = fx * fy;
      height[i] = (nearest < reach ? profile[nearest] : 0) - dish[plate] * bay[x] * rowSin;
      // Grime lies unevenly along a seam; the strake seams, which water runs over, hold more of it than the butts.
      const seam = Math.max(strakeSeam, gap < reach ? .75 * line[gap] : 0);
      if (seam) seams[i] = seam * (slow[a + 1] * wa + slow[b + 1] * wb + slow[c + 1] * wc + slow[d + 1] * wd);
      // The plate's own shade dominates its roller strips and cloudiness.
      tone[i] = shade[plate] + strip[x] + marks[x] + .35 * (slow[a] * wa + slow[b] * wb + slow[c] * wc + slow[d] * wd);
    }
  }
  let mean = 0, peak = 0;
  for (let i = 0; i < n; i++) mean += tone[i];
  mean /= n;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(tone[i] - mean));
  const pixels = new Uint8Array(n * 4);
  for (let y = 0; y < size; y++) {
    const up = ((y + 1) % size) * size, down = ((y + size - 1) % size) * size;
    for (let x = 0; x < size; x++) {
      const right = (x + 1) % size, left = (x + size - 1) % size, i = y * size + x, o = i * 4;
      pixels[o] = encode((height[y * size + right] - height[y * size + left]) / (2 * texel), FINISH.gradientScale);
      pixels[o + 1] = encode((height[up + x] - height[down + x]) / (2 * texel), FINISH.gradientScale);
      pixels[o + 2] = Math.round(255 * Math.min(1, seams[i]));
      pixels[o + 3] = encode(tone[i] - mean, peak);
    }
  }
  return pixels;
}

/** Streaks per preset: the share of the tile's candidate streaks drawn (about 0.4, 1, 1.8 and 2.8 a metre) and
 * the longest one's reach in metres. A few broad, faint washes of rain-carried grime run among the thin ones. */
const RUNOFF = { candidates: 64, washes: 14, drawn: [.1, .26, .45, .7], reach: [.7, 2.2, 4.5, 8] } as const;
/** RGBA runoff texels, `width` along a top edge by `height` down from it (row 0 at the edge): each channel
 * the streak coverage at one of `WEAR_LEVELS`. A streak keeps its place, width and wander at every level;
 * more of them appear, and each runs further, as the wear grows. Coverage fades before the tile's foot, so
 * surfaces further down (and `WEAR_NONE`) clamp to none. */
export function streakTexels(width: number = STREAK.width, height: number = STREAK.height): Uint8Array {
  const { along, down } = STREAK, sx = along / width, sy = down / height, clear = RUNOFF.drawn.map(() => new Float32Array(width * height).fill(1));
  // Streaks gather where the water drains: some stretches of an edge collect several, others none.
  const gathering = noiseTable(5, 31);
  for (let i = 0; i < RUNOFF.candidates + RUNOFF.washes; i++) {
    const wash = i >= RUNOFF.candidates, at = hash(i, 1) * along, rank = hash(i, 2) * (.35 + 1.3 * gathering(at / along, 0));
    const reach = wash ? .4 + .6 * hash(i, 3) : .2 + .8 * hash(i, 3) ** 1.5, strength = wash ? .12 + .2 * hash(i, 4) : .3 + .7 * hash(i, 4) ** 1.5;
    // Mostly thin: 4 cm to about 25 cm, wandering a centimetre or two as it runs; washes 30 to 90 cm.
    const breadth = wash ? .3 + .6 * hash(i, 5) : .04 + .21 * hash(i, 5) ** 2.5, wander = (wash ? 3 : 1) * (.004 + .014 * hash(i, 6));
    const turn = 1.2 + 3 * hash(i, 7), phase = 2 * Math.PI * hash(i, 8);
    RUNOFF.drawn.forEach((drawn, level) => {
      if (rank >= drawn) return;
      const length = RUNOFF.reach[level] * reach, rows = Math.min(height, Math.ceil(length / sy)), cover = clear[level];
      for (let y = 0; y < rows; y++) {
        const d = (y + .5) * sy, t = Math.min(1, d / length), half = breadth / 2 * (1 - .55 * t);
        const centre = at + wander * Math.sin(turn * d + phase) + .5 * wander * Math.sin(2.9 * turn * d + 2 * phase);
        // Full at the edge, thinning out over the last two thirds of its run, with a little unevenness.
        const fade = strength * (1 - smooth(Math.max(0, (t - .3) / .7))) * (.75 + .25 * Math.sin(d * 5.3 + phase * 3));
        for (let x = Math.floor((centre - half) / sx); x <= Math.ceil((centre + half) / sx); x++) {
          const offset = ((x + .5) * sx - centre) / half;
          if (Math.abs(offset) >= 1) continue;
          const k = y * width + ((x % width) + width) % width;
          cover[k] *= 1 - fade * (1 - offset * offset) ** 2;
        }
      }
    });
  }
  const pixels = new Uint8Array(width * height * 4);
  for (let k = 0; k < width * height; k++) for (let level = 0; level < 4; level++) pixels[k * 4 + level] = Math.round(255 * (1 - clear[level][k]));
  return pixels;
}

/** RGBA teak texels, `width` across the beam by `length` along the ship: R albedo factor
 * (plank tone and grain, 0.5 = ×1), G caulking coverage, B,A height gradient across/along. */
export function teakTexels(width: number = TEAK.width, length: number = TEAK.length): Uint8Array {
  const { across: tileAcross, along: tileAlong, plank, butt } = TEAK, sx = tileAcross / width, sz = tileAlong / length;
  const planks = Math.round(tileAcross / plank), caulk = TEAK.caulk, groove = .0035, n = width * length;
  const height = new Float32Array(n), albedo = new Float32Array(n), seams = new Float32Array(n);
  const rowOf = new Int32Array(width), inPlankOf = new Float32Array(width), edgeOf = new Float32Array(width);
  for (let x = 0; x < width; x++) {
    const across = (x + .5) * sx, index = Math.floor(across / plank);
    rowOf[x] = index % planks; inPlankOf[x] = across - index * plank; edgeOf[x] = Math.min(inPlankOf[x], plank - inPlankOf[x]);
  }
  const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
  // Per plank and position along it: butt joints, board tone and the grain's slow wander.
  const end = new Float32Array(planks * length), tone = new Float32Array(planks * length), phase = new Float32Array(planks * length), warp = new Float32Array(planks * length);
  for (let row = 0; row < planks; row++) {
    // Butts shift by three quarters of a board on each successive plank, with a little jitter.
    const shift = ((row * 3) % 4) / 4 * butt + (hash(row, 1) - .5) * .8;
    for (let z = 0; z < length; z++) {
      const along = (z + .5) * sz, run = along + shift, board = Math.floor(run / butt), inBoard = run - board * butt, id = ((board % 4) + 4) % 4, k = row * length + z;
      end[k] = Math.min(inBoard, butt - inBoard);
      tone[k] = (hash(row, id, 3) - .5) * .16 + (tileNoise((row + .5) / planks, along / tileAlong, 8, row + 17) - .5) * .06;
      phase[k] = hash(row, id, 9) * 40;
      warp[k] = Math.sin(along * 1.3 + phase[k]) * .006 + Math.sin(along * 4.1 + phase[k] * 2) * .002;
    }
  }
  // Grain: two sinusoids across the board whose phase wanders along it, split by the angle-sum
  // identity so the texel loop only multiplies tabulated terms.
  const coarse = 2 * Math.PI / .019, fine = 2 * Math.PI / .013;
  const across = (table: Float32Array, f: (x: number) => number) => { for (let x = 0; x < width; x++) table[x] = f(inPlankOf[x]); return table; };
  const sc = across(new Float32Array(width), p => Math.sin(p * coarse)), cc = across(new Float32Array(width), p => Math.cos(p * coarse));
  const sf = across(new Float32Array(width), p => Math.sin(p * fine)), cf = across(new Float32Array(width), p => Math.cos(p * fine));
  const along = (f: (k: number) => number) => Float32Array.from({ length: planks * length }, (_, k) => f(k));
  const sca = along(k => Math.sin(warp[k] * coarse + phase[k])), cca = along(k => Math.cos(warp[k] * coarse + phase[k]));
  const sfa = along(k => Math.sin(warp[k] * 1.7 * fine + phase[k] * 3)), cfa = along(k => Math.cos(warp[k] * 1.7 * fine + phase[k] * 3));
  // The groove at the nearest seam is the deeper of the side and end grooves.
  const profile = (d: number) => d < 3 * groove ? Math.exp(-((d / groove) ** 2)) : 0;
  const sideGroove = edgeOf.map(profile), endGroove = end.map(profile);
  const sideCaulk = edgeOf.map(edge => clamp01((caulk / 2 + sx / 2 - edge) / sx)), endCaulk = end.map(e => clamp01((caulk / 2 + sz / 2 - e) / sz));
  let mean = 0, bare = 0;
  for (let z = 0; z < length; z++) for (let x = 0; x < width; x++) {
    const k = rowOf[x] * length + z, i = z * width + x;
    const grain = .6 * (sc[x] * cca[k] + cc[x] * sca[k]) + .4 * (sf[x] * cfa[k] + cf[x] * sfa[k]);
    // Pitch caulking with an antialiased edge at this texel's footprint.
    const coverage = Math.max(sideCaulk[x], endCaulk[k]);
    albedo[i] = 1 + tone[k] + .045 * grain; seams[i] = coverage;
    height[i] = -.0012 * Math.max(sideGroove[x], endGroove[k]) + .00003 * grain;
    mean += albedo[i] * (1 - CAULK_DARKENING * coverage); bare += albedo[i];
  }
  // Normalise so the tile's mean colour, caulking included, is exactly the map's mean tone.
  teakAlbedoRatio = bare / mean; mean /= n;
  const pixels = new Uint8Array(n * 4);
  for (let z = 0; z < length; z++) {
    const up = ((z + 1) % length) * width, down = ((z + length - 1) % length) * width;
    for (let x = 0; x < width; x++) {
      const i = z * width + x, o = i * 4, right = (x + 1) % width, left = (x + width - 1) % width;
      pixels[o] = Math.max(0, Math.min(255, Math.round(albedo[i] / mean * 127.5)));
      pixels[o + 1] = Math.round(seams[i] * 255);
      pixels[o + 2] = encode((height[z * width + right] - height[z * width + left]) / (2 * sx), TEAK.gradientScale);
      pixels[o + 3] = encode((height[up + x] - height[down + x]) / (2 * sz), TEAK.gradientScale);
    }
  }
  return pixels;
}

function dataTexture(pixels: Uint8Array, width: number, height: number, name: string, wrapT: THREE.Wrapping = THREE.RepeatWrapping): THREE.DataTexture {
  const map = new THREE.DataTexture(pixels, width, height);
  map.name = name; map.wrapS = THREE.RepeatWrapping; map.wrapT = wrapT;
  map.magFilter = THREE.LinearFilter; map.minFilter = THREE.LinearMipmapLinearFilter;
  map.generateMipmaps = true; map.anisotropy = 8; map.needsUpdate = true;
  return map;
}

/** Relief strength, for review. */
export const surfaceRelief = uniform(1);
/** Paint wear and the plating finish, for review and frame-cost measurement: 0 draws neither (each ship's plain paint and the
 * plain plating relief), 1 as designed. */
export const surfaceWear = uniform(1);
/** −1 draws each ship's own wear; 0 or more draws that amount on all of them instead (review). */
export const wearOverride = uniform(-1);
/** Plating as welded and painted (seams, relief, each plate's shade), for review: 0 draws the plain plating relief
 * instead, 1 as designed. */
export const plateFinish = uniform(1);

/** Worn paint, per unit of wear amount where a pair gives [at none, added per unit]. Tints are linear colour
 * multipliers at full coverage. */
const WEAR = {
  /** Peak tone swing of the mottling: ±11 % in commission (0.4), the maintained finish Blender once baked into premade paint. */
  mottle: .27,
  /** Share of the streak tint a fully covered streak takes. */
  streak: [.35, .45],
  grime: [.5, .49, .47], rust: [.7, .45, .3],
  /** Olive-brown scum at the waterline, and the share of it at the band's centre. */
  tide: [.6, .58, .42], stain: .9,
  /** Soot reach below a funnel's top in metres, its darkness and colour. */
  sootReach: [1, 3], sootDarkness: [.5, .45], soot: [.09, .085, .08],
} as const;

/** Paint as applied, on every ship however fresh; pairs give [fresh, added per unit of wear]. */
const APPLIED = {
  /** Peak tone swing across plates, roller strips and marks, and cloudiness. */
  tone: .17,
  /** Roughness swing with the tone: thicker, darker paint is a little glossier. */
  sheen: .12,
  /** Share of its tint a fully covered seam line takes: grime, turning to rust bled from the seam as the paint wears. */
  seam: [.55, .3], seamGrime: [.3, .29, .28], seamRust: [.5, .3, .17], seamRough: .15,
  /** Runoff from strake seams: its share of a top edge's, how many times shorter its streaks run and how much closer
   * set, and how much wetter a seam runs than its wear (a preset's seams draw the next preset's density of streaks). */
  seamRunoff: 1.2, seamRun: 2.5, seamSpacing: 3, seamWetter: 1.75,
  /** Seams leak unevenly: the least a seam carries of the full runoff. */
  leakMin: .7,
  /** Grime gathered in a soft band below each strake seam: its darkness per unit of wear and its reach in metres. */
  band: .25, bandReach: .25,
} as const;

type Nodes = { plateNormal: Node<'vec3'>; paintColor: Node<'vec3'>; paintRoughness: Node<'float'>; plainRoughness: Node<'float'>; teak: THREE.DataTexture };
let nodes: Nodes | undefined;
type TeakNodes = { teakNormal: Node<'vec3'>; teakRoughness: Node<'float'>; teakPattern: Node<'float'> };
/** Planked teak per plank size; a fleet has a handful. */
const teakNodes = new Map<string, TeakNodes>();

/** Surface relief from an object-space height gradient `gradient` (height per metre in
 * geometry space) through the screen derivatives of geometry and view positions. */
function perturbed(gradient: Node<'vec3'>): Node<'vec3'> {
  const fx = dot(gradient, dFdx(positionGeometry)), fy = dot(gradient, dFdy(positionGeometry));
  const a = dFdx(positionView), b = dFdy(positionView), n = normalView;
  const r1 = cross(b, n), r2 = cross(n, a), det = dot(a, r1);
  const surfaceGradient = r1.mul(fx).add(r2.mul(fy)).mul(det.sign());
  return n.mul(max(abs(det), 1e-24)).sub(surfaceGradient.mul(faceDirection)).normalize();
}

/** Created once; every palette material shares these nodes. */
function shipSurfaceNodes(): Nodes {
  if (nodes) return nodes;
  const plate = dataTexture(plateTexels(), PLATE.size, PLATE.size, 'Ship plating detail');
  const teak = dataTexture(teakTexels(), TEAK.width, TEAK.length, 'Ship teak detail');
  const streaks = dataTexture(streakTexels(), STREAK.width, STREAK.height, 'Ship runoff streaks', THREE.ClampToEdgeWrapping);
  const finish = dataTexture(finishTexels(), PLATE.size, PLATE.size, 'Construction plating finish');
  // Roughness, metalness, plated-paint flag; `w` is the wet band's rest height (HullWetBand).
  const surface = attribute<'vec4'>('shipSurface', 'vec4');
  // Paint that wears carries its ship's wear amount; paint of a ship with none, and paint that does not wear, carry none.
  const worn = attribute<'vec4'>('shipWear', 'vec4');
  const p = positionGeometry, n = normalGeometry.normalize();
  // Triplanar weights in geometry space: beam-facing sides, end bulkheads and decks.
  const w0 = pow(abs(n), vec3(4)), w = w0.div(w0.x.add(w0.y).add(w0.z));
  const side = texture(plate, p.zy.div(PLATE.tile)), end = texture(plate, p.xy.div(PLATE.tile)), top = texture(plate, p.zx.div(PLATE.tile));
  const gradient = (s: Node<'vec4'>, scale: number) => s.xy.mul(2).sub(1).mul(scale);
  const gs = gradient(side, PLATE.gradientScale), ge = gradient(end, PLATE.gradientScale);
  const plating = Fn(() => {
    // Paint that does not wear keeps the plain plating relief, on vertical faces only.
    const relief = vec3(ge.x.mul(w.z), gs.y.mul(w.x).add(ge.y.mul(w.z)), gs.x.mul(w.x)).toVar();
    If(worn.x.mul(surfaceWear).greaterThan(1e-4).and(plateFinish.greaterThan(.5)), () => {
      // Plating as welded, on decks and roofs too.
      const fs = gradient(texture(finish, p.zy.div(PLATE.tile)), FINISH.gradientScale), fe = gradient(texture(finish, p.xy.div(PLATE.tile)), FINISH.gradientScale);
      const ft = gradient(texture(finish, p.zx.div(PLATE.tile)), FINISH.gradientScale);
      relief.assign(vec3(fe.x.mul(w.z).add(ft.y.mul(w.y)), fs.y.mul(w.x).add(fe.y.mul(w.z)), fs.x.mul(w.x).add(ft.x.mul(w.y))));
    });
    return relief.mul(surface.z).mul(surfaceRelief);
  })();
  const roughness = side.z.mul(w.x).add(end.z.mul(w.z)).add(top.z.mul(w.y));
  const plainRoughness = materialRoughness.mul(surface.x);
  // ±8 % about the authored roughness; paint stays matte.
  const plateRoughness = plainRoughness.mul(roughness.sub(.5).mul(surface.z.mul(.16)).add(1));

  // Paint as applied and worn: colour (rgb) and roughness (a) multipliers, exactly 1 on paint that wears nothing.
  const wearing = Fn(() => {
    const factor = vec4(1).toVar();
    // Streak gradients come from the continuous position, taken here in uniform control flow.
    const dx = dFdx(positionGeometry).toVar(), dy = dFdy(positionGeometry).toVar();
    If(worn.x.mul(surfaceWear).greaterThan(1e-4), () => {
      // Fresh nodes throughout: one shared with the other outputs would be declared inside this branch.
      const q = positionGeometry, m = normalGeometry.normalize(), m4 = pow(abs(m), vec3(4)), tri = m4.div(m4.x.add(m4.y).add(m4.z));
      const amount = select(wearOverride.greaterThanEqual(0), wearOverride, worn.x).mul(surfaceWear).toVar();
      const plated = attribute<'vec4'>('shipSurface', 'vec4').z.mul(plateFinish).toVar();
      // Paint as applied, fresh or worn: each plate's own shade and roller strips, and the lines of its seams.
      const applied = texture(finish, q.zy.div(PLATE.tile)).zw.mul(tri.x).add(texture(finish, q.xy.div(PLATE.tile)).zw.mul(tri.z))
        .add(texture(finish, q.zx.div(PLATE.tile)).zw.mul(tri.y)).toVar();
      const seam = applied.x.mul(plated), tone = applied.y.mul(2).sub(1).mul(plated);
      const color = vec3(tone.mul(APPLIED.tone).add(1)).toVar(), rough = tone.mul(APPLIED.sheen).add(1).toVar();
      If(amount.greaterThan(0), () => {
        const blotch = texture(plate, q.zy.div(PLATE.tile)).w.mul(tri.x).add(texture(plate, q.xy.div(PLATE.tile)).w.mul(tri.z))
          .add(texture(plate, q.zx.div(PLATE.tile)).w.mul(tri.y)).mul(2).sub(1).toVar();
        // Broad patches that never repeat keep the 16 m tile from showing along a hull.
        const broad = mx_noise_float(q.div(7));
        color.mulAssign(amount.mul(WEAR.mottle).mul(blotch.mul(.75).add(broad.mul(.45))).add(1));
        // Runoff hangs from edges: along the length on beam-facing walls, across it on end walls. A slow stretch of the
        // tile (±25 %) keeps a long hull side from repeating it every 16 m.
        const ax = pow(abs(m.x), 4), az = pow(abs(m.z), 4), beam = ax.div(ax.add(az).add(1e-4)), vertical = abs(m.y).lessThan(.62);
        const stretched = (h: Node<'float'>) => h.add(h.mul(.09).sin().mul(1.5)).add(h.mul(.23).add(1.3).sin().mul(.5)).div(STREAK.along);
        // Hat weights over the presets' channels, fading in from no wear.
        const weights = (wear: Node<'float'>) => float(1).sub(abs(vec4(...WEAR_LEVELS).sub(wear)).div(.3)).clamp(0, 1).mul(amount.mul(10).min(1));
        const levels = weights(amount).toVar();
        // The share of paint no runoff reaches.
        const clear = float(1).toVar(), drop = worn.y, tide = worn.w;
        If(vertical.and(drop.lessThan(STREAK.down)), () => {
          const v = drop.div(STREAK.down);
          clear.assign(dot(mix(texture(streaks, vec2(stretched(q.x), v)), texture(streaks, vec2(stretched(q.z), v)), beam), levels).oneMinus());
        });
        // Every strake seam below a wall's top edge and above the sea leaks a shorter, closer-set fringe of its own,
        // some seams more than others.
        const seamAbove = q.y.div(PLATE.strake).ceil(), seamDrop = seamAbove.mul(PLATE.strake).sub(q.y);
        If(vertical.and(plated.greaterThan(0)).and(seamDrop.lessThan(drop.sub(.05))).and(tide.greaterThan(.3)), () => {
          const leak = seamAbove.mul(12.9898).sin().mul(43758.5453).fract(), v = seamDrop.mul(APPLIED.seamRun / STREAK.down);
          // Explicit gradients, since the seam index and its drop jump at every seam.
          const along = APPLIED.seamSpacing / STREAK.along, down = -APPLIED.seamRun / STREAK.down;
          const fringe = (h: Node<'float'>, hx: Node<'float'>, hy: Node<'float'>) => texture(streaks, vec2(stretched(h.add(leak.mul(STREAK.along))).mul(APPLIED.seamSpacing), v))
            .grad(vec2(hx.mul(along), dx.y.mul(down)), vec2(hy.mul(along), dy.y.mul(down)));
          const runoff = mix(fringe(q.x, dx.x, dy.x), fringe(q.z, dx.z, dy.z), beam);
          const share = leak.mul(1 - APPLIED.leakMin).add(APPLIED.leakMin);
          clear.mulAssign(dot(runoff, weights(amount.mul(APPLIED.seamWetter).min(1))).mul(share).mul(APPLIED.seamRunoff).min(1).oneMinus());
          // Grime gathers in a soft band just below the seam.
          clear.mulAssign(exp(seamDrop.div(-APPLIED.bandReach)).mul(amount.mul(APPLIED.band)).mul(share).oneMinus());
        });
        const cover = clear.oneMinus().mul(smoothstep(.62, .4, abs(m.y))).mul(amount.mul(WEAR.streak[1]).add(WEAR.streak[0]));
        color.mulAssign(mix(vec3(1), mix(vec3(...WEAR.grime), vec3(...WEAR.rust), smoothstep(.2, 1, amount)), cover));
        // Grime and rust dull the paint a little.
        rough.mulAssign(cover.mul(.2).add(1));
        If(abs(tide).lessThan(2), () => {
          // A narrow band just above the rest waterline, its edge wandering over a metre or so.
          const edge = mx_noise_float(vec3(q.z.div(1.2), q.x.div(1.2), 0)).mul(.07).add(mx_noise_float(vec3(q.z.div(.35), q.x.div(.35), 3)).mul(.03));
          const stain = exp(tide.sub(.08).sub(edge).div(amount.mul(.12).add(.2)).pow(2).negate());
          color.mulAssign(mix(vec3(1), vec3(...WEAR.tide), stain.mul(amount.mul(WEAR.stain).min(WEAR.stain))));
        });
        const funnel = worn.z;
        If(funnel.lessThan(6), () => {
          // Matte soot over the top metre or few of a funnel, its lower edge ragged.
          const reach = amount.mul(WEAR.sootReach[1]).add(WEAR.sootReach[0]);
          const soot = float(1).sub(smoothstep(reach.mul(.15), reach, funnel.sub(blotch.mul(reach).mul(.2)))).mul(amount.mul(WEAR.sootDarkness[1]).add(WEAR.sootDarkness[0]));
          color.mulAssign(mix(vec3(1), vec3(...WEAR.soot), soot));
          rough.mulAssign(soot.mul(.5).add(1));
        });
      });
      // Grime gathers in the seams, and rust bleeds from them as the paint wears.
      const seamTint = mix(vec3(...APPLIED.seamGrime), vec3(...APPLIED.seamRust), smoothstep(.3, 1, amount).mul(.8));
      color.mulAssign(mix(vec3(1), seamTint, seam.mul(amount.mul(APPLIED.seam[1]).add(APPLIED.seam[0])).min(1)));
      rough.mulAssign(seam.mul(APPLIED.seamRough).add(1));
      factor.assign(vec4(color, rough));
    });
    return factor;
  })();
  // A mapped colour keeps its alpha: the three wear channels widen with an alpha of one.
  const paintColor = materialColor.mul(wearing.rgb);
  const paintRoughness = plateRoughness.mul(wearing.w);

  return nodes = { plateNormal: perturbed(plating), paintColor, paintRoughness, plainRoughness, teak };
}

/** The shared teak drawn at a deck's plank size: the tile stretched to its plank width and butt length, its caulking darkened
 * for seams wider or narrower than the tile's (within half to one and a half times). */
function planked(planks: DeckPlanks): TeakNodes {
  const key = `${planks.width}|${planks.length}|${planks.seam}`, cached = teakNodes.get(key);
  if (cached) return cached;
  const { teak, plainRoughness } = shipSurfaceNodes(), p = positionGeometry, n = normalGeometry.normalize();
  const across = planks.width / TEAK.plank, along = planks.length / TEAK.butt, seam = Math.min(1.5, Math.max(.5, planks.seam / (TEAK.caulk * across)));
  // Teak in ship plan: x across the beam, z along the length; planks run fore and aft.
  const t = texture(teak, vec2(p.x.div(TEAK.across * across), p.z.div(TEAK.along * along)));
  const up = smoothstep(.55, .8, n.y);
  // Caulking contrast recedes once a texel of pitch is well under a pixel.
  const footprint = dFdx(p).length().max(dFdy(p).length());
  const seamFade = mix(float(1), float(.35), smoothstep(.012, .06, footprint));
  // Renormalised so the mean stays the stain at every fade.
  const caulk = t.y.mul(CAULK_DARKENING * seam).mul(seamFade), mean = seamFade.mul(seam * (1 - teakAlbedoRatio)).add(teakAlbedoRatio);
  const teakPattern = mix(float(1), t.x.mul(2).mul(caulk.oneMinus()).div(mean), up);
  // The tile's height gradients are per metre of the tile; stretched, they are shallower.
  const teakGradient = vec3(t.z.mul(2).sub(1).div(across), 0, t.w.mul(2).sub(1).div(along)).mul(TEAK.gradientScale).mul(up);
  const teakRoughness = plainRoughness.mul(t.y.mul(.1).add(t.x.sub(.5).mul(-.12)).mul(up).add(1));
  const made = { teakNormal: perturbed(teakGradient), teakRoughness, teakPattern };
  teakNodes.set(key, made);
  return made;
}

let enabled = true;

/** Assign (or remove) the detail nodes for a palette material. The mode lives in userData so
 * per-ship clones can be switched too. */
export function applyShipSurfaceDetail(material: THREE.MeshStandardNodeMaterial, mode: ShipSurfaceMode, on = enabled): void {
  material.userData.shipSurfaceMode = mode;
  const shared = shipSurfaceNodes();
  if (mode === 'teak') {
    const map = material.map, teak = planked(deckPlanks(material));
    // The planks come from the shared teak. A repeating map is a finish tile, so only its mean tone, the stain, is kept; a
    // whole-deck image keeps its markings; with no map the paint colour is the stain.
    const stain = !map ? vec3(1) : map.wrapS === THREE.RepeatWrapping ? texture(map).level(float(16)).rgb : texture(map).rgb;
    material.colorNode = on ? vec4(stain.mul(teak.teakPattern), float(1)) : null;
    material.normalNode = on ? teak.teakNormal : null;
    material.roughnessNode = on ? teak.teakRoughness : shared.plainRoughness;
  } else {
    material.colorNode = on ? shared.paintColor : null;
    material.normalNode = on && !material.normalMap ? shared.plateNormal : null;
    material.roughnessNode = on ? shared.paintRoughness : shared.plainRoughness;
  }
  material.needsUpdate = true;
}

/** Switch surface detail on every palette material under `root` (review and measurement). `refinish`
 * re-applies what the palette layers over the detail, such as the wet band. */
export function setShipSurfaceDetail(root: THREE.Object3D, on: boolean, refinish?: (material: THREE.MeshStandardNodeMaterial) => void): void {
  enabled = on;
  const seen = new Set<THREE.Material>();
  root.traverse(object => {
    const material = (object as THREE.Mesh).material;
    for (const m of Array.isArray(material) ? material : material ? [material] : []) {
      if (seen.has(m) || !(m instanceof THREE.MeshStandardNodeMaterial) || !m.userData.shipSurfaceMode) continue;
      seen.add(m); applyShipSurfaceDetail(m, m.userData.shipSurfaceMode, on); refinish?.(m);
    }
  });
}
