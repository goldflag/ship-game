import { expect, test } from 'bun:test';
import { smoothMapPath } from './smoothMapPath';
import type { Vec3 } from '../ships/blueprint';

test('display routes round bends inside their legs and preserve endpoints and orders', () => {
  const points: Vec3[] = [[0, 0, 0], [1000, 0, 0], [1000, 0, 1000]];
  const original = JSON.stringify(points), rounded = smoothMapPath(points);
  expect(rounded[0]).toEqual(points[0]);
  expect(rounded.at(-1)).toEqual(points.at(-1));
  expect(rounded.some(([x, , z]) => x > 750 && x < 1000 && z > 0 && z < 250)).toBe(true);
  expect(rounded.every(p => p.every(Number.isFinite) && p[0] >= 0 && p[0] <= 1000 && p[2] >= 0 && p[2] <= 1000)).toBe(true);
  expect(JSON.stringify(points)).toBe(original);
});

test('closed formation outlines round every corner, including the seam', () => {
  const rounded = smoothMapPath([[0, 0, 0], [1000, 0, 0], [1000, 0, 1000], [0, 0, 1000]], true);
  expect(rounded).toHaveLength(52);
  expect(rounded[0]).toEqual([0, 0, 250]);
  expect(rounded.at(-1)).toEqual([0, 0, 750]);
  expect(smoothMapPath([[0, 0, 0], [0, 0, 0], [1, 0, 0]]).flat().every(Number.isFinite)).toBe(true);
});
