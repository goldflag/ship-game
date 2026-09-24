import { LinearFilter, Vector2, Vector3, type Camera, type Node, type Texture } from 'three/webgpu';
import { Fn, If, float, mx_noise_float, smoothstep, texture, uniform, vec2, vec3 } from 'three/tsl';
import { WAKE_EXTENT } from './WakeFoam';
import { WakeStampCollector, type WakeFoamPainter, type WakeFoamPainterFactory } from './WakeFoamGpu';
import type { Torpedo } from './torpedoAim';

type TrackTorpedo = Pick<Torpedo, 'id' | 'position' | 'velocity'>;
/** A sample's eight floats in `TorpedoTrackFoam.data`: where it lies, its track's side, when it surfaced, its strength, its
 * drift phase, and `LAID`, the field time the frame that laid it began at (samples run in the order laid). */
const X = 0, Z = 1, RIGHT_X = 2, RIGHT_Z = 3, SURFACED = 4, STRENGTH = 5, PHASE = 6, LAID = 7, STRIDE = 8;

const SAMPLE_DISTANCE = 4;
const LIFETIME = 30;
const UPDATE_INTERVAL = 1 / 20;
/** Exhaust rises as a loose plume, faster than a lone bubble. */
const RISE_SPEED = 1.5;
/** Seconds the shallowest exhaust still takes to surface. */
const RISE_FLOOR = .6;
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
  private readonly painter: WakeFoamPainter;
  private readonly collector = new WakeStampCollector();
  private readonly running = new Map<number, { x: number; z: number; carry: number }>();
  private readonly present = new Set<number>();
  private readonly forward = new Vector3();
  /** The samples, oldest first, from `first`: STRIDE floats each in one array, which a pass over tens of thousands of
   * them reads in order instead of chasing an object per sample. */
  private data = new Float64Array(1024 * STRIDE);
  private first = 0;
  private count = 0;
  private elapsed = 0;
  private painted = false;
  /** The painter last drew an empty field: drawing another changes nothing it holds, so it is skipped. */
  private blank = false;

  /** `painter` draws the field: `gpuWakeFoamPainter(renderer)` in the game. */
  constructor(private readonly resolution: number, painter: WakeFoamPainterFactory) {
    this.painter = painter(resolution, 1);
    this.texture = this.painter.texture;
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
    const laid = this.time.value;
    this.time.value += dt; this.elapsed += dt;
    const now = this.time.value, present = this.present;
    present.clear();
    for (const t of torpedoes) present.add(t.id);
    for (const id of this.running.keys()) if (!present.has(id)) this.running.delete(id);
    for (const t of torpedoes) {
      const [x, y, z] = t.position, previous = this.running.get(t.id);
      if (!previous) { this.running.set(t.id, { x, z, carry: 0 }); continue; }
      const distance = Math.hypot(x - previous.x, z - previous.z);
      // Airborne rounds leave no exhaust in the sea; deep ones never show through it.
      const strength = y > 0 ? 0 : smooth((y + 8) / 4);
      if (distance > 200 || strength <= 0) { previous.x = x; previous.z = z; previous.carry = 0; continue; }
      if (distance < .0001) continue;
      const forwardX = (x - previous.x) / distance, forwardZ = (z - previous.z) / distance;
      const rise = Math.max(RISE_FLOOR, -y / RISE_SPEED);
      for (let along = SAMPLE_DISTANCE - previous.carry; along <= distance; along += SAMPLE_DISTANCE) {
        const fraction = along / distance, born = now - dt * (1 - fraction);
        const o = this.push();
        const data = this.data;
        data[o + X] = previous.x + (x - previous.x) * fraction; data[o + Z] = previous.z + (z - previous.z) * fraction;
        data[o + RIGHT_X] = -forwardZ; data[o + RIGHT_Z] = forwardX; data[o + SURFACED] = born + rise; data[o + STRENGTH] = strength;
        data[o + PHASE] = t.id * 2.3 + born * 1.7; data[o + LAID] = laid;
      }
      previous.carry = (previous.carry + distance) % SAMPLE_DISTANCE;
      previous.x = x; previous.z = z;
    }
    if (this.count && now - this.data[this.first * STRIDE + SURFACED] > LIFETIME) this.expire(now);
    if (this.elapsed < UPDATE_INTERVAL || (!this.count && !this.painted)) return;
    this.elapsed %= UPDATE_INTERVAL;
    this.anchor(torpedoes, focusX, focusZ, camera);
    this.rasterize(now);
  }

  /** Room for one more sample at the end: the offset of its floats. */
  private push(): number {
    if ((this.first + this.count + 1) * STRIDE > this.data.length) {
      // Move the samples to the front, into a larger array once they fill half of this one.
      const data = this.count * 2 * STRIDE > this.data.length ? new Float64Array(this.data.length * 2) : this.data;
      data.set(this.data.subarray(this.first * STRIDE, (this.first + this.count) * STRIDE));
      this.data = data; this.first = 0;
    }
    return (this.first + this.count++) * STRIDE;
  }

  /** Drop every sample that surfaced more than LIFETIME ago, keeping the rest in order. A sample surfaces at least
   * RISE_FLOOR after the frame that laid it began, so only the leading run laid more than LIFETIME - RISE_FLOOR ago (with
   * a margin) can have expired: its survivors move to the end of that run and the run's head is cut. */
  private expire(now: number): void {
    const data = this.data, first = this.first, last = first + this.count, horizon = now - LIFETIME + RISE_FLOOR - .1;
    let end = first;
    while (end < last && data[end * STRIDE + LAID] < horizon) end++;
    let cut = end;
    for (let i = end - 1; i >= first; i--) if (now - data[i * STRIDE + SURFACED] <= LIFETIME) {
      if (--cut !== i) data.copyWithin(cut * STRIDE, i * STRIDE, i * STRIDE + STRIDE);
    }
    this.count -= cut - first; this.first = cut;
    if (!this.count) this.first = 0;
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
    this.collector.begin(originX, originZ);
    let count = 0;
    const data = this.data, end = (this.first + this.count) * STRIDE;
    for (let o = this.first * STRIDE; o < end; o += STRIDE) {
      const age = now - data[o + SURFACED];
      if (age < 0 || Math.abs(data[o + X] - originX) > reach || Math.abs(data[o + Z] - originZ) > reach) continue;
      // Bubbles break the surface over a second or so, then the patch spreads,
      // thins and drifts a little off the line it was laid on.
      const strength = data[o + STRENGTH] * smooth(age / 2.5) * Math.exp(-age / 14) * (1 - smooth((age - 20) / 10)) * .88;
      if (strength < .015) continue;
      const rightX = data[o + RIGHT_X], rightZ = data[o + RIGHT_Z];
      const drift = Math.sin(data[o + PHASE] + age * .21) * Math.min(age * .09, 1.3);
      const x = data[o + X] + rightX * drift, z = data[o + Z] + rightZ * drift;
      const width = 1.3 + Math.sqrt(age) * .75, length = SAMPLE_DISTANCE * 1.6;
      this.collector.stamp(x, z, rightX, rightZ, width, length, strength, false);
      count++;
    }
    if (count || !this.blank) this.painter.update([this.collector]);
    this.painted = count > 0; this.blank = !count;
  }

  diagnostics() { return { samples: this.count, running: this.running.size, painted: this.painted }; }

  reset(): void {
    this.first = this.count = 0; this.running.clear(); this.elapsed = 0;
    if (this.painted) {
      this.collector.clear(); this.painter.update([this.collector]); this.blank = true;
    }
    this.painted = false;
  }

  dispose(): void { this.first = this.count = 0; this.running.clear(); this.painter.dispose(); }
}
