import { expect, test } from 'bun:test';
import { ballisticStep, solveDragArc, travelFactor } from './ballistics';
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
