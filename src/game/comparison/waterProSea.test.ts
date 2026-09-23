import { expect, test } from 'bun:test';
import { OCEAN_MAPS, oceanMap } from '../../maps/catalog';
import { windSea } from '../../maps/seaCalibration';
import { WATER_PRO_BREAK_SCALE, waterProAmplitude, waterProSurfaceFoam } from './waterProSea';

test('each map\'s calibrated sea gets the FFT gain the game measured for it', () => {
  const measured = { 'north-atlantic': 1.31107611, 'pacific-islands': 1.07365788, 'arctic-passage': 1.01263973, 'indian-volcanic-coast': 1.27286961 };
  for (const map of OCEAN_MAPS) {
    expect(waterProAmplitude(windSea(map, 9).significantHeightM, 9)).toBeCloseTo(measured[map.id], 9);
    // Between samples the gain follows the wind as the retired windSea() did.
    const sea = windSea(map, 10.5);
    expect(waterProAmplitude(sea.significantHeightM, sea.windSpeed)).toBeCloseTo((measured[map.id] + waterProAmplitude(windSea(map, 12).significantHeightM, 12)) / 2, 9);
  }
  expect(waterProAmplitude(windSea(oceanMap('north-atlantic'), 25).significantHeightM, 25)).toBeCloseTo(2.801379, 9);
  expect(waterProAmplitude(windSea(oceanMap('arctic-passage'), 30).significantHeightM, 30)).toBeCloseTo(1.97040204, 9);
  expect(waterProAmplitude(windSea(oceanMap('pacific-islands'), 3).significantHeightM, 3)).toBeCloseTo(.30090704, 9);
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
