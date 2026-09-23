import { expect, test } from 'bun:test';
import type { Vec3 } from './blueprint';
import { bandCutHolds, endCap, spanCut, starFold } from './customHullSpans';

/** Port half from the deck edge down, mirrored with a centreline keel, at station z. */
const ring = (half: [number, number][], keelY: number, z: number): Vec3[] => [
  ...half.map(([x, y]) => [-x, y, z] as Vec3),
  [0, keelY, z],
  ...half.slice().reverse().map(([x, y]) => [x, y, z] as Vec3),
];
const heights = (a: Vec3[], b: Vec3[]): [number[], number[]] => [a.map(p => p[1]), b.map(p => p[1])];
// Flare over a narrow waist over a wider forefoot: not star-shaped about any single point.
const wine: [number, number][] = [[5, 2], [0.5, 1], [4, -1], [4, -2]];
const box: [number, number][] = [[5, 2], [5, 1], [5, -1], [5, -2]];

test('a star-shaped span keeps the star cut and a wine-glass span takes the band cut', () => {
  const [a, b] = [ring(box, -2, 0), ring(box, -2, 5)];
  expect(spanCut(a, b, heights(a, b))).toEqual({ cut: 'star' });
  const [c, d] = [ring(wine, -2, 0), ring(wine, -2, 5)];
  expect(starFold(c, d)).toBeDefined();
  expect(spanCut(c, d, heights(c, d))).toEqual({ cut: 'bands' });
});

test('a side whose height climbs back up has no band cut and keeps the star rejection', () => {
  const climbing: [number, number][] = [[5, 2], [0.5, 2.5], [4, -1], [4, -2]];
  const [a, b] = [ring(climbing, -2, 0), ring(climbing, -2, 5)];
  expect(bandCutHolds(a, b, heights(a, b))).toBe(false);
  const cut = spanCut(a, b, heights(a, b));
  expect(cut.cut).toBe('fold');
  expect(cut.cut === 'fold' && cut.label).toMatch(/outline point|cap/);
});

test('a thin keel sliver between a flat keel plate and a shallow V is carried with the band above', () => {
  const flat: [number, number][] = [[2.7, 7], [1.6, 4.8], [0.7, 2.4], [0.35, 0], [0.3, -2.5], [0.4, -5], [0.9, -7.5], [0.5, -9.93]];
  const vee: [number, number][] = [[3.2, 6.7], [1.9, 4.6], [0.9, 2.3], [0.5, -0.2], [0.46, -2.7], [0.7, -5.2], [1.35, -7.6], [0.8, -9.91]];
  const [a, b] = [ring(flat, -9.93, 0), ring(vee, -9.93, 2)];
  expect(spanCut(a, b, heights(a, b))).toEqual({ cut: 'bands' });
});

test('banded end caps cover the same area as the fan, with two triangles per band', () => {
  const r = ring(wine, -2, 0);
  const area = (faces: Vec3[][]) => faces.reduce((sum, [p, q, s]) => sum + Math.abs((q[0] - p[0]) * (s[1] - p[1]) - (s[0] - p[0]) * (q[1] - p[1])) / 2, 0);
  const banded = endCap(r, true, true);
  // The keel band of a flat bottom is a straight line and has no area.
  expect(banded).toHaveLength(6);
  const [p, q, s] = banded[0];
  // Bow caps face forward (−z).
  expect((q[0] - p[0]) * (s[1] - p[1]) - (q[1] - p[1]) * (s[0] - p[0])).toBeLessThan(0);
  const shoelace = Math.abs(r.reduce((sum, v, i) => sum + v[0] * r[(i + 1) % r.length][1] - r[(i + 1) % r.length][0] * v[1], 0)) / 2;
  expect(area(banded)).toBeCloseTo(shoelace, 9);
  expect(area(endCap(r, true, false))).toBeGreaterThan(shoelace);
});
