import { expect, test } from 'bun:test';
import { OCEAN_MAPS, oceanMap } from '../../maps/catalog';
import { windSea } from '../../maps/seaCalibration';
import { WATER_PRO_BREAK_SCALE, waterProAmplitude, waterProSurfaceFoam } from './waterProSea';

/** The gains measured at 9 m/s, by the amplitude scale of the sea they were measured on. */
const MEASURED_AT_9 = [[1, 1.31107611], [.65, 1.07365788], [.6, 1.01263973], [1.05, 1.27286961]] as const;

test('each measured sea gets the FFT gain the game measured for it', () => {
  for (const [amplitudeScale, gain] of MEASURED_AT_9) {
    expect(waterProAmplitude(1.8 * amplitudeScale, 9)).toBeCloseTo(gain, 9);
    // Between samples the gain follows the wind as the retired windSea() did.
    expect(waterProAmplitude(2.25 * amplitudeScale, 10.5)).toBeCloseTo((gain + waterProAmplitude(2.7 * amplitudeScale, 12)) / 2, 9);
  }
  expect(waterProAmplitude(8.8, 25)).toBeCloseTo(2.801379, 9);
  expect(waterProAmplitude(11.3 * .6, 30)).toBeCloseTo(1.97040204, 9);
  expect(waterProAmplitude(.15 * .65, 3)).toBeCloseTo(.30090704, 9);
});

test('every map\'s sea borrows the nearest measured sea\'s gain, scaled to its own height', () => {
  const nearest = { 'north-atlantic': 0, 'iron-bottom-sound': 1, 'vestfjord': 2, 'sunda-strait': 1, 'strait-of-dover': 0 } as const;
  for (const map of OCEAN_MAPS) {
    const [scale, gain] = MEASURED_AT_9[nearest[map.id]];
    expect(waterProAmplitude(windSea(map, 9).significantHeightM, 9)).toBeCloseTo(gain * map.water.amplitudeScale / scale, 9);
  }
  // Iron Bottom Sound and Vestfjord sail the measured Pacific and Arctic seas exactly.
  expect(waterProAmplitude(windSea(oceanMap('iron-bottom-sound'), 9).significantHeightM, 9)).toBeCloseTo(1.07365788, 9);
  expect(waterProAmplitude(windSea(oceanMap('vestfjord'), 30).significantHeightM, 30)).toBeCloseTo(1.97040204, 9);
});

test('a flat sea has no amplitude and a height off the calibration scales its map\'s gain', () => {
  expect(waterProAmplitude(0, 9)).toBe(0);
  expect(waterProAmplitude(0, 0)).toBe(0);
  expect(waterProAmplitude(1, 0)).toBe(0);
  // 1.836 m at 9 m/s is nearest the North Atlantic's 1.8 m.
  expect(waterProAmplitude(1.836, 9)).toBeCloseTo(1.02 * 1.31107611, 9);
  expect(waterProAmplitude(1.8, 40)).toBeCloseTo(waterProAmplitude(1.8, 30), 12);
});

test('surface foam and the wake breaking slope keep the values the game gave Water Pro', () => {
  expect(waterProSurfaceFoam(3)).toEqual({ opacity: 0, coverage: .18 });
  expect(waterProSurfaceFoam(9).opacity).toBeCloseTo(.04, 12);
  expect(waterProSurfaceFoam(25).opacity).toBeCloseTo(.08, 12);
  expect(.015 * WATER_PRO_BREAK_SCALE).toBeCloseTo(.09, 12);
});
