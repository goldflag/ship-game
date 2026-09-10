import { expect, test } from 'bun:test';
import { shipPreset, shipPresets } from '../ships/presets';
import { flotation, hydrostatics } from './hydrostatics';
import type { Hull } from '../ships/blueprint';

// Independent reference: retain the original full moment integration at every
// bisection trial, including its iteration count and bounds.
function reference(hull: Hull, volume: number, roll: number, pitch: number) {
  const bound = hull.length + hull.beam + hull.draft + hull.depth;
  const full = hydrostatics(hull, -bound, roll, pitch);
  if (volume >= full.volume) return { ...full, y: -bound, afloat: false };
  let low = -bound, high = bound;
  for (let i = 0; i < 27; i++) {
    const y = (low + high) / 2;
    if (hydrostatics(hull, y, roll, pitch).volume > volume) low = y; else high = y;
  }
  const y = (low + high) / 2;
  return { ...hydrostatics(hull, y, roll, pitch), y, afloat: true };
}

test('flotation matches full clipped moments across fleet hulls, heel, trim and immersion', () => {
  for (const id of Object.keys(shipPresets)) {
    const { hull } = shipPreset(id);
    for (const [roll, pitch] of [[0, 0], [.17, -.06], [-.6, .3], [2.1, -.8], [0, Math.PI / 2]]) {
      const full = hydrostatics(hull, -(hull.length + hull.beam + hull.draft + hull.depth), roll, pitch).volume;
      for (const fraction of [.001, .2, .5, .95, 1, 1.1]) {
        const actual = flotation(hull, full * fraction, roll, pitch);
        const expected = reference(hull, full * fraction, roll, pitch);
        expect(actual).toEqual(expected);
      }
    }
  }
});
