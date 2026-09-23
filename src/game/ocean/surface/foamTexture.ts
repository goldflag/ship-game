import { DataTexture, LinearFilter, LinearMipmapLinearFilter, RepeatWrapping, RGFormat } from 'three/webgpu';

const SIZE = 256;

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

/** Smooth periodic value noise in [0, 1). */
function value(u: number, v: number, cells: number, seed: number): number {
  const x = u * cells, y = v * cells, ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const at = (i: number, j: number) => hash((i + cells) % cells, (j + cells) % cells, seed);
  const top = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * sx, bottom = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * sx;
  return top + (bottom - top) * sy;
}

/** The ocean's one foam texture, generated at startup and tiling in both axes: red holds bubble
 * clusters (two Worley scales), green holds broad patches (fbm). Every foam kind reads it. */
export function foamTexture(): DataTexture {
  const bubbles = new Float32Array(SIZE * SIZE), patches = new Float32Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const u = (x + .5) / SIZE, v = (y + .5) / SIZE, i = y * SIZE + x;
    bubbles[i] = 1 - .6 * worley(u, v, 9, 3) - .4 * worley(u, v, 23, 7);
    let sum = 0, weight = .5;
    for (let octave = 0; octave < 4; octave++, weight *= .5) sum += weight * value(u, v, 4 << octave, 11 + octave);
    patches[i] = sum;
  }
  const pixels = new Uint8Array(SIZE * SIZE * 2);
  for (const [channel, field] of [bubbles, patches].entries()) {
    let low = Infinity, high = -Infinity;
    for (const n of field) { low = Math.min(low, n); high = Math.max(high, n); }
    field.forEach((n, i) => { pixels[i * 2 + channel] = Math.round((n - low) / (high - low) * 255); });
  }
  const map = new DataTexture(pixels, SIZE, SIZE, RGFormat);
  map.name = 'Ocean foam';
  map.wrapS = map.wrapT = RepeatWrapping;
  map.minFilter = LinearMipmapLinearFilter; map.magFilter = LinearFilter;
  map.generateMipmaps = true;
  map.anisotropy = 4;
  map.needsUpdate = true;
  return map;
}
