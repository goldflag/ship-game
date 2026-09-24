import { describe, expect, test } from 'bun:test';
import { hashAt, noiseAt } from '../noise';
import { groupCut, groupLayout, groupShare, groupShownAt } from './groups';
import { GRAVITY } from './spectrum';
import { whitecapArea } from './whitecaps';

/** Deterministic points spread over many cells (an additive recurrence, no shared lattice with the noise's). */
function points(count: number, spread = 5000): [number, number][] {
  return Array.from({ length: count }, (_, i) => [((i * .7548776662) % 1) * spread - spread / 2, ((i * .5698402910) % 1) * spread - spread / 2]);
}

function correlation(a: number[], b: number[]): number {
  const n = a.length, ma = a.reduce((s, v) => s + v, 0) / n, mb = b.reduce((s, v) => s + v, 0) / n;
  let ab = 0, aa = 0, bb = 0;
  for (let i = 0; i < n; i++) { ab += (a[i] - ma) * (b[i] - mb); aa += (a[i] - ma) ** 2; bb += (b[i] - mb) ** 2; }
  return ab / Math.sqrt(aa * bb);
}

describe('world noise', () => {
  test('is uniform hashes interpolated smoothly: mean ½, deviation 0.214, continuous across cells', () => {
    const values = points(200_000).map(([x, y]) => noiseAt(x, y, 7));
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    const deviation = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...values)).toBeLessThan(1);
    expect(mean).toBeCloseTo(.5, 2);
    expect(deviation).toBeCloseTo(.214, 2);
    // At a lattice point it is that point's hash, from either side.
    expect(noiseAt(3, -4, 7)).toBeCloseTo(hashAt(3, -4, 7), 12);
    expect(noiseAt(3 - 1e-9, -4, 7)).toBeCloseTo(hashAt(3, -4, 7), 6);
  });
});

describe('breaking groups', () => {
  test('cover the share asked of them', () => {
    const values = points(200_000).map(([x, y]) => noiseAt(x, y, 101));
    for (const share of [.35, .5, .64, .8, 1]) {
      const cut = groupCut(share), shown = values.reduce((s, v) => s + groupShownAt(v, cut), 0) / values.length;
      expect(Math.abs(shown - share)).toBeLessThan(.01);
    }
  });

  test('two cells apart they are independent, so one tile\'s copies break apart; within a cell they are one group', () => {
    const cut = groupCut(.35), at = points(100_000, 400);
    const shown = (dx: number, dy: number) => at.map(([x, y]) => groupShownAt(noiseAt(x + dx, y + dy, 101), cut));
    const here = shown(0, 0);
    for (const [dx, dy] of [[2, 0], [0, 2], [-2.3, 1.1], [5.7, -3.2], [40, 40]]) expect(Math.abs(correlation(here, shown(dx, dy)))).toBeLessThan(.02);
    expect(correlation(here, shown(.25, 0))).toBeGreaterThan(.6);
  });

  test('widen with the wind so whitecaps never crowd a group, over every wind a battle has', () => {
    let previous = 0;
    for (let wind = 0; wind <= 30; wind += .5) {
      const area = whitecapArea(wind), share = groupShare(area);
      expect(share).toBeGreaterThanOrEqual(previous);
      expect(share).toBeGreaterThanOrEqual(.35);
      expect(share).toBeLessThanOrEqual(.8);
      expect(area / share).toBeLessThan(.5);
      previous = share;
    }
    expect(groupShare(whitecapArea(9))).toBe(.35);
    expect(groupShare(whitecapArea(30))).toBeGreaterThan(.6);
  });

  test('are a few breaking wavelengths across, run at the group velocity, and stay well inside a tile', () => {
    const period = 2.6, wavelength = GRAVITY * period ** 2 / (2 * Math.PI);
    const open = groupLayout(period, 10_000);
    expect(open.length).toBeCloseTo(2.5 * wavelength, 9);
    expect(open.width).toBeCloseTo(4 * wavelength, 9);
    expect(open.drift).toBeCloseTo(Math.sqrt(GRAVITY * wavelength / (2 * Math.PI)) / 2, 9);
    // Cells never pass 0.3 of the tile: its copies read cells at least three apart along some axis.
    for (const [p, tile] of [[2.6, 31], [5, 181], [9.3, 421], [10.4, 2947]]) {
      const layout = groupLayout(p, tile);
      expect(Math.max(layout.length, layout.width)).toBeLessThanOrEqual(.3 * tile + 1e-9);
    }
    expect(groupLayout(0, 181)).toEqual({ length: .3 * 181, width: .3 * 181, drift: 0 });
  });
});
