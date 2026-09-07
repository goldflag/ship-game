import { expect, test } from 'bun:test';
import { AirMapNavigation } from './airMapNavigation';

test('held arrows pan continuously, release independently, and cancel opposite directions', () => {
  const nav = new AirMapNavigation();
  expect(nav.key('KeyA', true)).toBe(false);
  nav.key('ArrowRight', true);
  expect(nav.step(1 / 60, 1280, 720)).toEqual([-10, 0]);
  nav.key('ArrowLeft', true);
  expect(nav.step(1 / 60, 1280, 720)).toEqual([0, 0]);
  nav.key('ArrowLeft', false);
  expect(nav.step(1 / 30, 1280, 720)).toEqual([-20, 0]);
  nav.key('ArrowRight', false);
  expect(nav.step(1 / 60, 1280, 720)).toEqual([0, 0]);
});

test('mouse edges ramp smoothly, corners keep the same speed, and clearing stops all movement', () => {
  const nav = new AirMapNavigation();
  nav.pointer = { x: 16, y: 360 };
  expect(nav.step(1 / 60, 1280, 720)).toEqual([5, 0]);
  nav.pointer = { x: 1280, y: 720 };
  const corner = nav.step(1 / 60, 1280, 720);
  expect(corner[0]).toBeLessThan(0); expect(corner[1]).toBeLessThan(0);
  expect(Math.hypot(...corner)).toBeCloseTo(10);
  nav.pointer = { x: -1, y: 360 };
  expect(nav.step(1 / 60, 1280, 720)).toEqual([0, 0]);
  nav.key('ArrowUp', true); nav.pointer = { x: 0, y: 0 }; nav.clear();
  expect(nav.step(1, 1280, 720)).toEqual([0, 0]);
});

test('panning is frame-rate independent and caps long background frame gaps', () => {
  const nav = new AirMapNavigation(); nav.key('ArrowDown', true);
  const distance = (fps: number) => Array.from({ length: fps }, () => nav.step(1 / fps, 1280, 720)[1]).reduce((a, b) => a + b, 0);
  expect(distance(30)).toBeCloseTo(distance(144));
  expect(nav.step(10, 1280, 720)).toEqual([0, -30]);
});
