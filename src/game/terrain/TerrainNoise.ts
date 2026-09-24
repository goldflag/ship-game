/** A tileable noise tile the terrain shader samples at several scales, built once per page on the CPU:
 * - R: fractal value noise (five octaves), mean about 0.5;
 * - G: distance to the nearest Worley feature point (`WORLEY_CELLS`² jittered points), 0 at a point and 1 half a
 *   cell or more away: a tree crown's dome, a field's centre;
 * - B: F2 − F1, the Worley distance to the second nearest point less the nearest, 0 on a boundary between two
 *   cells: hedgerows, crown gaps, field edges;
 * - A: a random value per Worley cell, the same over the cell: a field's crop, a crown's shade.
 * Deterministic, so every run and every machine draws the same land. */

export const NOISE_SIZE = 512;
/** Worley cells along a side of the tile. */
export const WORLEY_CELLS = 16;

let cached: Uint8Array | undefined;

function hash(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(seed, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Value noise with period `period` lattice cells, at (x, y) in lattice units. */
function valueNoise(x: number, y: number, period: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const x0 = ((ix % period) + period) % period, y0 = ((iy % period) + period) % period;
  const x1 = (x0 + 1) % period, y1 = (y0 + 1) % period;
  const a = hash(x0, y0, seed), b = hash(x1, y0, seed), c = hash(x0, y1, seed), d = hash(x1, y1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** The tile's RGBA bytes, `NOISE_SIZE`² texels, row-major. */
export function terrainNoise(): Uint8Array {
  if (cached) return cached;
  const size = NOISE_SIZE, out = new Uint8Array(size * size * 4);
  // Feature points: one per Worley cell, jittered within it.
  const points = new Float32Array(WORLEY_CELLS * WORLEY_CELLS * 2);
  for (let j = 0; j < WORLEY_CELLS; j++) for (let i = 0; i < WORLEY_CELLS; i++) {
    points[(j * WORLEY_CELLS + i) * 2] = .1 + .8 * hash(i, j, 11);
    points[(j * WORLEY_CELLS + i) * 2 + 1] = .1 + .8 * hash(i, j, 12);
  }
  const cellTexels = size / WORLEY_CELLS;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let fbm = 0, amplitude = .5, total = 0;
    for (let octave = 0; octave < 5; octave++) {
      const period = 8 << octave;
      fbm += valueNoise(x / size * period, y / size * period, period, octave + 1) * amplitude;
      total += amplitude; amplitude *= .5;
    }
    fbm /= total;
    const cx = x / cellTexels, cy = y / cellTexels, ix = Math.floor(cx), iy = Math.floor(cy);
    let f1 = Infinity, f2 = Infinity, owner = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = ix + dx, ny = iy + dy;
      const wx = ((nx % WORLEY_CELLS) + WORLEY_CELLS) % WORLEY_CELLS, wy = ((ny % WORLEY_CELLS) + WORLEY_CELLS) % WORLEY_CELLS;
      const px = nx + points[(wy * WORLEY_CELLS + wx) * 2], py = ny + points[(wy * WORLEY_CELLS + wx) * 2 + 1];
      const distance = Math.hypot(px - cx, py - cy);
      if (distance < f1) { f2 = f1; f1 = distance; owner = wy * WORLEY_CELLS + wx; }
      else if (distance < f2) f2 = distance;
    }
    const at = (y * size + x) * 4;
    // Stretch the value noise's narrow middle-heavy spread to use the byte range.
    out[at] = Math.max(0, Math.min(255, Math.round((.5 + (fbm - .5) * 1.8) * 255)));
    out[at + 1] = Math.min(255, Math.round(Math.min(f1 / .5, 1) * 255));
    out[at + 2] = Math.min(255, Math.round(Math.min((f2 - f1) / .5, 1) * 255));
    out[at + 3] = Math.round(hash(owner, 7, 13) * 255);
  }
  return cached = out;
}
