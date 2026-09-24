import { DataTexture, LinearFilter, RedFormat, Vector2, Vector4, type Node } from 'three/webgpu';
import { Fn, If, float, mx_noise_float, smoothstep, texture, uniform, vec2, vec3 } from 'three/tsl';
import { BISMARCK } from './session/motion';
import type { ShipState } from '../game/session/elements';

type Motion = Pick<ShipState, 'x' | 'z' | 'heading' | 'speed'>;
/** `along` counts the trail samples laid before this one, so a feature can follow distance along the track; `turn` is
 * the hull's rate of turn when it was laid (rad/s). The rest never changes once laid, so it is worked out then: the
 * heading's unit vector, where the trailing hull end was (`trailX`, `trailZ`: the stern, or the bow when sailing astern),
 * the realistic band's wander and each side's lobe, and the band's and slick's strength at full share (`churn`, `slick`)
 * for the tuning they were last read with. */
type WakeSample = Motion & { born: number; strength: number; along: number; turn: number;
  forwardX: number; forwardZ: number; trailX: number; trailZ: number; wander: number; port: number; starboard: number;
  churn: number; churnPower: number; turnChurn: number; slick: number; slickPower: number };
type ImpactSample = { x: number; z: number; born: number; scale: number };
type WakeHull = { length: number; beam: number; forwardSpeed: number; centerX?: number; centerZ?: number };
export interface WakeStampTarget {
  /** Start a rasterisation: channel 0 is laid on the WAKE_EXTENT square around (centerX, centerZ), channel 1 on the
   * SLICK_EXTENT square around (slickX, slickZ). */
  begin(centerX: number, centerZ: number, slickX?: number, slickZ?: number): void;
  stamp(x: number, z: number, rightX: number, rightZ: number, width: number, length: number, strength: number, ring: boolean, channel?: 0 | 1): void;
  clear(): void;
}

export const WAKE_EXTENT = 1536;
/** Edge (m) of the square each trail's slick is painted in: wide enough to hold minutes of a straight run, at a
 * coarser cell than the churned water, which the slick's slow, smooth edges allow. */
export const SLICK_EXTENT = 4096;
const EXTENT = WAKE_EXTENT;
const LIFETIME = 55;
const IMPACT_LIFETIME = 24;
const SAMPLE_DISTANCE = 3;
/** Every this many trail samples also records a slick sample. */
const SLICK_EVERY = 6;
const UPDATE_INTERVAL = 1 / 20;
/** Preparation estimate only; unusual motion can still grow the retained buffers. */
export const wakeStampBudget = (speed: number) => Math.ceil(LIFETIME * speed / SAMPLE_DISTANCE + 2) * 5 + 64;
const smooth = (value: number) => {
  const t = Math.max(0, Math.min(value, 1));
  return t * t * (3 - 2 * t);
};

/** Shape of the realistic wake (`OceanRealism.wake`): stamps laid per trail sample. Visual values, measured against
 * aerial photographs of warships at speed rather than a hydrodynamic model. Read live. */
export const WAKE_TUNING = {
  /** Half-width of the churned band at the stern, as a share of beam: the propellers' white water is about a beam
   * wide. */
  churnWidth: .45,
  /** Widening of the band: its half-width grows by this share of beam × √(metres run since ÷ beam). */
  churnSpread: .13,
  /** e-folding time (s) of the churned water's turbulence, which the surface turns into foam and bubble clouds. */
  churnLife: 24,
  /** Turbulence against the share of full speed: raised to this power, so a slow hull leaves little white water. */
  churnPower: 1.3,
  /** Sideways wander of the band along the track (m per √s of age, at most a sixth of beam). */
  meander: .6,
  /** How far each side of the band bulges and draws in along the track, as a share of its half-width: the lobes and
   * bays of a turbulent wake's outline, about a beam or two long. */
  lobes: .35,
  /** Extra turbulence from a hard turn, where the hull slides through the water at an angle: up to this share more
   * once the turn rate × length ÷ speed reaches 1. */
  turnChurn: .6,
  /** Half-width of the slick behind the stern as a share of beam, and its widening per √(metres run ÷ beam). */
  slickWidth: .55,
  slickSpread: .2,
  /** e-folding time (s) of the slick's calm; it is gone after SLICK_LIFETIME. */
  slickLife: 80,
  /** Slick against the share of full speed. */
  slickPower: .7,
};
export type WakeTuning = typeof WAKE_TUNING;
/** Seconds a slick sample lasts. */
export const SLICK_LIFETIME = 240;
/** Narrowest footprint, in cells of its channel: narrower stamps would fall between texel centres. */
const MIN_CELLS = 1.5;
/** Furthest (m, on each axis) the slick's square may centre from the hull, which keeps the newest slick well inside. */
const SLICK_REACH = .42 * SLICK_EXTENT;
/** A box around nothing (finite: shaders compare it). */
export const EMPTY = new Vector4(1e9, 1e9, -1e9, -1e9);

/** World-space foam footprints, shaded on the displaced water itself.
 * Samples remember the heading at emission, so old water never turns with the hull.
 * The small scalar texture stores coverage; the water shader supplies the bubbles.
 *
 * Realistic (`OceanRealism.wake`): channel 0 holds the churned water's turbulence, one continuous band about a beam
 * wide that decays with age (the surface turns it into foam and turquoise bubble clouds), and channel 1 the slick
 * that outlives it by minutes, on a wider square centred on the trail itself. Off, the trail is the translucent
 * three-stream foam first tuned to match the replaced ocean library, exactly.
 */
export class WakeFoam {
  readonly texture: DataTexture;
  private readonly pixels: Uint8Array;
  /** The slick channel of the CPU reference raster (without a stamp target). */
  readonly slickPixels: Uint8Array;
  private readonly origin = uniform(new Vector2());
  private readonly slickOrigin = new Vector2();
  /** What the last rasterisation painted in each channel: (minX, minZ, maxX, maxZ) in metres, padded by a texel for
   * filtering; empty (min above max) when nothing was. The sampler reads a channel only inside its box. */
  readonly painted = [EMPTY.clone(), EMPTY.clone()] as const;
  private readonly time = uniform(0);
  private readonly field;
  private readonly samples: WakeSample[] = [];
  private readonly slickSamples: WakeSample[] = [];
  private readonly impacts: ImpactSample[] = [];
  private previous?: Motion;
  /** Storage for `previous`: only the pose and speed are kept between updates. */
  private readonly last: Motion = { x: 0, z: 0, heading: 0, speed: 0 };
  private sampleDistance = 0;
  private sampleCount = 0;
  private elapsed = 0;
  private dirty = false;
  private churned = false;
  /** Paint the young bow-shoulder crests. The analytic bow waves draw them instead when enabled. */
  bowShoulders = true;
  /** Live shape of the realistic trail; shared by every trail of a fleet. */
  tuning: WakeTuning = WAKE_TUNING;

  constructor(private readonly resolution: number, private readonly hull: WakeHull = { length: 250, beam: 36, forwardSpeed: BISMARCK.forwardSpeed }, private readonly stampTarget?: WakeStampTarget) {
    this.pixels = new Uint8Array(resolution * resolution);
    this.slickPixels = new Uint8Array(resolution * resolution);
    this.texture = new DataTexture(this.pixels, resolution, resolution, RedFormat);
    this.texture.minFilter = this.texture.magFilter = LinearFilter;
    this.texture.generateMipmaps = false;
    this.texture.needsUpdate = true;
    this.field = texture(this.texture);
  }

  get center(): Readonly<Vector2> { return this.origin.value; }
  /** Centre of the slick's SLICK_EXTENT square. */
  get slickCenter(): Readonly<Vector2> { return this.slickOrigin; }

  /** Paint the realistic wake (continuous churned water and a slick) instead of the three translucent streams. */
  get realistic(): boolean { return this.churned; }
  set realistic(value: boolean) {
    if (value === this.churned) return;
    this.churned = value;
    // Repaint on the next update, however recently the trail last rasterised.
    this.dirty = true; this.elapsed = Infinity;
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

  update(state: Motion, dt: number, updateInterval = UPDATE_INTERVAL): void {
    if (dt <= 0) return;
    this.time.value += dt;
    this.elapsed += dt;
    const previous = this.previous;
    const translation = previous ? Math.hypot(state.x - previous.x, state.z - previous.z) : 0;
    const headingDelta = previous ? Math.atan2(Math.sin(state.heading - previous.heading), Math.cos(state.heading - previous.heading)) : 0;
    // Bound travel at both hull ends: a stern can sweep far through the water
    // while the ship's centre barely moves. Sampling centre travel alone leaves
    // gaps through tight turns. Only translation identifies a teleport.
    const endRadius = Math.hypot(this.hull.centerX ?? 0, Math.abs(this.hull.centerZ ?? 0) + this.hull.length * .468);
    const distance = translation + Math.abs(headingDelta) * endRadius;
    if (translation > 100) this.reset();
    else if (previous && distance > 0.0001 && Math.abs(state.speed) > 0.15) {
      // Interpolate the pose and birth time along the swept path so foam stays
      // continuous at the emission points, independently of the frame rate.
      for (let along = SAMPLE_DISTANCE - this.sampleDistance; along <= distance; along += SAMPLE_DISTANCE) {
        const fraction = along / distance;
        const speed = previous.speed + (state.speed - previous.speed) * fraction;
        const sample = this.lay({
          x: previous.x + (state.x - previous.x) * fraction,
          z: previous.z + (state.z - previous.z) * fraction,
          heading: previous.heading + headingDelta * fraction,
          speed,
          strength: smooth(Math.abs(speed) / this.hull.forwardSpeed) ** 0.65,
          along: this.sampleCount,
          turn: Math.abs(headingDelta) / dt,
          born: this.time.value - dt * (1 - fraction),
        });
        this.samples.push(sample);
        // The slick keeps a sparser record for longer, whichever trail is drawn, so switching shows its whole length.
        if (this.sampleCount++ % SLICK_EVERY === 0) this.slickSamples.push(sample);
        this.dirty = true;
      }
      this.sampleDistance = (this.sampleDistance + distance) % SAMPLE_DISTANCE;
    }
    const last = this.last;
    last.x = state.x; last.z = state.z; last.heading = state.heading; last.speed = state.speed;
    this.previous = last;
    while (this.samples.length && this.time.value - this.samples[0].born > LIFETIME) this.samples.shift();
    while (this.slickSamples.length && this.time.value - this.slickSamples[0].born > SLICK_LIFETIME) this.slickSamples.shift();
    while (this.impacts.length && this.time.value - this.impacts[0].born > IMPACT_LIFETIME) this.impacts.shift();
    const slick = this.churned && this.slickSamples.length > 0;
    if (this.elapsed < updateInterval || (!this.samples.length && !this.impacts.length && !slick && !this.dirty)) return;
    this.elapsed = Number.isFinite(this.elapsed) ? this.elapsed % updateInterval : 0;
    this.rasterize(state);
    this.dirty = this.samples.length > 0 || this.impacts.length > 0 || slick;
  }

  /** A new sample with everything that stays fixed for its life worked out, by the same expressions its stamps used to
   * repeat on every rasterisation. */
  private lay(motion: Motion & { born: number; strength: number; along: number; turn: number }): WakeSample {
    const hull = this.hull, forwardX = Math.sin(motion.heading), forwardZ = -Math.cos(motion.heading);
    const rightX = -forwardZ, rightZ = forwardX;
    const centerX = motion.x + rightX * (hull.centerX ?? 0) - forwardX * (hull.centerZ ?? 0);
    const centerZ = motion.z + rightZ * (hull.centerX ?? 0) - forwardZ * (hull.centerZ ?? 0);
    const aft = (motion.speed >= 0 ? 1 : -1) * hull.length * .468;
    const along = motion.along * SAMPLE_DISTANCE, laps = along / hull.beam;
    const lobe = (phase: number) => Math.sin(laps * 4.8 + phase) * .6 + Math.sin(laps * 2.1 + phase * 1.7) * .4;
    return { ...motion, forwardX, forwardZ, trailX: centerX - forwardX * aft, trailZ: centerZ - forwardZ * aft,
      wander: Math.sin(along / 37) * .6 + Math.sin(along / 83 + 1.7) * .4, port: lobe(2.3), starboard: lobe(0),
      churn: 0, churnPower: NaN, turnChurn: NaN, slick: 0, slickPower: NaN };
  }

  splash(x: number, z: number, caliberM: number): void {
    if (this.impacts.length >= 32) this.impacts.shift();
    this.impacts.push({ x, z, born: this.time.value, scale: Math.pow(Math.max(.05, caliberM) / .38, .65) });
    this.dirty = true;
  }

  resetImpacts(): void { this.impacts.length = 0; this.dirty = true; }

  reset(): void {
    this.samples.length = 0;
    this.slickSamples.length = 0;
    this.impacts.length = 0;
    this.previous = undefined;
    this.sampleDistance = 0;
    this.sampleCount = 0;
    this.pixels.fill(0);
    this.slickPixels.fill(0);
    this.stampTarget?.clear();
    for (const box of this.painted) box.copy(EMPTY);
    this.texture.needsUpdate = true;
    this.dirty = false;
  }

  private rasterize(state: Motion): void {
    const cell = EXTENT / this.resolution;
    this.origin.value.set(Math.round(state.x / cell) * cell, Math.round(state.z / cell) * cell);
    if (this.churned) this.frameSlick(state); else this.slickOrigin.copy(this.origin.value);
    // A stamp target paints instead; the reference raster stays unused.
    if (!this.stampTarget) { this.pixels.fill(0); this.slickPixels.fill(0); }
    this.stampTarget?.begin(this.origin.value.x, this.origin.value.y, this.slickOrigin.x, this.slickOrigin.y);
    for (const box of this.painted) box.copy(EMPTY);
    for (const impact of this.impacts) {
      const age = this.time.value - impact.born;
      // A shell's column leaves a broad slick of aerated water that spreads as the
      // spray rains back and lingers well after the air has cleared.
      const radius = (4 + 15 * (1 - Math.exp(-age / 3.5))) * impact.scale;
      const strength = smooth(age / .25) * (.8 + .15 * Math.exp(-age / 2)) * (1 - smooth((age - 10) / (IMPACT_LIFETIME - 10)));
      // Aerated center and a broken outward crest share the actual displaced,
      // lit ocean surface instead of hovering on a horizontal sprite plane.
      this.stamp(impact.x, impact.z, 1, 0, radius, radius, strength * .9);
      this.stamp(impact.x, impact.z, 1, 0, radius * 1.5, radius * 1.5, strength * .7, true);
    }
    if (this.churned) { this.churn(); this.texture.needsUpdate = true; return; }
    for (const sample of this.samples) {
      const age = this.time.value - sample.born;
      const { forwardX, forwardZ } = sample;
      const rightX = -forwardZ, rightZ = forwardX;
      const centerX = sample.x + rightX * (this.hull.centerX ?? 0) - forwardX * (this.hull.centerZ ?? 0);
      const centerZ = sample.z + rightZ * (this.hull.centerX ?? 0) - forwardZ * (this.hull.centerZ ?? 0);
      const aft = (sample.speed >= 0 ? 1 : -1) * this.hull.length * .468;
      const sternX = centerX - forwardX * aft, sternZ = centerZ - forwardZ * aft;
      const fade = Math.exp(-age / 23) * (1 - smooth((age - 38) / 17));
      const eddy = Math.sin(sample.born * 1.7 + age * 0.23) * Math.min(age * 0.22, 3.5);
      const spread = this.hull.beam * .194 + Math.sqrt(age) * 2.5 + age * 0.24;
      const length = 5 + Math.sqrt(age) * 1.25;
      // The three propeller streams merge into one widening, aerated trail.
      // Overlapping footprints use max coverage, so emission frequency never
      // builds an opaque stripe. Older foam loses density as its area grows.
      for (const shaft of [-1, 0, 1]) {
        const offset = shaft * (this.hull.beam * .153 + Math.min(age * 0.16, 4)) + eddy;
        this.stamp(sternX + rightX * offset, sternZ + rightZ * offset,
          rightX, rightZ, spread, length,
          sample.strength * fade * (shaft === 0 ? 1 : 0.84));
      }
      if (!this.bowShoulders) continue;
      // Bow shoulders spread away from the historical course; only their
      // youngest crests carry white water. The native solver carries the swell.
      const shoulder = this.hull.beam * .194 + age * Math.abs(sample.speed) * 0.32;
      const bowX = centerX + forwardX * aft, bowZ = centerZ + forwardZ * aft;
      const crest = sample.strength * Math.exp(-age / 9) * 0.8;
      for (const side of [-1, 1]) {
        this.stamp(bowX + rightX * shoulder * side, bowZ + rightZ * shoulder * side,
          rightX, rightZ, 4 + age * 0.35, length, crest);
      }
    }
    this.texture.needsUpdate = true;
  }

  /** Centre the slick's square on the trail it holds, not on the hull: a straight run then keeps nearly twice the length.
   * The hull stays inside with a margin, so the newest slick is never cut; the oldest falls off the far edge. Whole
   * slick cells only, so repainting never shifts the slick against its texels. */
  private frameSlick(state: Motion): void {
    const cell = SLICK_EXTENT / this.resolution, reach = SLICK_REACH;
    let minX = state.x, maxX = state.x, minZ = state.z, maxZ = state.z;
    for (const sample of this.slickSamples) {
      if (Math.abs(sample.x - state.x) > reach * 2 || Math.abs(sample.z - state.z) > reach * 2) continue;
      minX = Math.min(minX, sample.x); maxX = Math.max(maxX, sample.x); minZ = Math.min(minZ, sample.z); maxZ = Math.max(maxZ, sample.z);
    }
    const x = state.x + Math.max(-reach, Math.min(reach, (minX + maxX) / 2 - state.x));
    const z = state.z + Math.max(-reach, Math.min(reach, (minZ + maxZ) / 2 - state.z));
    this.slickOrigin.set(Math.round(x / cell) * cell, Math.round(z / cell) * cell);
  }

  /** The realistic trail: one churned band per sample in channel 0 and, sparser, the slick in channel 1. Both widen
   * with the square root of the distance run since the stern passed, as a turbulent wake spreads. */
  private churn(): void {
    const tuning = this.tuning, beam = this.hull.beam, now = this.time.value;
    const churnCell = MIN_CELLS * EXTENT / this.resolution, slickCell = MIN_CELLS * SLICK_EXTENT / this.resolution;
    for (const sample of this.samples) {
      const age = now - sample.born;
      if (sample.churnPower !== tuning.churnPower || sample.turnChurn !== tuning.turnChurn) {
        const ratio = Math.min(Math.abs(sample.speed) / this.hull.forwardSpeed, 1);
        const slide = Math.min(1, sample.turn * this.hull.length / Math.max(Math.abs(sample.speed), 1));
        sample.churn = Math.min(1, smooth(ratio) ** tuning.churnPower * (1 + tuning.turnChurn * slide));
        sample.churnPower = tuning.churnPower; sample.turnChurn = tuning.turnChurn;
      }
      const strength = sample.churn * Math.exp(-age / tuning.churnLife) * (1 - smooth((age - 40) / (LIFETIME - 40)));
      if (strength < .015) continue;
      const rightX = -sample.forwardZ, rightZ = sample.forwardX;
      const run = age * Math.abs(sample.speed), spread = Math.sqrt(run / beam);
      const width = Math.max(beam * (tuning.churnWidth + tuning.churnSpread * spread), churnCell);
      // The band wanders a little along the track as its eddies grow.
      const meander = sample.wander * Math.min(tuning.meander * Math.sqrt(age), beam / 6);
      const centerX = sample.trailX + rightX * meander, centerZ = sample.trailZ + rightZ * meander;
      // Each side is its own stamp, bulging and drawing in on its own, so the outline is ragged, not a string of beads.
      for (let side = -1; side <= 1; side += 2) {
        const half = Math.max(width * .65 * (1 + tuning.lobes * (side > 0 ? sample.starboard : sample.port)), churnCell);
        this.stamp(centerX + rightX * side * width * .35, centerZ + rightZ * side * width * .35, rightX, rightZ, half, Math.max(4, width * .35), strength);
      }
    }
    for (const sample of this.slickSamples) {
      const age = now - sample.born;
      if (sample.slickPower !== tuning.slickPower) {
        sample.slick = smooth(Math.min(Math.abs(sample.speed) / this.hull.forwardSpeed, 1)) ** tuning.slickPower;
        sample.slickPower = tuning.slickPower;
      }
      const strength = sample.slick * Math.exp(-age / tuning.slickLife) * (1 - smooth((age - SLICK_LIFETIME * .75) / (SLICK_LIFETIME * .25)));
      if (strength < .015) continue;
      const x = sample.trailX, z = sample.trailZ, rightX = -sample.forwardZ, rightZ = sample.forwardX;
      const run = age * Math.abs(sample.speed), spread = Math.sqrt(run / beam);
      const width = Math.max(beam * (tuning.slickWidth + tuning.slickSpread * spread), slickCell);
      // Long enough along the track to join the next sample SLICK_EVERY × SAMPLE_DISTANCE on.
      this.stamp(x, z, rightX, rightZ, width, Math.max(SLICK_EVERY * SAMPLE_DISTANCE, width * .5), strength, false, 1);
    }
  }

  private stamp(x: number, z: number, rightX: number, rightZ: number,
    width: number, length: number, strength: number, ring = false, channel: 0 | 1 = 0): void {
    if (strength < 0.015) return;
    // The stamp's axis-aligned reach, as the raster measures it, plus a texel of its channel for filtering.
    const pad = (channel ? SLICK_EXTENT : EXTENT) / this.resolution;
    const reachX = Math.abs(rightX) * width + Math.abs(rightZ) * length + pad, reachZ = Math.abs(rightZ) * width + Math.abs(rightX) * length + pad;
    const box = this.painted[channel];
    box.set(Math.min(box.x, x - reachX), Math.min(box.y, z - reachZ), Math.max(box.z, x + reachX), Math.max(box.w, z + reachZ));
    if (this.stampTarget) { this.stampTarget.stamp(x, z, rightX, rightZ, width, length, strength, ring, channel); return; }
    if (channel) rasterizeStamp(this.slickPixels, this.resolution, this.slickOrigin.x, this.slickOrigin.y, x, z, rightX, rightZ, width, length, strength, ring, SLICK_EXTENT);
    else rasterizeStamp(this.pixels, this.resolution, this.origin.value.x, this.origin.value.y, x, z, rightX, rightZ, width, length, strength, ring);
  }

  dispose(): void { this.texture.dispose(); }
}

/** Paint one max-coverage ellipse into a square scalar field of edge `extent` (m) centred on the origin. */
export function rasterizeStamp(pixels: Uint8Array, resolution: number, originX: number, originZ: number,
  x: number, z: number, rightX: number, rightZ: number, width: number, length: number, strength: number, ring = false, extent = EXTENT): void {
  const scale = resolution / extent;
  const cx = (x - originX) * scale + resolution / 2 - 0.5;
  const cz = (z - originZ) * scale + resolution / 2 - 0.5;
  const rx = (Math.abs(rightX) * width + Math.abs(rightZ) * length) * scale;
  const rz = (Math.abs(rightZ) * width + Math.abs(rightX) * length) * scale;
  const minX = Math.max(0, Math.floor(cx - rx)), maxX = Math.min(resolution - 1, Math.ceil(cx + rx));
  const minZ = Math.max(0, Math.floor(cz - rz)), maxZ = Math.min(resolution - 1, Math.ceil(cz + rz));
  // Coverage combines by maximum. An overlapping footprint cannot change a
  // pixel that already reaches this stamp's peak, even at the ring crest.
  const peak = Math.round(strength * 255);
  const inverseWidth = 1 / width, inverseLength = 1 / length;
  for (let iz = minZ; iz <= maxZ; iz++) {
    const row = iz * resolution;
    const dz = (iz - cz) / scale;
    const crossZ = dz * rightZ, alongZ = dz * rightX;
    for (let ix = minX; ix <= maxX; ix++) {
      const index = row + ix;
      if (pixels[index] >= peak) continue;
      const dx = (ix - cx) / scale;
      const cross = (dx * rightX + crossZ) * inverseWidth;
      const along = (-dx * rightZ + alongZ) * inverseLength;
      const radius = cross * cross + along * along;
      if (radius >= 1) continue;
      const profile = ring ? Math.exp(-(((Math.sqrt(radius) - .75) / .13) ** 2)) : 1 - smooth(radius);
      pixels[index] = Math.max(pixels[index], Math.round(strength * profile * 255));
    }
  }
}
