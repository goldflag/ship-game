import { DataTexture, LinearFilter, LinearMipmapLinearFilter, RepeatWrapping, RGBAFormat } from 'three/webgpu';

/** Texels per edge. */
export const FOAM_TEXELS = 256;

/** Integer hash to [0, 1): seeds and lattice indices only, no float inputs. */
function hash(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(seed, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Distance from (u, v) in [0, 1)² to the nearest feature point of a periodic `cells`² jittered grid, in cell units. */
function worley(u: number, v: number, cells: number, seed: number): number {
  const x = u * cells, y = v * cells, ix = Math.floor(x), iy = Math.floor(y);
  let nearest = 2;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const cx = ix + dx, cy = iy + dy, wx = (cx + cells) % cells, wy = (cy + cells) % cells;
    nearest = Math.min(nearest, Math.hypot(cx + hash(wx, wy, seed) - x, cy + hash(wx, wy, seed + 1) - y));
  }
  return nearest;
}

/** Smooth periodic value noise in [0, 1) on a `cellsU` × `cellsV` lattice. */
function value(u: number, v: number, cellsU: number, cellsV: number, seed: number): number {
  const x = u * cellsU, y = v * cellsV, ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const at = (i: number, j: number) => hash((i + cellsU) % cellsU, (j + cellsV) % cellsV, seed);
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

/** The ocean's one foam texture, generated at startup and tiling in both axes. Every channel is equalised.
 * Red: lace, the structure of thinning white water, bright filaments around holes at three scales (Worley F1).
 * Green: broad patches (fbm). Blue: streaks, ridged noise eight times finer across the texture than along it
 * (u), so its highest levels are thin lines like the foam the wind draws out; the surface lays u along the wind. */
export function foamTexture(): DataTexture {
  const n = FOAM_TEXELS, lace = new Float32Array(n * n), patches = new Float32Array(n * n), streaks = new Float32Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const u = (x + .5) / n, v = (y + .5) / n, i = y * n + x;
    lace[i] = .5 * worley(u, v, 5, 3) + .3 * worley(u, v, 13, 7) + .2 * worley(u, v, 32, 9);
    let broad = 0, ridges = 0, weight = .5;
    for (let octave = 0; octave < 4; octave++, weight *= .5) {
      broad += weight * value(u, v, 4 << octave, 4 << octave, 11 + octave);
      if (octave < 3) ridges += [.5, .3, .2][octave] * (1 - Math.abs(2 * value(u, v, 2 << octave, 16 << octave, 23 + octave) - 1));
    }
    patches[i] = broad; streaks[i] = ridges;
  }
  const pixels = new Uint8Array(n * n * 4);
  [equalize(lace), equalize(patches), equalize(streaks)].forEach((field, channel) => field.forEach((level, i) => { pixels[i * 4 + channel] = Math.round(level * 255); }));
  const map = new DataTexture(pixels, n, n, RGBAFormat);
  map.name = 'Ocean foam';
  map.wrapS = map.wrapT = RepeatWrapping;
  map.minFilter = LinearMipmapLinearFilter; map.magFilter = LinearFilter;
  map.generateMipmaps = true;
  map.anisotropy = 4;
  map.needsUpdate = true;
  return map;
}
