/** Smooth value noise laid on the world, never repeating: an integer hash of lattice indices (no float hash inputs),
 * interpolated with smoothstep weights. Every tiled pattern the ocean draws (wave cascades, the foam texture) repeats;
 * this is what varies them from one copy to the next. `noise` is the shader node, `noiseAt` its CPU twin. */
import type { Node } from 'three/webgpu';
import { float, floor, int, mix, uint } from 'three/tsl';

type Float = Node<'float'>;
type Int = Node<'int'>;

/** Integer hash to [0, 1) (the foam texture's). */
export function hashAt(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(seed, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Value noise at (x, y), in lattice cells, 0–1 (mean ½, standard deviation 0.214). */
export function noiseAt(x: number, y: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const top = hashAt(ix, iy, seed) + (hashAt(ix + 1, iy, seed) - hashAt(ix, iy, seed)) * sx;
  const bottom = hashAt(ix, iy + 1, seed) + (hashAt(ix + 1, iy + 1, seed) - hashAt(ix, iy + 1, seed)) * sx;
  return top + (bottom - top) * sy;
}

function hash(x: Int, y: Int, seed: number): Float {
  const h0 = uint(x).mul(uint(0x27d4eb2d)).bitXor(uint(y).mul(uint(0x165667b1))).bitXor(uint(Math.imul(seed, 0x9e3779b9) >>> 0)).toVar();
  const h1 = h0.bitXor(h0.shiftRight(uint(15))).mul(uint(0x85ebca6b)).toVar();
  const h2 = h1.bitXor(h1.shiftRight(uint(13))).mul(uint(0xc2b2ae35)).toVar();
  return float(h2.bitXor(h2.shiftRight(uint(16)))).mul(1 / 4294967296);
}

/** Value noise at `p`, in lattice cells, 0–1: `noiseAt` on the GPU. */
export function noise(p: Node<'vec2'>, seed: number): Float {
  const cell = floor(p), f = p.sub(cell), s = f.mul(f).mul(f.mul(-2).add(3));
  const x = int(cell.x).toVar(), y = int(cell.y).toVar(), x1 = x.add(1), y1 = y.add(1);
  return mix(mix(hash(x, y, seed), hash(x1, y, seed), s.x), mix(hash(x, y1, seed), hash(x1, y1, seed), s.x), s.y);
}
