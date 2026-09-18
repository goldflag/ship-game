import { expect, test } from 'bun:test';
import { WakeFoam } from './WakeFoam';
import { WakeStampCollector } from './WakeFoamGpu';

for (const speed of [3, -3]) test(`wake stays at the trailing hull end during a tight turn at ${speed} m/s`, () => {
  const hull = { length: 120, beam: 12, forwardSpeed: 15 };
  const stamps = new WakeStampCollector();
  const foam = new WakeFoam(256, hull, stamps);
  const state = { x: 0, z: 0, heading: Math.PI - .1, speed };
  const step = (turn: number) => {
    state.heading = Math.atan2(Math.sin(state.heading + turn), Math.cos(state.heading + turn));
    state.x += Math.sin(state.heading) * speed / 60;
    state.z -= Math.cos(state.heading) * speed / 60;
    foam.update(state, 1 / 60, 0);
  };
  foam.update(state, 1 / 60);
  for (let frame = 0; frame < 120; frame++) step(0);
  for (let frame = 0; frame < 60; frame++) step(.02);

  const aft = Math.sign(speed) * hull.length * .468;
  const sternX = state.x - Math.sin(state.heading) * aft;
  const sternZ = state.z + Math.cos(state.heading) * aft;
  const centers: [number, number][] = [];
  // Each sample paints three propeller streams followed by two bow shoulders.
  for (let stamp = 1; stamp < stamps.count; stamp += 5) {
    centers.push([stamps.values[stamp * 8], stamps.values[stamp * 8 + 1]]);
  }
  expect(centers.length).toBeGreaterThan(0);
  const newest = centers.at(-1)!;
  expect(Math.hypot(newest[0] - sternX, newest[1] - sternZ)).toBeLessThan(3.1);
  // The whole bend must be connected, not only the final point at the stern.
  for (let i = 1; i < centers.length; i++) {
    expect(Math.hypot(centers[i][0] - centers[i - 1][0], centers[i][1] - centers[i - 1][1])).toBeLessThan(3.2);
  }
  foam.dispose();
});

test('impact foam reaches the ocean field while stopped, freezes on pause, and clears on reset', () => {
  const foam = new WakeFoam(512), state = { x: 0, z: 0, heading: 0, speed: 0 };
  foam.splash(120, -70, .38);
  for (let i = 0; i < 30; i++) foam.update(state, 1 / 60);
  const pixels = foam.texture.image.data as Uint8Array;
  expect(pixels.some(value => value > 0)).toBe(true);
  const paused = pixels.slice();
  foam.update(state, 0);
  expect(pixels).toEqual(paused);
  foam.resetImpacts(); foam.update(state, .1);
  expect(pixels.every(value => value === 0)).toBe(true);
  foam.splash(120, -70, .38);
  for (let i = 0; i < 660; i++) foam.update(state, 1 / 60);
  expect(pixels.every(value => value === 0)).toBe(true);
  foam.dispose();
});
