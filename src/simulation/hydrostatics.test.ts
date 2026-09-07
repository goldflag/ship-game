import { expect, test } from 'bun:test';
import type { Hull } from '../ships/blueprint';
import { shipPreset, shipPresets } from '../ships/presets';
import { flotation, hydrostatics } from './hydrostatics';

// Keep the full moment calculation as an independent reference for each trial.
function referenceFlotation(hull: Hull, volume: number, roll: number, pitch: number) {
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

test('volume-only flotation trials preserve every result of full moment trials', () => {
  for (const id of Object.keys(shipPresets)) {
    const hull = shipPreset(id).hull, dry = hydrostatics(hull).volume;
    for (const [roll, pitch] of [[0, 0], [.25, -.1], [-.7, .3], [Math.PI / 2, 0], [2.7, -.9], [Math.PI, Math.PI / 2]]) {
      for (const fraction of [0, .01, .6, 1, 1.4, 10]) {
        expect(flotation(hull, dry * fraction, roll, pitch)).toEqual(referenceFlotation(hull, dry * fraction, roll, pitch));
      }
    }
  }
});
