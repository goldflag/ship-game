import { expect, test } from 'bun:test';
import { FlagCloth } from './FlagCloth';

function settle(wind: number[], dt = 1 / 60, seconds = 5) {
  const cloth = new FlagCloth(4, 2);
  for (let i = 0; i < Math.round(seconds / dt); i++) cloth.advance(dt, wind);
  return cloth;
}
const tip = (c: FlagCloth) => Array.from(c.positions.slice(c.columns * 3, c.columns * 3 + 3));

test('calm fabric hangs under gravity; wind extends it and a reversal carries it the other way', () => {
  const calm = settle([0, 0, 0]);
  expect(tip(calm)[1]).toBeLessThan(-2.5);
  const windy = settle([14, 0, 0]);
  expect(tip(windy)[0]).toBeGreaterThan(3);
  for (let i = 0; i < 360; i++) windy.advance(1 / 60, [-14, 0, 0]);
  expect(tip(windy)[0]).toBeLessThan(-3);
});

test('storm gusts keep the hoist fixed, positions finite and fabric within its tether', () => {
  const cloth = settle([32, 0, 25], 1 / 30, 8);
  for (let y = 0; y <= cloth.rows; y++) {
    const i = y * (cloth.columns + 1) * 3;
    expect(Array.from(cloth.positions.slice(i, i + 3))).toEqual([0, -y / cloth.rows * cloth.height || 0, 0].map(Math.fround));
  }
  expect(cloth.positions.every(Number.isFinite)).toBe(true);
  for (let i = 0; i < cloth.positions.length; i += 3) expect(Math.hypot(...cloth.positions.slice(i, i + 3))).toBeLessThan(6.3);
});

test('fixed cloth steps agree across display rates and pause does not advance particles', () => {
  const a = settle([9, 0, 3], 1 / 30, 2), b = settle([9, 0, 3], 1 / 120, 2);
  expect(a.positions).toEqual(b.positions);
  const paused = a.positions.slice();
  for (let i = 0; i < 60; i++) a.advance(0, [-20, 0, 0]);
  expect(a.positions).toEqual(paused);
  a.reset(); expect(a.positions).toEqual(new FlagCloth(4, 2).positions);
});
