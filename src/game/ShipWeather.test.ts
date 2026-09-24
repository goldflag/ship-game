import { expect, test } from 'bun:test';
import { Group } from 'three/webgpu';
import { RAIN_TIMES, SPRAY_SLOTS, ShipWeather, type ShipWeatherFrame } from './ShipWeather';

const hull = { kind: 'authored-stations-v1', length: 250, beam: 36, draft: 10, depth: 20 } as unknown as WakeHull;
type WakeHull = ShipWeatherFrame['ships'][number]['definition']['hull'];
/** A hull at `x`, heading `heading` (0 runs toward −Z), at `speed` m/s. */
const ship = (x: number, heading: number, speed: number, pitch = 0) => ({ root: new Group(),
  motion: { x, y: 0, z: 0, heading, speed, pitch }, definition: { hull, handling: { forwardSpeed: 14 } } }) as unknown as ShipWeatherFrame['ships'][number];
/** Waves running toward +Z, so a hull heading 0 (toward −Z) meets them head on. */
const frame = (precipitation: number, ships: ShipWeatherFrame['ships'] = [], seaHeight = 1): ShipWeatherFrame =>
  ({ precipitation, seaHeight, waveDirection: Math.PI / 2, ships, camera: { position: { x: 0, z: 0 } } });
const run = (weather: ShipWeather, seconds: number, state: ShipWeatherFrame) => { for (let t = 0; t < seconds; t += .5) weather.update(.5, state); };

test('a scene opens wet in rain, dries over minutes once it stops, and wets through again within tens of seconds', () => {
  const weather = new ShipWeather();
  weather.update(1 / 60, frame(.9));
  expect(weather.rain.value).toBe(1); expect(weather.flow.value).toBe(1);
  // Paused frames hold it.
  weather.update(0, frame(0));
  expect(weather.rain.value).toBe(1);
  run(weather, 60, frame(0));
  expect(weather.rain.value).toBeGreaterThan(.6); expect(weather.flow.value).toBeLessThan(.5);
  run(weather, 5 * RAIN_TIMES.drying, frame(0));
  expect(weather.rain.value).toBeLessThan(.01);
  // A downpour wets through in well under a minute; a drizzle takes longer, and never runs off or pools.
  run(weather, 45, frame(.9));
  expect(weather.rain.value).toBeGreaterThan(.9);
  weather.settle(); weather.update(1 / 60, frame(0));
  expect(weather.rain.value).toBe(0);
  run(weather, 30, frame(.15));
  expect(weather.rain.value).toBeGreaterThan(.3); expect(weather.rain.value).toBeLessThan(.9); expect(weather.flow.value).toBe(0);
});

test('bows wet in a heavy head sea at speed, less running before it, and not at all stopped or in a slight sea', () => {
  const weather = new ShipWeather();
  const head = ship(0, 0, 12), following = ship(300, Math.PI, 12), stopped = ship(600, 0, 0), slow = ship(900, 0, 2.5);
  weather.update(1 / 60, frame(0, [head, following, stopped, slow], 5));
  const [a, b, c, d] = weather.diagnostics().spray;
  expect(a).toBeGreaterThan(.6); expect(b).toBeLessThan(a * .5); expect(c).toBe(0); expect(d).toBeLessThan(a);
  weather.settle(); weather.update(1 / 60, frame(0, [head], .8));
  expect(weather.diagnostics().spray[0]).toBe(0);
  // A plunging bow ships more, and the water drains over tens of seconds after it.
  weather.settle(); weather.update(1 / 60, frame(0, [ship(0, 0, 8, 0)], 3.5));
  const steady = weather.diagnostics().spray[0];
  const plunging = ship(0, 0, 8, 0);
  weather.settle(); weather.update(1 / 60, frame(0, [plunging], 3.5));
  (plunging.motion as { pitch: number }).pitch = -.03; weather.update(.5, frame(0, [plunging], 3.5));
  const plunged = weather.diagnostics().spray[0];
  expect(plunged).toBeGreaterThan(steady);
  weather.update(5, frame(0, [plunging], 3.5));
  expect(weather.diagnostics().spray[0]).toBeGreaterThan(steady * .9);
});

test('only the nearest bows to the camera take a slot, and none reads above the tallest spray', () => {
  const weather = new ShipWeather();
  const fleet = Array.from({ length: SPRAY_SLOTS + 4 }, (_, i) => ship(1000 + 400 * i, 0, 12));
  weather.update(1 / 60, frame(0, fleet, 5));
  const { sprayCeiling } = weather.diagnostics();
  expect(sprayCeiling).toBeGreaterThan(10); expect(sprayCeiling).toBeLessThan(40);
  weather.update(1 / 60, frame(0, [], 5));
  expect(weather.diagnostics()).toMatchObject({ spray: [], sprayCeiling: 0 });
});
