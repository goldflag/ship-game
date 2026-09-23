/** TEMPORARY STUB, replaced by `waves/index.ts` at integration: a handful of Gerstner waves
 * behind the `WaveField` contract so the facade, surface and game run before the FFT field
 * lands. Heights are normalised to `significantHeight` (4σ of a sum of sinusoids) and the
 * height sampler evaluates the same waves on the CPU. */
import { Vector4, type Node } from 'three/webgpu';
import { cos, float, fwidth, max, sin, smoothstep, uniform, uniformArray, vec2, vec3 } from 'three/tsl';
import type { CreateWaveField, CreateWaveHeightSampler, WaveField, WaveFoamParameters, WaveParameters, WaveSurfaceSample } from '../contracts';

/** Wavelength as a share of the peak, heading off the wind (radians at sharpness 1), relative amplitude. */
const SHAPE = [[1, 0, 1], [.74, .38, .7], [.56, -.44, .55], [.41, .72, .38], [.3, -.8, .27], [.22, 1.05, .18], [.16, -1.2, .12], [.11, .2, .08]] as const;
const GRAVITY = 9.81;

interface Wave { dx: number; dz: number; k: number; amplitude: number; omega: number; phase: number; chop: number }

/** Integer hash to [0, 1): no float inputs, so every seed is safe. */
function unit(seed: number, index: number): number {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(index + 1, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

function waveSet(params: WaveParameters): Wave[] {
  const scale = params.significantHeight / (4 * Math.sqrt(SHAPE.reduce((sum, [, , a]) => sum + a * a / 2, 0)));
  const spread = 1 / Math.max(.2, params.directionalSharpness);
  const waves = SHAPE.map(([length, heading, relative], i) => {
    const k = 2 * Math.PI / Math.max(.5, params.peakWavelength * length), angle = params.windDirection + heading * spread;
    return { dx: Math.cos(angle), dz: Math.sin(angle), k, amplitude: relative * scale, omega: Math.sqrt(GRAVITY * k), phase: unit(params.seed, i) * 2 * Math.PI, chop: 0 };
  });
  // Keep the horizontal displacement from folding the surface into loops.
  const steepness = waves.reduce((sum, w) => sum + w.k * w.amplitude, 0);
  const chop = Math.min(Math.max(0, params.choppiness), steepness > 0 ? .9 / steepness : 0);
  waves.forEach(w => { w.chop = chop; });
  return waves;
}

/** The stub's own field: the contract plus the CPU wave table and clock its height sampler reads. */
class GerstnerField implements WaveField {
  readonly cascades;
  maxHeight = 0;
  maxHorizontalDisplacement = 0;
  waves: Wave[] = [];
  time = 0;
  private readonly clock = uniform(0);
  private readonly shape = uniformArray<'vec4'>(SHAPE.map(() => new Vector4()), 'vec4');
  private readonly motion = uniformArray<'vec4'>(SHAPE.map(() => new Vector4()), 'vec4');
  private readonly calmVariance = uniform(0);

  constructor(cascades: WaveField['cascades'], readonly params: WaveParameters, readonly foamParams: WaveFoamParameters) {
    this.cascades = cascades;
    this.rebuild();
  }

  private rebuild(): void {
    this.waves = waveSet(this.params);
    this.waves.forEach((w, i) => {
      (this.shape.array[i] as Vector4).set(w.dx, w.dz, w.k, w.amplitude);
      (this.motion.array[i] as Vector4).set(w.omega, w.phase, w.chop, 2 * Math.PI / w.k);
    });
    this.maxHeight = this.waves.reduce((sum, w) => sum + w.amplitude, 0);
    this.maxHorizontalDisplacement = this.waves.reduce((sum, w) => sum + w.chop * w.amplitude, 0);
    // The slope variance an FFT field leaves below its finest texel: a small, wind-driven capillary tail.
    this.calmVariance.value = .002 + .0003 * this.params.windSpeed;
    this.params.dirty = false;
  }

  /** Phase, sine and cosine of wave `i` at grid point `xz`. */
  private wave(i: number, xz: Node<'vec2'>) {
    const shape = this.shape.element(i), motion = this.motion.element(i);
    const theta = shape.z.mul(shape.x.mul(xz.x).add(shape.y.mul(xz.y))).sub(motion.x.mul(this.clock)).add(motion.y);
    return { shape, motion, s: sin(theta), c: cos(theta) };
  }

  displacement(xz: Node<'vec2'>, spacing?: Node<'float'>): Node<'vec3'> {
    let sum: Node<'vec3'> = vec3(0);
    for (let i = 0; i < SHAPE.length; i++) {
      const { shape, motion, s, c } = this.wave(i, xz);
      const fade = spacing ? float(1).sub(smoothstep(motion.w.mul(.25), motion.w.mul(.5), spacing)) : float(1);
      const across = shape.w.mul(motion.z).mul(c);
      sum = sum.add(vec3(shape.x.mul(across), shape.w.mul(s), shape.y.mul(across)).mul(fade));
    }
    return sum;
  }

  surface(xz: Node<'vec2'>): WaveSurfaceSample {
    const footprint = max(fwidth(xz.x), fwidth(xz.y));
    let slope: Node<'vec2'> = vec2(0), lift: Node<'float'> = float(1), variance: Node<'float'> = this.calmVariance;
    let xx: Node<'float'> = float(1), zz: Node<'float'> = float(1), cross: Node<'float'> = float(0);
    for (let i = 0; i < SHAPE.length; i++) {
      const { shape, motion, s, c } = this.wave(i, xz);
      // Waves finer than about three pixels become roughness instead of aliased slope.
      const resolved = float(1).sub(smoothstep(motion.w.mul(.15), motion.w.mul(.5), footprint));
      const ka = shape.z.mul(shape.w), fold = motion.z.mul(ka).mul(s);
      slope = slope.add(shape.xy.mul(ka.mul(c).mul(resolved)));
      lift = lift.sub(fold.mul(resolved));
      variance = variance.add(float(1).sub(resolved).mul(ka.mul(ka).mul(.5)));
      xx = xx.sub(fold.mul(shape.x.mul(shape.x)));
      zz = zz.sub(fold.mul(shape.y.mul(shape.y)));
      cross = cross.sub(fold.mul(shape.x.mul(shape.y)));
    }
    const jacobian = xx.mul(zz).sub(cross.mul(cross));
    const foam = float(1).sub(smoothstep(.35, .75, jacobian)).mul(this.foamParams.crestStrength);
    return { slope: slope.div(lift.max(.2)), jacobian, foam, slopeVariance: variance };
  }

  heightAt(xz: Node<'vec2'>): Node<'float'> {
    let grid: Node<'vec2'> = xz;
    for (let step = 0; step < 3; step++) grid = xz.sub(this.displacement(grid).xz);
    return this.displacement(grid).y;
  }

  update(_renderer: unknown, time: number): void {
    if (this.params.dirty) this.rebuild();
    this.time = time;
    this.clock.value = time;
  }

  dispose(): void {}
}

export const createWaveField: CreateWaveField = (_renderer, cascades, params, foam) => new GerstnerField(cascades, params, foam);

/** CPU evaluation of the stub's waves, current as soon as it is requested. */
export const createWaveHeightSampler: CreateWaveHeightSampler = (_renderer, field) => {
  const source = field as GerstnerField;
  let points: readonly { x: number; z: number }[] = [];
  const sampler = {
    heights: new Float32Array(0),
    normals: new Float32Array(0),
    setPositions(next: readonly { x: number; z: number }[]) {
      points = next.map(p => ({ x: p.x, z: p.z }));
      sampler.heights = new Float32Array(points.length).fill(NaN);
      sampler.normals = new Float32Array(points.length * 3);
    },
    request() {
      points.forEach((point, i) => {
        let x = point.x, z = point.z;
        for (let step = 0; step < 3; step++) {
          let ox = 0, oz = 0;
          for (const w of source.waves) {
            const c = Math.cos(w.k * (w.dx * x + w.dz * z) - w.omega * source.time + w.phase) * w.chop * w.amplitude;
            ox += w.dx * c; oz += w.dz * c;
          }
          x = point.x - ox; z = point.z - oz;
        }
        let y = 0, sx = 0, sz = 0;
        for (const w of source.waves) {
          const theta = w.k * (w.dx * x + w.dz * z) - w.omega * source.time + w.phase;
          y += w.amplitude * Math.sin(theta);
          sx += w.dx * w.k * w.amplitude * Math.cos(theta); sz += w.dz * w.k * w.amplitude * Math.cos(theta);
        }
        const length = Math.hypot(sx, 1, sz);
        sampler.heights[i] = y;
        sampler.normals.set([-sx / length, 1 / length, -sz / length], i * 3);
      });
    },
    async refresh() { sampler.request(); },
    dispose() {},
  };
  return sampler;
};
