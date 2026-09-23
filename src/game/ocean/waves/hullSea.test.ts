import { expect, test } from 'bun:test';
import type { HullFootprint, HullSeaWave } from '../contracts';
import { FADE_HULLS, FADE_WAVES, HULL_REACH, WAVE_REACH, coupledHeight, hullSeaBlend, hullSeaHeight, hullSeaSlot, hullSeaWavelength, hullSeaWeight,
  packHullSeaWave } from './hullSea';

const waves: HullSeaWave[] = [{ amplitude: 2.86, wavelength: 249, direction: .6, phase: 1.3 }, { amplitude: 1.23, wavelength: 142, direction: 1.4, phase: 3.3 }];
const battleship: HullFootprint = { x: 120, z: -40, bearing: .3, length: 250, beam: 36, contact: 1 };
const slot = hullSeaSlot(battleship, hullSeaWavelength(waves));
/** A point `along` metres toward the bow from the centre and `across` metres to its side. */
const at = (along: number, across: number) => [slot.x + slot.axisX * along - slot.axisZ * across, slot.z + slot.axisZ * along + slot.axisX * across] as const;

test('a hull is fully coupled along its waterline and out to its reach, and not at all beyond the fade', () => {
  expect(slot.inner).toBeCloseTo(Math.max(HULL_REACH * 250, WAVE_REACH * 249), 9);
  expect(slot.outer - slot.inner).toBeCloseTo(Math.max(FADE_HULLS * 250, FADE_WAVES * 249), 9);
  for (const [along, across] of [[0, 0], [125, 0], [-125, 0], [0, 18], [125 + slot.inner, 0], [-60, -slot.inner]])
    expect(hullSeaWeight([slot], ...at(along, across)).weight).toBeCloseTo(1, 12);
  for (const [along, across] of [[125 + slot.outer, 0], [0, slot.outer], [-125 - slot.outer - 1, 30], [900, 900]])
    expect(hullSeaWeight([slot], ...at(along, across)).weight).toBe(0);
  // Monotone and smooth across the fade, abeam and ahead alike.
  for (const direction of [[0, 1], [1, 0], [Math.SQRT1_2, Math.SQRT1_2]] as const) {
    let previous = 1;
    for (let r = 0; r < slot.outer + 200; r += 5) {
      const weight = hullSeaWeight([slot], ...at(125 * Math.sign(direction[0]) + r * direction[0], r * direction[1])).weight;
      expect(weight).toBeLessThanOrEqual(previous + 1e-12);
      previous = weight;
    }
  }
});

test('the weight gradient matches finite differences, for one hull and where two overlap', () => {
  const second = hullSeaSlot({ x: 420, z: 60, bearing: 2.1, length: 110, beam: 11, contact: .8 }, hullSeaWavelength(waves));
  for (const slots of [[slot], [slot, second]]) {
    for (let i = 0; i < 400; i++) {
      const x = -300 + (i * 97) % 1100, z = -500 + (i * 61) % 1000, h = 1e-3;
      const { weight, dx, dz } = hullSeaWeight(slots, x, z);
      expect(weight).toBeGreaterThanOrEqual(0); expect(weight).toBeLessThanOrEqual(1);
      expect(dx).toBeCloseTo((hullSeaWeight(slots, x + h, z).weight - hullSeaWeight(slots, x - h, z).weight) / (2 * h), 6);
      expect(dz).toBeCloseTo((hullSeaWeight(slots, x, z + h).weight - hullSeaWeight(slots, x, z - h).weight) / (2 * h), 6);
      // The union covers each hull at least as fully as the hull alone, and never passes 1.
      expect(weight).toBeGreaterThanOrEqual(Math.max(...slots.map(s => hullSeaWeight([s], x, z).weight)) - 1e-12);
    }
  }
});

test('contact scales a hull\'s coupling; none leaves the sea as drawn', () => {
  const half = hullSeaSlot({ ...battleship, contact: .5 }, 249), none = hullSeaSlot({ ...battleship, contact: 0 }, 249);
  expect(hullSeaWeight([half], battleship.x, battleship.z).weight).toBeCloseTo(.5, 12);
  expect(hullSeaWeight([none], battleship.x, battleship.z).weight).toBe(0);
});

test('the blend runs from the drawn sea to the combat sea and keeps the variance of seas of equal height between', () => {
  expect(hullSeaBlend(0)).toMatchObject({ lowpass: 0, sea: 0 });
  expect(hullSeaBlend(1).lowpass).toBeCloseTo(-1, 12); expect(hullSeaBlend(1).sea).toBeCloseTo(1, 12);
  for (let w = 0; w <= 1; w += .05) {
    const { lowpass, sea, dLowpass, dSea } = hullSeaBlend(w), h = 1e-6;
    // (1 + lowpass) of the drawn long waves stays: its square and the sea's sum to one.
    expect((1 + lowpass) ** 2 + sea ** 2).toBeCloseTo(1, 12);
    expect(dLowpass).toBeCloseTo((hullSeaBlend(w + h).lowpass - hullSeaBlend(w - h).lowpass) / (2 * h), 6);
    expect(dSea).toBeCloseTo((hullSeaBlend(w + h).sea - hullSeaBlend(w - h).sea) / (2 * h), 6);
  }
});

test('packed components reproduce the sea at any battle time and range in float32', () => {
  const origin = [15_000, -22_000] as const;
  for (const time of [0, 61.25, 1800.5, 3600]) for (const [dx, dz] of [[0, 0], [310, -470], [-900, 250]]) {
    const x = origin[0] + dx, z = origin[1] + dz;
    const packed = waves.map(wave => packHullSeaWave(wave, time, ...origin).map(Math.fround));
    // What the nodes evaluate: float32 wave vector and phase about the origin.
    const shader = packed.reduce((sum, [kx, kz, amplitude, phase]) => sum + amplitude * Math.sin(Math.fround(kx * Math.fround(dx) + kz * Math.fround(dz)) + phase), 0);
    expect(Math.abs(shader - hullSeaHeight(waves, time, x, z))).toBeLessThan(2e-4);
  }
  expect(packHullSeaWave({ amplitude: 1, wavelength: 0, direction: 0, phase: 0 }, 5, 0, 0)).toEqual([0, 0, 0, 0]);
});

test('at the hull the drawn height is the combat sea plus the drawn waves shorter than the split', () => {
  const time = 734.5;
  for (const [along, across] of [[0, 0], [110, 10], [-120, -15], [60, slot.inner]]) {
    const [x, z] = at(along, across), sea = hullSeaHeight(waves, time, x, z);
    // A drawn sea of long waves only is replaced outright; shorter waves (chop) ride on top.
    expect(coupledHeight(3.2, 3.2, [slot], waves, time, x, z)).toBeCloseTo(sea, 12);
    expect(coupledHeight(3.2 + .4, 3.2, [slot], waves, time, x, z)).toBeCloseTo(sea + .4, 12);
  }
  const [x, z] = at(0, slot.outer + 10);
  expect(coupledHeight(-1.7, -1.5, [slot], waves, time, x, z)).toBe(-1.7);
});
