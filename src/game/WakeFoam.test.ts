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

test('returning water keeps a broad foam footprint after the initial crown has fallen', () => {
  const foam = new WakeFoam(256), state = { x: 0, z: 0, heading: 0, speed: 0 };
  foam.splash(120, -70, .38);
  const footprint = () => Array.from(foam.texture.image.data as Uint8Array).filter(value => value > 64).length;
  foam.update(state, .5); const early = footprint();
  foam.update(state, 3.5);
  expect(footprint()).toBeGreaterThan(early * 2);
  expect(Math.max(...foam.texture.image.data as Uint8Array)).toBeGreaterThan(120);
  foam.update(state, 7);
  expect(footprint()).toBe(0);
  foam.dispose();
});
