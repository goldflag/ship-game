import { Vector3 } from 'three/webgpu';
import type { LightningStrike } from '../contracts';

/** Renderer-free lightning: a seeded Poisson scheduler, the return-stroke flicker, the scene flash
 * and the thunder cue. The GPU side (`boltMesh.ts`) draws what this decides.
 *
 * Intensity convention (`LightningStrike.intensity`, `SkyUniforms.lightningIntensity`): the channel's
 * radiant intensity, scaled so that a point `r` metres from the strike's `position` receives an
 * irradiance of `intensity × (1000 / r)²` in the sea's units, where the sun above the atmosphere gives
 * about 6. A return stroke peaks at `STROKE_INTENSITY.ground` (40): cloud 1 km from the channel takes
 * some seven times full sunlight for a frame, cloud 500 m away four times that. That lights a storm
 * cell brightly at night and still visibly under a daylight deck (a storm's sunlight is about 1.8).
 * Between strokes it falls to nothing. */

/** Cloud-to-ground strikes draw a bolt to the sea; intra-cloud flashes only light the clouds. */
export type StrikeKind = 'ground' | 'cloud';

/** One return stroke, or one pulse of an intra-cloud flash: an instant rise, a fast exponential decay
 * and a slower continuing-current glow. Times in seconds from the first stroke. */
export interface Stroke {
  readonly time: number;
  readonly peak: number;
  readonly decay: number;
  /** Continuing current, as a share of `peak`, and its decay. */
  readonly glow: number;
  readonly glowDecay: number;
}

/** Strikes land this far from the camera (m), log-uniformly: as many between 2 and 5 km as between 10 and 25. */
export const STRIKE_RANGE = [2000, 25000] as const;
/** Share of strikes that come closer than `STRIKE_RANGE`, uniformly over `CLOSE_RANGE` (m). */
export const CLOSE_SHARE = .07;
export const CLOSE_RANGE = [700, 2000] as const;
/** Share of strikes that reach the sea. */
export const GROUND_SHARE = .5;
/** Radiant intensity at a stroke's peak (see the convention above). Intra-cloud pulses are dimmer. */
export const STROKE_INTENSITY: Readonly<Record<StrikeKind, number>> = { ground: 40, cloud: 20 };
/** The scene flash, as a multiple of the ambient fill, at a stroke's peak next to the camera; it halves at
 * `FLASH_RANGE` (m) and falls with the square of the distance beyond. Cloud flashes light less of the sky. */
export const FLASH_PEAK = 1.5, FLASH_RANGE = 2200;
const FLASH_SHARE: Readonly<Record<StrikeKind, number>> = { ground: 1, cloud: .6 };
/** Speed of sound (m/s): thunder's delay. */
export const SOUND_SPEED = 343;
/** Thunder is at full loudness within `THUNDER_NEAR` (m) and falls as the inverse distance beyond; refraction
 * bends it over the listener between the two `THUNDER_AUDIBLE` distances, past which none is heard. */
export const THUNDER_NEAR = 1500;
export const THUNDER_AUDIBLE = [14000, 22000] as const;
/** A strike stops lighting anything once its brightness falls below this share of a stroke's peak. */
const DARK = 1e-3;

/** A small seeded generator (mulberry32): the same seed gives the same storm. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The flicker of one flash. A ground flash is 2–4 return strokes 35–120 ms apart, each a few milliseconds
 * bright and dark again within a frame or two, with a fading after-glow behind the last; an intra-cloud
 * flash is 3–7 softer, longer pulses over up to a second. */
export function planStrokes(kind: StrikeKind, random: () => number): Stroke[] {
  const strokes: Stroke[] = [];
  if (kind === 'ground') {
    const count = 2 + Math.floor(random() * 3);
    let time = 0;
    for (let i = 0; i < count; i++) {
      if (i) time += .035 + random() * .085;
      const last = i === count - 1;
      strokes.push({ time, peak: i ? .45 + random() * .4 : 1, decay: .012 + random() * .01,
        glow: last ? .2 + random() * .12 : .05 + random() * .1, glowDecay: last ? .05 + random() * .04 : .03 + random() * .03 });
    }
  } else {
    const count = 3 + Math.floor(random() * 5);
    let time = 0;
    for (let i = 0; i < count; i++) {
      if (i) time += .03 + random() * .13;
      strokes.push({ time, peak: .35 + random() * .65, decay: .03 + random() * .05, glow: .15 + random() * .15, glowDecay: .08 + random() * .08 });
    }
  }
  return strokes;
}

/** Brightness at `age` (s), relative to a stroke's peak. */
export function strokeBrightness(strokes: readonly Stroke[], age: number): number {
  let sum = 0;
  for (const { time, peak, decay, glow, glowDecay } of strokes) {
    if (age < time) break;
    const since = age - time;
    sum += peak * (Math.exp(-since / decay) + glow * Math.exp(-since / glowDecay));
  }
  return sum;
}

/** Mean brightness over the exposure `from`–`to` (s): what a frame shows. A stroke that falls between two
 * frames still lights the next one; a paused frame (`from === to`) shows the instant. */
export function strokeExposure(strokes: readonly Stroke[], from: number, to: number): number {
  if (to - from < 1e-6) return strokeBrightness(strokes, to);
  let sum = 0;
  const exposed = (peak: number, decay: number, since: number, until: number) => peak * decay * (Math.exp(-since / decay) - Math.exp(-until / decay));
  for (const { time, peak, decay, glow, glowDecay } of strokes) {
    if (to <= time) break;
    const since = Math.max(0, from - time), until = to - time;
    sum += exposed(peak, decay, since, until) + exposed(peak * glow, glowDecay, since, until);
  }
  return sum / (to - from);
}

/** Brightness of the first stroke alone: the stepped leader's branches, which later strokes do not relight. */
export function firstStrokeExposure(strokes: readonly Stroke[], from: number, to: number): number {
  return strokes.length ? strokeExposure(strokes.slice(0, 1), from, to) : 0;
}

/** Seconds until a flash has gone dark. */
export function strokeDuration(strokes: readonly Stroke[]): number {
  let end = 0;
  for (const { time, peak, decay, glow, glowDecay } of strokes)
    end = Math.max(end, time + decay * Math.log(Math.max(1, peak * strokes.length / DARK)), time + glowDecay * Math.log(Math.max(1, peak * glow * strokes.length / DARK)));
  return end;
}

/** Thunder heard for a strike whose nearest channel lies `distance` metres away. */
export function thunderFor(kind: StrikeKind, distance: number): { distance: number; delay: number; loudness: number } {
  const [fade, silent] = THUNDER_AUDIBLE;
  const t = Math.max(0, Math.min(1, (distance - fade) / (silent - fade)));
  const audible = 1 - t * t * (3 - 2 * t);
  const loudness = Math.min(1, THUNDER_NEAR / Math.max(1, distance)) * audible * (kind === 'cloud' ? .6 : 1);
  return { distance, delay: distance / SOUND_SPEED, loudness };
}

/** Scene flash (a multiple of the ambient fill) for a flash of brightness `brightness` `distance` metres away. */
export function flashAt(kind: StrikeKind, brightness: number, distance: number): number {
  return FLASH_PEAK * FLASH_SHARE[kind] * brightness / (1 + (distance / FLASH_RANGE) ** 2);
}

/** One flash: where it is, how it flickers, and its state this frame. */
export class Strike implements LightningStrike {
  /** The channel's brightest point, inside the cloud base: what lights the clouds. */
  readonly position = new Vector3();
  /** Where a ground stroke meets the sea (under an intra-cloud flash, the point below it). */
  readonly ground = new Vector3();
  /** Top of the visible channel, at the cloud base. */
  readonly top = new Vector3();
  age = 0;
  /** Nearest channel point from the camera when it fired (m), for thunder. */
  distance = 0;
  /** Radiant intensity this frame, flicker included (see the convention at the top of this file). */
  intensity = 0;
  /** Brightness this frame relative to a stroke's peak, and the first stroke's share of it. */
  brightness = 0;
  firstBrightness = 0;
  readonly duration: number;

  constructor(readonly kind: StrikeKind, readonly strokes: readonly Stroke[], readonly seed: number) {
    this.duration = strokeDuration(strokes);
  }

  get done(): boolean { return this.age >= this.duration; }

  /** Advance by `dt` and expose the frame: `dt` 0 holds the instant. */
  advance(dt: number): void {
    const from = this.age;
    this.age += Math.max(0, dt);
    this.expose(from, this.age);
  }

  /** Brightness over the exposure `from`–`to`. */
  expose(from: number, to: number): void {
    this.brightness = strokeExposure(this.strokes, from, to);
    this.firstBrightness = firstStrokeExposure(this.strokes, from, to);
    this.intensity = STROKE_INTENSITY[this.kind] * this.brightness;
  }
}

/** Where storms put their strikes: the cloud layer's base and depth (m). */
export interface StrikeClouds { altitude: number; thickness: number }

/** Strikes as a Poisson process at `rate` per minute, from a seeded stream, around the camera. The stream
 * advances only with time, so the same seed and the same frames give the same storm, and a paused frame
 * (`dt` 0) fires nothing. The rate may change at any time: the remaining wait is kept in units of the
 * expected wait, which is exact for a Poisson process. */
export class LightningScheduler {
  /** Strikes per minute within sight. */
  rate = 0;
  private readonly random: () => number;
  /** Unit-exponential budget left before the next strike. */
  private budget: number;

  constructor(seed = 1941) {
    this.random = seededRandom(seed);
    this.budget = this.wait();
  }

  /** Strikes that fell due during `dt` seconds: usually none, sometimes one. */
  advance(dt: number): number {
    if (!(dt > 0) || !(this.rate > 0)) return 0;
    this.budget -= this.rate / 60 * dt;
    let due = 0;
    while (this.budget <= 0) { due++; this.budget += this.wait(); }
    return due;
  }

  /** The next strike around `camera`: its kind, bearing, distance, channel ends and flicker. */
  next(camera: Vector3, clouds: StrikeClouds): Strike {
    const random = this.random;
    const kind: StrikeKind = random() < GROUND_SHARE ? 'ground' : 'cloud';
    const distance = random() < CLOSE_SHARE ? CLOSE_RANGE[0] + (CLOSE_RANGE[1] - CLOSE_RANGE[0]) * random()
      : STRIKE_RANGE[0] * (STRIKE_RANGE[1] / STRIKE_RANGE[0]) ** random();
    const bearing = random() * 2 * Math.PI;
    const strike = new Strike(kind, planStrokes(kind, random), Math.floor(random() * 2 ** 32));
    strike.ground.set(camera.x + Math.sin(bearing) * distance, 0, camera.z + Math.cos(bearing) * distance);
    placeChannel(strike, clouds, random);
    strike.distance = channelDistance(strike, camera);
    return strike;
  }

  private wait(): number { return -Math.log(1 - this.random()); }
}

const nearest = new Vector3();
/** Distance from `from` to the nearest point of a strike's channel: the straight line from its top to the sea
 * for a ground bolt (the bolt's wander changes it little), the flash itself inside the cloud otherwise. */
export function channelDistance(strike: Strike, from: Vector3): number {
  if (strike.kind === 'cloud') return strike.position.distanceTo(from);
  const { top, ground } = strike;
  nearest.subVectors(top, ground);
  const t = Math.max(0, Math.min(1, (nearest.dot(from) - nearest.dot(ground)) / Math.max(1e-6, nearest.lengthSq())));
  return nearest.multiplyScalar(t).add(ground).distanceTo(from);
}

/** Put a strike's channel under the cloud base: a ground bolt leans up to a third of the base height, and
 * its brightest point lies just inside the base; an intra-cloud flash sits a quarter to 60% up the layer. */
export function placeChannel(strike: Strike, clouds: StrikeClouds, random: () => number): void {
  const base = Math.max(200, clouds.altitude), depth = Math.max(300, clouds.thickness);
  if (strike.kind === 'ground') {
    const lean = random() * .33 * base, heading = random() * 2 * Math.PI;
    strike.top.set(strike.ground.x + Math.sin(heading) * lean, base, strike.ground.z + Math.cos(heading) * lean);
    strike.position.set(strike.top.x, base + Math.min(250, .1 * depth), strike.top.z);
  } else {
    strike.top.set(strike.ground.x, base, strike.ground.z);
    strike.position.set(strike.ground.x, base + (.25 + .35 * random()) * depth, strike.ground.z);
  }
}
