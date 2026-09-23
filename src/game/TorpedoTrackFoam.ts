import { DataTexture, LinearFilter, RedFormat, Vector2, Vector3, type Camera, type Node, type Texture, type WebGPURenderer } from 'three/webgpu';
import { Fn, If, float, mx_noise_float, smoothstep, texture, uniform, vec2, vec3 } from 'three/tsl';
import { WAKE_EXTENT, rasterizeStamp } from './WakeFoam';
import { WakeFoamGpu, WakeStampCollector } from './WakeFoamGpu';
import type { Torpedo } from './torpedoAim';

type TrackTorpedo = Pick<Torpedo, 'id' | 'position' | 'velocity'>;
type TrackSample = { x: number; z: number; rightX: number; rightZ: number; surfaced: number; strength: number; phase: number };

const SAMPLE_DISTANCE = 4;
const LIFETIME = 30;
const UPDATE_INTERVAL = 1 / 20;
/** Exhaust rises as a loose plume, faster than a lone bubble. */
const RISE_SPEED = 1.5;
const smooth = (value: number) => {
  const t = Math.max(0, Math.min(value, 1));
  return t * t * (3 - 2 * t);
};

/** Bubble tracks left on the displaced ocean surface by running torpedoes.
 * Exhaust released at running depth takes seconds to surface, so the track
 * begins well astern of the round, stays where it was laid and outlives it.
 * One fine field follows the view, since a track is narrower than a fleet wake cell. */
export class TorpedoTrackFoam {
  readonly texture: Texture;
  private readonly origin = uniform(new Vector2());
  private readonly time = uniform(0);
  private readonly field;
  private readonly pixels: Uint8Array;
  private readonly gpu?: WakeFoamGpu;
  private readonly collector = new WakeStampCollector();
  private readonly running = new Map<number, { x: number; z: number; carry: number }>();
  private readonly forward = new Vector3();
  private samples: TrackSample[] = [];
  private elapsed = 0;
  private painted = false;

  constructor(private readonly resolution: number, renderer?: WebGPURenderer) {
    if ((renderer?.backend as { isWebGPUBackend?: boolean } | undefined)?.isWebGPUBackend) this.gpu = new WakeFoamGpu(renderer!, resolution, 1);
    this.pixels = new Uint8Array(this.gpu ? 0 : resolution * resolution);
    this.texture = this.gpu?.target.texture ?? new DataTexture(this.pixels, resolution, resolution, RedFormat);
    this.texture.minFilter = this.texture.magFilter = LinearFilter;
    this.texture.generateMipmaps = false;
    this.texture.needsUpdate = true;
    this.field = texture(this.texture);
  }

  get center(): Readonly<Vector2> { return this.origin.value; }

  sample(x: Node<'float'>, z: Node<'float'>): Node<'float'> {
    const world = vec2(x, z);
    const uv = world.sub(this.origin).div(WAKE_EXTENT).add(.5);
    return Fn(() => {
      const energy = float(0).toVar();
      If(uv.x.greaterThan(0).and(uv.x.lessThan(1)).and(uv.y.greaterThan(0)).and(uv.y.lessThan(1)), () => {
        const sampled = this.field.sample(uv);
        // The texture matrix is identity: skip its uniform and multiply on every read.
        sampled.updateMatrix = false;
        const coverage = sampled.r;
        If(coverage.greaterThan(.01), () => {
          // Metre-scale clumps: a track is a string of bubble patches, not a painted line.
          const clumps = mx_noise_float(vec3(world.mul(.32), this.time.mul(.12)));
          const patches = mx_noise_float(vec3(world.mul(.09).add(31), this.time.mul(.05)));
          const edge = smoothstep(0, .03, uv.x).mul(float(1).sub(smoothstep(.97, 1, uv.x)))
            .mul(smoothstep(0, .03, uv.y)).mul(float(1).sub(smoothstep(.97, 1, uv.y)));
          energy.assign(coverage.mul(clumps.mul(.55).add(patches.mul(.5)).add(.74).clamp(.3, 1)).mul(edge));
        });
      });
      return energy;
    })();
  }

  update(torpedoes: readonly TrackTorpedo[], dt: number, focusX: number, focusZ: number, camera?: Camera): void {
    if (dt <= 0) return;
    this.time.value += dt; this.elapsed += dt;
    const now = this.time.value;
    for (const id of this.running.keys()) if (!torpedoes.some(t => t.id === id)) this.running.delete(id);
    for (const t of torpedoes) {
      const [x, y, z] = t.position, previous = this.running.get(t.id);
      if (!previous) { this.running.set(t.id, { x, z, carry: 0 }); continue; }
      const distance = Math.hypot(x - previous.x, z - previous.z);
      // Airborne rounds leave no exhaust in the sea; deep ones never show through it.
      const strength = y > 0 ? 0 : smooth((y + 8) / 4);
      if (distance > 200 || strength <= 0) { previous.x = x; previous.z = z; previous.carry = 0; continue; }
      if (distance < .0001) continue;
      const forwardX = (x - previous.x) / distance, forwardZ = (z - previous.z) / distance;
      const rise = Math.max(.6, -y / RISE_SPEED);
      for (let along = SAMPLE_DISTANCE - previous.carry; along <= distance; along += SAMPLE_DISTANCE) {
        const fraction = along / distance, born = now - dt * (1 - fraction);
        this.samples.push({
          x: previous.x + (x - previous.x) * fraction, z: previous.z + (z - previous.z) * fraction,
          rightX: -forwardZ, rightZ: forwardX, surfaced: born + rise, strength, phase: t.id * 2.3 + born * 1.7,
        });
      }
      previous.carry = (previous.carry + distance) % SAMPLE_DISTANCE;
      previous.x = x; previous.z = z;
    }
    if (this.samples.length && now - this.samples[0].surfaced > LIFETIME) this.samples = this.samples.filter(s => now - s.surfaced <= LIFETIME);
    if (this.elapsed < UPDATE_INTERVAL || (!this.samples.length && !this.painted)) return;
    this.elapsed %= UPDATE_INTERVAL;
    this.anchor(torpedoes, focusX, focusZ, camera);
    this.rasterize(now);
  }

  /** Centre the field where tracks can be resolved: around the viewer, or around
   * the round nearest the line of sight while a magnified sight looks far away. */
  private anchor(torpedoes: readonly TrackTorpedo[], focusX: number, focusZ: number, camera?: Camera): void {
    let x = camera?.position.x ?? focusX, z = camera?.position.z ?? focusZ;
    if (camera && camera.projectionMatrix.elements[5] > 2.05 * 1.5) {
      camera.getWorldDirection(this.forward);
      let best = .985;
      for (const t of torpedoes) {
        const dx = t.position[0] - camera.position.x, dy = t.position[1] - camera.position.y, dz = t.position[2] - camera.position.z;
        const range = Math.hypot(dx, dy, dz);
        if (range < WAKE_EXTENT * .4) continue;
        const aligned = (dx * this.forward.x + dy * this.forward.y + dz * this.forward.z) / range;
        if (aligned > best) { best = aligned; x = t.position[0]; z = t.position[2]; }
      }
    }
    const cell = WAKE_EXTENT / this.resolution;
    this.origin.value.set(Math.round(x / cell) * cell, Math.round(z / cell) * cell);
  }

  private rasterize(now: number): void {
    const { x: originX, y: originZ } = this.origin.value, reach = WAKE_EXTENT / 2;
    if (this.gpu) this.collector.begin(originX, originZ); else this.pixels.fill(0);
    let count = 0;
    for (const sample of this.samples) {
      const age = now - sample.surfaced;
      if (age < 0 || Math.abs(sample.x - originX) > reach || Math.abs(sample.z - originZ) > reach) continue;
      // Bubbles break the surface over a second or so, then the patch spreads,
      // thins and drifts a little off the line it was laid on.
      const strength = sample.strength * smooth(age / 2.5) * Math.exp(-age / 14) * (1 - smooth((age - 20) / 10)) * .88;
      if (strength < .015) continue;
      const drift = Math.sin(sample.phase + age * .21) * Math.min(age * .09, 1.3);
      const x = sample.x + sample.rightX * drift, z = sample.z + sample.rightZ * drift;
      const width = 1.3 + Math.sqrt(age) * .75, length = SAMPLE_DISTANCE * 1.6;
      if (this.gpu) this.collector.stamp(x, z, sample.rightX, sample.rightZ, width, length, strength, false);
      else rasterizeStamp(this.pixels, this.resolution, originX, originZ, x, z, sample.rightX, sample.rightZ, width, length, strength);
      count++;
    }
    if (this.gpu) this.gpu.update([this.collector]); else this.texture.needsUpdate = true;
    this.painted = count > 0;
  }

  diagnostics() { return { samples: this.samples.length, running: this.running.size, painted: this.painted }; }

  reset(): void {
    this.samples = []; this.running.clear(); this.elapsed = 0;
    if (this.painted) {
      if (this.gpu) { this.collector.clear(); this.gpu.update([this.collector]); } else { this.pixels.fill(0); this.texture.needsUpdate = true; }
    }
    this.painted = false;
  }

  dispose(): void { this.samples = []; this.running.clear(); if (this.gpu) this.gpu.dispose(); else this.texture.dispose(); }
}
