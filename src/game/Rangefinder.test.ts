import { expect, test } from 'bun:test';
import { PerspectiveCamera } from 'three/webgpu';
import { Rangefinder } from './Rangefinder';
import { observeRangeTarget, pickRangeTarget, rangeTargetVisible, type RangeTarget } from './rangefinderSight';
import type { Island } from '../maps/catalog';

const observation = { id: 'enemy', name: 'Enemy', rangeM: 18000, nearSight: true };

test('three uninterrupted seconds acquire a range; pause cannot finish a measurement', () => {
  const finder = new Rangefinder(); finder.start(observation);
  finder.update(2.9, observation); finder.toggleLock();
  expect(finder.state.rangeM).toBeUndefined(); expect(finder.state.locked).toBe(false);
  finder.update(0, observation); expect(finder.state.phase).toBe('measuring');
  finder.update(.1, { ...observation, rangeM: 17950 });
  expect(finder.state.phase).toBe('tracking'); expect(finder.state.rangeM).toBe(17950);
  finder.toggleLock(); expect(finder.state.locked).toBe(true);
});

test('acquisition stays on its initial ship and cancels when that ship leaves the forgiving sight area', () => {
  const finder = new Rangefinder(); finder.start(observation); finder.update(2, observation);
  finder.update(.2, { ...observation, nearSight: false });
  expect(finder.state.phase).toBe('lost'); expect(finder.state.rangeM).toBeUndefined();
  finder.update(3, observation); expect(finder.state.phase).toBe('lost');
  finder.start(observation); finder.update(3, { ...observation, id: 'neighbor' });
  expect(finder.state.phase).toBe('lost'); expect(finder.state.targetId).toBe('enemy');
});

test('a locked range follows fresh observations, permits lateral lead, and holds its last value after losing sight', () => {
  const finder = new Rangefinder(); finder.start(observation); finder.update(3, observation); finder.toggleLock();
  finder.update(1, { ...observation, rangeM: 17800, nearSight: false });
  expect(finder.state.rangeM!).toBeLessThan(18000); expect(finder.state.rangeM!).toBeGreaterThan(17800);
  const last = finder.state.rangeM;
  finder.update(.1); finder.update(10, { ...observation, rangeM: 15000 });
  expect(finder.state).toMatchObject({ phase: 'lost', rangeM: last, locked: true });
  finder.toggleLock(); expect(finder.state.locked).toBe(false);
  finder.start(observation); expect(finder.state.rangeM).toBeUndefined();
  finder.reset(); expect(finder.state).toMatchObject({ phase: 'idle', locked: false, targetId: undefined });
});

const target: RangeTarget = { id: 'far', name: 'Distant ship', position: [0, 0, -18000], heading: Math.PI / 2, length: 250, beam: 32, height: 30 };
function scope() {
  const camera = new PerspectiveCamera(14, 16 / 9, .5, 60000);
  camera.position.set(0, 37, 0); camera.lookAt(0, 10, -18000); camera.updateMatrixWorld();
  return camera;
}
test('a near miss at 18 km acquires the ship without requiring an exact surface pixel', () => {
  const camera = scope(); camera.lookAt(0, 150, -18000); camera.updateMatrixWorld();
  const result = pickRangeTarget([target], camera, { x: 0, z: 0 }, 1440, 810, []);
  expect(result?.id).toBe('far'); expect(result!.sightDistance).toBeGreaterThan(0); expect(result?.rangeM).toBe(18000);
  camera.lookAt(0, 2000, -18000); camera.updateMatrixWorld();
  expect(pickRangeTarget([target], camera, { x: 0, z: 0 }, 1440, 810, [])).toBeUndefined();
});

test('nearer ships win overlapping sights; hulls, islands, submerged and behind-camera targets cannot be ranged through', () => {
  const camera = scope(), near: RangeTarget = { ...target, id: 'near', position: [0, 0, -9000], height: 80 };
  expect(pickRangeTarget([target, near], camera, { x: 0, z: 0 }, 1440, 810, [])?.id).toBe('near');
  expect(rangeTargetVisible(target, camera.position.toArray(), [target, near], [])).toBe(false);
  const island: Island = { id: 'blocking', side: 0, along: 0, offset: 0, x: 0, z: -9000, rx: 2000, rz: 2000, height: 200, seed: 1, style: 'rock' };
  expect(rangeTargetVisible(target, camera.position.toArray(), [target], [island])).toBe(false);
  expect(observeRangeTarget({ ...target, position: [0, -100, -18000] }, camera, { x: 0, z: 0 }, 1440, 810)).toBeUndefined();
  expect(observeRangeTarget({ ...target, position: [0, 0, 18000] }, camera, { x: 0, z: 0 }, 1440, 810)).toBeUndefined();
});
