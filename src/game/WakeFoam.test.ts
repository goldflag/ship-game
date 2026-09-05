import { expect, test } from 'bun:test';
import { WakeFoam } from './WakeFoam';

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
