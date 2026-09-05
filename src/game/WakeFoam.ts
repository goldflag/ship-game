import { DataTexture, LinearFilter, RedFormat, Vector2, type Node } from 'three/webgpu';
import { Fn, If, float, mx_noise_float, smoothstep, texture, uniform, vec2, vec3 } from 'three/tsl';
import { BISMARCK, type ShipState } from '../simulation/ship';

type Motion = Pick<ShipState, 'x' | 'z' | 'heading' | 'speed'>;
type WakeSample = Motion & { born: number; strength: number };

const EXTENT = 1536;
const LIFETIME = 55;
const SAMPLE_DISTANCE = 3;
const UPDATE_INTERVAL = 1 / 20;
const smooth = (value: number) => {
  const t = Math.max(0, Math.min(value, 1));
  return t * t * (3 - 2 * t);
};

/** World-space foam footprints, shaded on the displaced water itself.
 * Samples remember the heading at emission, so old water never turns with the hull.
 * The small scalar texture stores coverage; the water shader supplies the bubbles.
 */
export class WakeFoam {
  readonly texture: DataTexture;
  private readonly pixels: Uint8Array;
  private readonly origin = uniform(new Vector2());
  private readonly time = uniform(0);
  private readonly field;
  private readonly samples: WakeSample[] = [];
  private previous?: Motion;
  private sampleDistance = 0;
  private elapsed = 0;
  private dirty = false;

  constructor(private readonly resolution: number) {
    this.pixels = new Uint8Array(resolution * resolution);
    this.texture = new DataTexture(this.pixels, resolution, resolution, RedFormat);
    this.texture.minFilter = this.texture.magFilter = LinearFilter;
    this.texture.generateMipmaps = false;
    this.texture.needsUpdate = true;
    this.field = texture(this.texture);
  }

  sample(worldX: Node<'float'>, worldZ: Node<'float'>): Node<'float'> {
    const world = vec2(worldX, worldZ);
    const uv = world.sub(this.origin).div(EXTENT).add(0.5);
    return Fn(() => {
      const energy = float(0).toVar();
      // Keep the turbulence work local to disturbed water, including when the
      // ship is stopped and most of the viewport contains no wake at all.
      If(this.field.sample(uv).r.greaterThan(0.01), () => {
        // Two scales of world-anchored eddies create irregular gaps, rather
        // than repeating a row of identical foam stamps. Pause freezes both.
        const noise = mx_noise_float(vec3(world.mul(0.075), this.time.mul(0.07)));
        const eddies = mx_noise_float(vec3(world.mul(0.028).add(17), this.time.mul(0.045)));
        const drift = vec2(noise, eddies).mul(5);
        const edge = smoothstep(0, 0.025, uv.x).mul(float(1).sub(smoothstep(0.975, 1, uv.x)))
          .mul(smoothstep(0, 0.025, uv.y)).mul(float(1).sub(smoothstep(0.975, 1, uv.y)));
        const breakup = noise.mul(0.4).add(eddies.mul(0.75)).add(0.72).clamp(0.2, 1);
        energy.assign(this.field.sample(uv.add(drift.div(EXTENT))).r.mul(breakup).mul(edge));
      });
      return energy;
    })();
  }

  update(state: Motion, dt: number): void {
    if (dt <= 0) return;
    this.time.value += dt;
    this.elapsed += dt;
    const previous = this.previous;
    const distance = previous ? Math.hypot(state.x - previous.x, state.z - previous.z) : 0;
    if (distance > 100) this.reset();
    else if (previous && distance > 0.0001 && Math.abs(state.speed) > 0.15) {
      // Distance-based sampling plus interpolated birth times makes the trail
      // equally dense at low and high frame rates, including during turns.
      const headingDelta = Math.atan2(Math.sin(state.heading - previous.heading), Math.cos(state.heading - previous.heading));
      for (let along = SAMPLE_DISTANCE - this.sampleDistance; along <= distance; along += SAMPLE_DISTANCE) {
        const fraction = along / distance;
        const speed = previous.speed + (state.speed - previous.speed) * fraction;
        this.samples.push({
          x: previous.x + (state.x - previous.x) * fraction,
          z: previous.z + (state.z - previous.z) * fraction,
          heading: previous.heading + headingDelta * fraction,
          speed,
          strength: smooth(Math.abs(speed) / BISMARCK.forwardSpeed) ** 0.65,
          born: this.time.value - dt * (1 - fraction),
        });
        this.dirty = true;
      }
      this.sampleDistance = (this.sampleDistance + distance) % SAMPLE_DISTANCE;
    }
    this.previous = { ...state };
    while (this.samples.length && this.time.value - this.samples[0].born > LIFETIME) this.samples.shift();
    if (this.elapsed < UPDATE_INTERVAL || (!this.samples.length && !this.dirty)) return;
    this.elapsed %= UPDATE_INTERVAL;
    this.rasterize(state);
    this.dirty = this.samples.length > 0;
  }

  reset(): void {
    this.samples.length = 0;
    this.previous = undefined;
    this.sampleDistance = 0;
    this.pixels.fill(0);
    this.texture.needsUpdate = true;
    this.dirty = false;
  }

  private rasterize(state: Motion): void {
    const cell = EXTENT / this.resolution;
    this.origin.value.set(Math.round(state.x / cell) * cell, Math.round(state.z / cell) * cell);
    this.pixels.fill(0);
    for (const sample of this.samples) {
      const age = this.time.value - sample.born;
      const forwardX = Math.sin(sample.heading), forwardZ = -Math.cos(sample.heading);
      const rightX = -forwardZ, rightZ = forwardX;
      const aft = sample.speed >= 0 ? 117 : -117;
      const sternX = sample.x - forwardX * aft, sternZ = sample.z - forwardZ * aft;
      const fade = Math.exp(-age / 23) * (1 - smooth((age - 38) / 17));
      const eddy = Math.sin(sample.born * 1.7 + age * 0.23) * Math.min(age * 0.22, 3.5);
      const spread = 7 + Math.sqrt(age) * 2.5 + age * 0.24;
      const length = 5 + Math.sqrt(age) * 1.25;
      // The three propeller streams merge into one widening, aerated trail.
      // Overlapping footprints use max coverage, so emission frequency never
      // builds an opaque stripe. Older foam loses density as its area grows.
      for (const shaft of [-1, 0, 1]) {
        const offset = shaft * (5.5 + Math.min(age * 0.16, 4)) + eddy;
        this.stamp(sternX + rightX * offset, sternZ + rightZ * offset,
          rightX, rightZ, spread, length,
          sample.strength * fade * (shaft === 0 ? 1 : 0.84));
      }
      // Bow shoulders spread away from the historical course; only their
      // youngest crests carry white water. The native solver carries the swell.
      const shoulder = 7 + age * Math.abs(sample.speed) * 0.32;
      const bowX = sample.x + forwardX * aft, bowZ = sample.z + forwardZ * aft;
      const crest = sample.strength * Math.exp(-age / 9) * 0.8;
      for (const side of [-1, 1]) {
        this.stamp(bowX + rightX * shoulder * side, bowZ + rightZ * shoulder * side,
          rightX, rightZ, 4 + age * 0.35, length, crest);
      }
    }
    this.texture.needsUpdate = true;
  }

  private stamp(x: number, z: number, rightX: number, rightZ: number,
    width: number, length: number, strength: number): void {
    if (strength < 0.015) return;
    const scale = this.resolution / EXTENT;
    const cx = (x - this.origin.value.x) * scale + this.resolution / 2 - 0.5;
    const cz = (z - this.origin.value.y) * scale + this.resolution / 2 - 0.5;
    const rx = (Math.abs(rightX) * width + Math.abs(rightZ) * length) * scale;
    const rz = (Math.abs(rightZ) * width + Math.abs(rightX) * length) * scale;
    const minX = Math.max(0, Math.floor(cx - rx)), maxX = Math.min(this.resolution - 1, Math.ceil(cx + rx));
    const minZ = Math.max(0, Math.floor(cz - rz)), maxZ = Math.min(this.resolution - 1, Math.ceil(cz + rz));
    for (let iz = minZ; iz <= maxZ; iz++) {
      for (let ix = minX; ix <= maxX; ix++) {
        const dx = (ix - cx) / scale, dz = (iz - cz) / scale;
        const cross = (dx * rightX + dz * rightZ) / width;
        const along = (-dx * rightZ + dz * rightX) / length;
        const radius = cross * cross + along * along;
        if (radius >= 1) continue;
        const coverage = strength * (1 - smooth(radius)) * 255;
        const index = iz * this.resolution + ix;
        this.pixels[index] = Math.max(this.pixels[index], Math.round(coverage));
      }
    }
  }

  dispose(): void { this.texture.dispose(); }
}
