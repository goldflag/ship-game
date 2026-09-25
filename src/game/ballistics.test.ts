import { expect, test } from 'bun:test';
import { ballisticStep, ballisticStepInto, solveDragArc, travelFactor } from './ballistics';
import { length, scale, sub } from './geometry';
import type { Vec3 } from '../ships/blueprint';

// Independent, deliberately slow reference: locate the minimum required speed,
// then bisect only the low arc. Includes unreachable, steep and near-range shots.
function reference(target: Vec3, speed: number, drag: number) {
  const error = (time: number) => {
    const factor = travelFactor(time, drag);
    const drop = -ballisticStep([0, 0, 0], [0, 0, 0], time, drag).position[1];
    return (target[0] ** 2 + target[2] ** 2 + (target[1] + drop) ** 2) / factor ** 2 - speed ** 2;
  };
  let a = .0001, b = 180;
  for (let i = 0; i < 80; i++) {
    const left = (2 * a + b) / 3, right = (a + 2 * b) / 3;
    if (error(left) < error(right)) b = right; else a = left;
  }
  let low = .0001, high = (a + b) / 2;
  if (error(high) > 0) return null;
  for (let i = 0; i < 60; i++) { const mid = (low + high) / 2; if (error(mid) > 0) low = mid; else high = mid; }
  return (low + high) / 2;
}

test('fast drag aim matches an independent low-arc solution and rejects unreachable shots', () => {
  for (const speed of [100, 400, 820, 1200]) for (const drag of [.00001, .005, .02, .1, .5]) {
    for (const range of [1, 30, 300, 1200, 5000, 15000, 30000]) for (const height of [-2000, -20, 0, 300, 8000]) {
      const target: Vec3 = [range, height, range * .2], expected = reference(target, speed, drag);
      const actual = solveDragArc([0, 0, 0], target, speed, drag);
      expect(actual === null).toBe(expected === null);
      if (!actual || expected === null) continue;
      expect(Math.abs(actual.time - expected)).toBeLessThan(1e-7);
      expect(length(sub(ballisticStep([0, 0, 0], scale(actual.direction, speed), actual.time, drag).position, target))).toBeLessThan(.0001);
    }
  }
});

test('the in-place ballistic step stores exactly what ballisticStep returns', () => {
  let seed = 5;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  const out = new Float64Array(6);
  for (let i = 0; i < 5000; i++) {
    const position: Vec3 = [(random() - .5) * 1e4, random() * 3000, (random() - .5) * 1e4], velocity: Vec3 = [(random() - .5) * 900, (random() - .5) * 900, -0];
    const seconds = i % 11 ? random() * 12 : 0, drag = i % 3 ? random() * 2 : i % 2 ? 1e-9 : 0;
    const { position: p, velocity: v } = ballisticStep(position, velocity, seconds, drag);
    ballisticStepInto(out, position, velocity, seconds, drag);
    expect([...out].map(x => Object.is(x, -0) ? '-0' : x)).toEqual([...p, ...v].map(x => Object.is(x, -0) ? '-0' : x));
  }
});
