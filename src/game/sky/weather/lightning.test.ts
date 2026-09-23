import { expect, test } from 'bun:test';
import { Vector3 } from 'three/webgpu';
import { CLOSE_RANGE, CLOSE_SHARE, FLASH_PEAK, LightningScheduler, planStrokes, seededRandom, SOUND_SPEED, Strike, STRIKE_RANGE, STROKE_INTENSITY,
  THUNDER_AUDIBLE, flashAt, strokeBrightness, strokeDuration, strokeExposure, thunderFor, type Stroke } from './lightning';

const clouds = { altitude: 650, thickness: 4200 };
const horizontal = (strike: Strike, camera: Vector3) => Math.hypot(strike.ground.x - camera.x, strike.ground.z - camera.z);

/** Strikes fired over `seconds` of frames `dt` long at `rate` per minute. */
function run(rate: number, seconds: number, dt: number, seed = 5) {
  const scheduler = new LightningScheduler(seed);
  scheduler.rate = rate;
  let count = 0;
  for (let t = 0; t < seconds; t += dt) count += scheduler.advance(dt);
  return count;
}

test('strikes arrive as a Poisson process at the asked rate, whatever the frame rate', () => {
  // Six a minute for two hours: 720 expected, standard deviation about 27.
  for (const dt of [1 / 30, 1 / 60, 1 / 144]) expect(Math.abs(run(6, 7200, dt) - 720)).toBeLessThan(110);
  expect(Math.abs(run(3, 7200, 1 / 60, 9) - 360)).toBeLessThan(80);
  expect(run(0, 600, 1 / 60)).toBe(0);
  // A rate change keeps the process honest: an hour at 2/min then an hour at 20/min.
  const scheduler = new LightningScheduler(11);
  let early = 0, late = 0;
  scheduler.rate = 2;
  for (let t = 0; t < 3600; t += .05) early += scheduler.advance(.05);
  scheduler.rate = 20;
  for (let t = 0; t < 3600; t += .05) late += scheduler.advance(.05);
  expect(Math.abs(early - 120)).toBeLessThan(45);
  expect(Math.abs(late - 1200)).toBeLessThan(140);
});

test('inter-arrival times are exponential: memoryless, with the mean wait of the rate', () => {
  const scheduler = new LightningScheduler(3);
  scheduler.rate = 12;
  const times: number[] = [];
  const dt = 1 / 120;
  for (let t = 0; t < 7200; t += dt) if (scheduler.advance(dt)) times.push(t);
  const waits = times.slice(1).map((t, i) => t - times[i]);
  const mean = waits.reduce((sum, w) => sum + w, 0) / waits.length;
  expect(mean).toBeCloseTo(5, 0);
  // P(wait > mean) = e⁻¹ for an exponential distribution.
  expect(Math.abs(waits.filter(w => w > 5).length / waits.length - Math.exp(-1))).toBeLessThan(.05);
});

test('a paused frame fires nothing and the same seed gives the same storm', () => {
  const paused = new LightningScheduler(1);
  paused.rate = 25;
  for (let i = 0; i < 10000; i++) expect(paused.advance(0)).toBe(0);
  const camera = new Vector3(120, 30, -400);
  const storm = (seed: number, frames: number[]) => {
    const scheduler = new LightningScheduler(seed);
    scheduler.rate = 10;
    const strikes: Strike[] = [];
    for (const dt of frames) for (let n = scheduler.advance(dt); n > 0; n--) strikes.push(scheduler.next(camera, clouds));
    return strikes.map(s => ({ kind: s.kind, ground: s.ground.toArray(), position: s.position.toArray(), strokes: s.strokes, seed: s.seed }));
  };
  const frames = Array.from({ length: 20000 }, (_, i) => i % 7 === 0 ? 0 : 1 / 60);
  expect(storm(42, frames)).toEqual(storm(42, frames));
  expect(storm(42, frames).length).toBeGreaterThan(20);
  expect(storm(43, frames)).not.toEqual(storm(42, frames));
});

test('strikes land 2–25 km away at random bearings, an occasional one closer, half of them reaching the sea', () => {
  const scheduler = new LightningScheduler(8), camera = new Vector3(3000, 25, -1200);
  const strikes = Array.from({ length: 6000 }, () => scheduler.next(camera, clouds));
  const distances = strikes.map(strike => horizontal(strike, camera));
  expect(Math.min(...distances)).toBeGreaterThanOrEqual(CLOSE_RANGE[0] - 1e-6);
  expect(Math.max(...distances)).toBeLessThanOrEqual(STRIKE_RANGE[1] + 1e-6);
  const close = distances.filter(d => d < STRIKE_RANGE[0]).length / distances.length;
  expect(Math.abs(close - CLOSE_SHARE)).toBeLessThan(.02);
  // Log-uniform: as many between 2 and 5 km as between 10 and 25 km.
  const near = distances.filter(d => d >= 2000 && d < 5000).length, far = distances.filter(d => d >= 10000 && d <= 25000).length;
  expect(Math.abs(near - far) / (near + far)).toBeLessThan(.08);
  const ground = strikes.filter(strike => strike.kind === 'ground').length / strikes.length;
  expect(Math.abs(ground - .5)).toBeLessThan(.03);
  // Every quadrant of bearing takes its share.
  const quadrants = [0, 0, 0, 0];
  for (const strike of strikes) quadrants[(Math.floor(Math.atan2(strike.ground.x - camera.x, strike.ground.z - camera.z) / (Math.PI / 2)) + 4) % 4]++;
  for (const count of quadrants) expect(Math.abs(count / strikes.length - .25)).toBeLessThan(.03);
  for (const strike of strikes) {
    if (strike.kind === 'ground') {
      // The bolt runs from the cloud base to the sea; the light that fills the cloud sits just inside the base.
      expect(strike.top.y).toBe(clouds.altitude);
      expect(strike.position.y).toBeGreaterThan(clouds.altitude);
      expect(strike.position.y).toBeLessThan(clouds.altitude + 300);
      expect(Math.hypot(strike.top.x - strike.ground.x, strike.top.z - strike.ground.z)).toBeLessThanOrEqual(clouds.altitude / 3 + 1e-6);
    } else {
      expect(strike.position.y).toBeGreaterThan(clouds.altitude);
      expect(strike.position.y).toBeLessThan(clouds.altitude + clouds.thickness);
    }
    expect(strike.distance).toBeGreaterThan(0);
  }
});

test('a ground flash is 2–4 return strokes with dark gaps and a fading after-glow, over a fifth to two thirds of a second', () => {
  const random = seededRandom(17);
  for (let i = 0; i < 500; i++) {
    const strokes = planStrokes('ground', random);
    expect(strokes.length).toBeGreaterThanOrEqual(2);
    expect(strokes.length).toBeLessThanOrEqual(4);
    expect(strokes[0].time).toBe(0);
    expect(strokes[0].peak).toBe(1);
    for (let k = 1; k < strokes.length; k++) {
      const gap = strokes[k].time - strokes[k - 1].time;
      expect(gap).toBeGreaterThanOrEqual(.035);
      expect(gap).toBeLessThanOrEqual(.12);
      // Just before each later stroke the channel has all but gone dark.
      expect(strokeBrightness(strokes, strokes[k].time - 1e-4)).toBeLessThan(.3);
      expect(strokeBrightness(strokes, strokes[k].time)).toBeGreaterThan(strokeBrightness(strokes, strokes[k].time - 1e-4) + .4);
    }
    const last = strokes[strokes.length - 1];
    expect(last.time).toBeLessThanOrEqual(.36);
    // The after-glow outlasts the last stroke's flash, then fades: visible (2% of the first peak) for about 0.2–0.6 s in all.
    expect(strokeBrightness(strokes, last.time + .06)).toBeGreaterThan(.02);
    let visible = 0;
    for (let t = 0; t < 2; t += 1e-3) if (strokeBrightness(strokes, t) > .02) visible = t;
    expect(visible).toBeGreaterThan(.15);
    expect(visible).toBeLessThan(.65);
    const duration = strokeDuration(strokes);
    expect(duration).toBeLessThan(1.2);
    expect(strokeBrightness(strokes, duration)).toBeLessThan(2e-3);
  }
});

test('an intra-cloud flash is several softer pulses; neither kind lights anything once done', () => {
  const random = seededRandom(23);
  for (let i = 0; i < 300; i++) {
    const strokes = planStrokes('cloud', random);
    expect(strokes.length).toBeGreaterThanOrEqual(3);
    expect(strokes.length).toBeLessThanOrEqual(7);
    for (const stroke of strokes) expect(stroke.decay).toBeGreaterThan(.025);
    const strike = new Strike('cloud', strokes, 1);
    strike.advance(strike.duration);
    strike.advance(.01);
    expect(strike.done).toBe(true);
    expect(strike.brightness).toBeLessThan(2e-3);
  }
});

test('each frame shows the mean brightness of its exposure: strokes between frames still light one', () => {
  const strokes: Stroke[] = [{ time: 0, peak: 1, decay: .015, glow: .1, glowDecay: .06 }, { time: .07, peak: .6, decay: .015, glow: .3, glowDecay: .1 }];
  // A paused frame shows the instant; a moving one the mean over its exposure.
  expect(strokeExposure(strokes, .03, .03)).toBeCloseTo(strokeBrightness(strokes, .03), 12);
  const integral = (from: number, to: number) => strokeExposure(strokes, from, to) * (to - from);
  expect(integral(0, .1)).toBeCloseTo(integral(0, .037) + integral(.037, .1), 12);
  // Numerically: the exposure is the mean of the curve.
  let sum = 0;
  const steps = 100000;
  for (let i = 0; i < steps; i++) sum += strokeBrightness(strokes, .06 + .02 * (i + .5) / steps);
  expect(strokeExposure(strokes, .06, .08)).toBeCloseTo(sum / steps, 4);
  // A 60 Hz frame straddling the second stroke still flashes; the frame before it is nearly dark.
  expect(strokeExposure(strokes, .062, .0787)).toBeGreaterThan(.2);
  expect(strokeExposure(strokes, .062 - 1 / 60, .062)).toBeLessThan(.15);
});

test('a strike holds on paused frames and its intensity follows the flicker', () => {
  const strike = new Strike('ground', planStrokes('ground', seededRandom(4)), 9);
  strike.advance(0);
  expect(strike.intensity).toBeCloseTo(STROKE_INTENSITY.ground * strokeBrightness(strike.strokes, 0), 9);
  strike.advance(1 / 60);
  const { age, intensity } = strike;
  for (let i = 0; i < 10; i++) strike.advance(0);
  expect(strike.age).toBe(age);
  expect(strike.intensity).toBeCloseTo(STROKE_INTENSITY.ground * strokeBrightness(strike.strokes, age), 9);
  expect(intensity).toBeGreaterThan(0);
});

test('the scene flash reaches about 1.5 next to a strike and fades with distance', () => {
  expect(flashAt('ground', 1, 0)).toBeCloseTo(FLASH_PEAK, 9);
  expect(flashAt('ground', 1.1, 700)).toBeGreaterThan(1.3);
  expect(flashAt('ground', 1.1, 700)).toBeLessThan(1.7);
  let previous = Infinity;
  for (const distance of [500, 1000, 2000, 5000, 10000, 25000]) {
    const flash = flashAt('ground', 1, distance);
    expect(flash).toBeLessThan(previous);
    previous = flash;
  }
  expect(flashAt('ground', 1, 25000)).toBeLessThan(.02);
  expect(flashAt('cloud', 1, 3000)).toBeLessThan(flashAt('ground', 1, 3000));
  expect(flashAt('ground', 0, 1000)).toBe(0);
});

test('thunder arrives at the speed of sound, quieter with distance and silent beyond earshot', () => {
  for (const distance of [300, 1000, 4000, 12000, 25000]) expect(thunderFor('ground', distance).delay).toBeCloseTo(distance / SOUND_SPEED, 12);
  expect(thunderFor('ground', 3430).delay).toBeCloseTo(10, 12);
  let previous = Infinity;
  for (const distance of [200, 1000, 1500, 3000, 6000, 12000, 18000]) {
    const { loudness } = thunderFor('ground', distance);
    expect(loudness).toBeLessThanOrEqual(1);
    expect(loudness).toBeLessThanOrEqual(previous);
    previous = loudness;
  }
  expect(thunderFor('ground', 1000).loudness).toBe(1);
  expect(thunderFor('ground', 6000).loudness).toBeLessThan(.3);
  expect(thunderFor('ground', THUNDER_AUDIBLE[1] + 1).loudness).toBe(0);
  expect(thunderFor('cloud', 3000).loudness).toBeLessThan(thunderFor('ground', 3000).loudness);
});
