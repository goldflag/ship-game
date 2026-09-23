import { LinearFilter, RepeatWrapping, Storage3DTexture, type Node, type WebGPURenderer } from 'three/webgpu';
import { Fn, Loop, dot, float, floor, fract, hash, instanceIndex, int, max, min, mix, mod, normalize, sqrt, textureStore, uvec3, vec3, vec4 } from 'three/tsl';

/** Texels per edge of the base shape volume and of the detail volume. */
export const BASE_VOLUME = 128, DETAIL_VOLUME = 32;

type Float = Node<'float'>;
type Vec3 = Node<'vec3'>;

/** Three hashes in [0, 1) of an integer lattice point (as float coordinates, below 2²⁴ in total). */
function hash3(cell: Vec3, period: number, seed: number): Vec3 {
  const n = cell.x.add(cell.y.mul(period)).add(cell.z.mul(period * period)).mul(3).add(seed * 1_000_003 % 4_000_000);
  return vec3(hash(n), hash(n.add(1)), hash(n.add(2)));
}

/** Tiling Worley F1 "billow" (1 at a feature point, 0 a cell or more away) at `p` in [0, 1)³, `cells` per repeat. */
function billow(p: Vec3, cells: number, seed: number): Float {
  return Fn(() => {
    const q = p.mul(cells), cell = floor(q), f = fract(q);
    const nearest = float(9).toVar();
    Loop({ start: int(0), end: int(27), type: 'int' }, ({ i }) => {
      const offset = vec3(float(i.mod(3)), float(i.div(3).mod(3)), float(i.div(9))).sub(1);
      const point = offset.add(hash3(mod(cell.add(offset).add(cells), cells), cells, seed)).sub(f);
      nearest.assign(min(nearest, dot(point, point)));
    });
    return max(float(1).sub(sqrt(nearest)), 0);
  })();
}

/** Tiling gradient noise (Perlin, quintic fade), about −1 … 1, at `p` in [0, 1)³ with `period` lattice cells per repeat. */
function gradient(p: Vec3, period: number, seed: number): Float {
  const q = p.mul(period), cell = floor(q), f = fract(q);
  const corner = (x: number, y: number, z: number) => {
    const g = normalize(hash3(mod(cell.add(vec3(x, y, z)), period), period, seed).mul(2).sub(1));
    return dot(g, f.sub(vec3(x, y, z)));
  };
  const s = f.mul(f).mul(f).mul(f.mul(f.mul(6).sub(15)).add(10));
  const x00 = mix(corner(0, 0, 0), corner(1, 0, 0), s.x), x10 = mix(corner(0, 1, 0), corner(1, 1, 0), s.x);
  const x01 = mix(corner(0, 0, 1), corner(1, 0, 1), s.x), x11 = mix(corner(0, 1, 1), corner(1, 1, 1), s.x);
  return mix(mix(x00, x10, s.y), mix(x01, x11, s.y), s.z).mul(1.6);
}

/** A tiling RGBA8 volume the GPU fills once: `texel` maps a point of [0, 1)³ to its four channels. The
 * kernel is disposed with the volume. */
function volume(renderer: WebGPURenderer, size: number, name: string, texel: (p: Vec3) => Node<'vec4'>): GeneratedVolume {
  const map = new Storage3DTexture(size, size, size);
  map.name = name;
  map.wrapS = map.wrapT = map.wrapR = RepeatWrapping;
  map.minFilter = map.magFilter = LinearFilter;
  map.generateMipmaps = false;
  const kernel = Fn(() => {
    const i = instanceIndex, x = i.mod(size), y = i.div(size).mod(size), z = i.div(size * size);
    textureStore(map, uvec3(x, y, z), texel(vec3(float(x), float(y), float(z)).add(.5).div(size)));
  })().compute(size * size * size);
  renderer.compute(kernel);
  return { map, dispose() { kernel.dispose(); map.dispose(); } };
}

export interface GeneratedVolume { readonly map: Storage3DTexture; dispose(): void }

/** The base shape volume (after Schneider & Vos 2015): R, gradient noise dilated by Worley billows (high
 * wherever either is), so shapes connect like Perlin noise but swell into round cumulus lobes, and a full
 * cover reads as a solid, lumpy deck rather than a sieve; G, B, A, billows at doubling frequencies that the
 * density function erodes the shape with. */
export function baseVolume(renderer: WebGPURenderer): GeneratedVolume {
  return volume(renderer, BASE_VOLUME, 'Cloud base shape', p => {
    const perlin = gradient(p, 4, 1).add(gradient(p, 8, 2).mul(.5)).add(gradient(p, 16, 3).mul(.25)).mul(.5).add(.5).clamp(0, 1);
    const cells = billow(p, 4, 4).mul(.625).add(billow(p, 8, 5).mul(.25)).add(billow(p, 16, 6).mul(.125));
    // The union sits in 0.55–0.9 for nine points in ten; stretched to fill the byte.
    const shape = cells.add(perlin.mul(cells.oneMinus())).sub(.5).div(.45).clamp(0, 1);
    return vec4(shape, billow(p, 8, 7), billow(p, 16, 8), billow(p, 32, 9));
  });
}

/** The detail volume: billows at three doubling frequencies (RGB), eroding cloud edges into cauliflower
 * lobes, and gradient noise (A) that bends the erosion so it never lines up with the lattice. */
export function detailVolume(renderer: WebGPURenderer): GeneratedVolume {
  return volume(renderer, DETAIL_VOLUME, 'Cloud detail', p => vec4(billow(p, 2, 11), billow(p, 4, 12), billow(p, 8, 13), gradient(p, 4, 14).mul(.5).add(.5)));
}
