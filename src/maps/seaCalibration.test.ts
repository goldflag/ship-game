import { expect, test } from 'bun:test';
import { OCEAN_MAPS, oceanMap } from './catalog';
import { battleEnvironment } from './conditions';
import { createSeaState, seaHeight } from '../game/session/sea';

const heightFromAmplitude = (amplitude: number) => 4 * Math.sqrt((.7 ** 2 + .3 ** 2) / 2) * amplitude;

test('representative open-sea heights reach the CPU sea in metres, independently of FFT gain', () => {
  for (const [wind, target] of [[0, 0], [6, .9], [9, 1.8], [10.5, 2.25], [12, 2.7], [18, 5.5], [25, 8.8], [30, 11.3]]) {
    for (const map of OCEAN_MAPS) {
      const waves = battleEnvironment(map, 'map', 'map', { windSpeed: wind }).waves;
      expect(waves.significantHeightM).toBeCloseTo(target * map.water.amplitudeScale, 10);
      const cpu = createSeaState(map.id, 'map', 42, wind);
      expect(heightFromAmplitude(cpu.amplitudeM)).toBeCloseTo(waves.significantHeightM, 10);
      expect(cpu.windMps).toBe(wind);
      expect(cpu.wavelengthM).toBe(waves.peakWavelength * 4);
    }
  }
});

test('height grows continuously over the full slider range and calm water has no foam source', () => {
  for (const map of OCEAN_MAPS) {
    let previous = 0;
    for (let wind = 0; wind <= 30; wind += .125) {
      const waves = battleEnvironment(map, 'map', 'map', { windSpeed: wind }).waves;
      expect(Object.values(waves).every(Number.isFinite)).toBe(true);
      expect(waves.significantHeightM).toBeGreaterThanOrEqual(previous);
      expect(waves.significantHeightM - previous).toBeLessThan(.1);
      expect(waves.amplitude).toBeGreaterThanOrEqual(0);
      previous = waves.significantHeightM;
    }
    const calm = battleEnvironment(map, 'map', 'map', { windSpeed: 0 }).waves;
    expect(calm.amplitude).toBe(0); expect(calm.crestFoam).toBe(0); expect(calm.windwardFoam).toBe(0);
  }
});

test('the deterministic CPU surface has the requested height variance and remains seed-repeatable', () => {
  const sea = createSeaState('north-atlantic', 'map', 42, 18);
  const same = createSeaState('north-atlantic', 'map', 42, 18);
  const heights = Array.from({ length: 16384 }, (_, i) => seaHeight(sea, (i % 128) * 31, Math.floor(i / 128) * 37, 60));
  const mean = heights.reduce((a, b) => a + b, 0) / heights.length;
  const actual = 4 * Math.sqrt(heights.reduce((a, b) => a + (b - mean) ** 2, 0) / heights.length);
  expect(actual).toBeCloseTo(battleEnvironment(oceanMap('north-atlantic'), 'map', 'map', { windSpeed: 18 }).waves.significantHeightM, 1);
  expect(seaHeight(same, 100, 200, 60)).toBe(seaHeight(sea, 100, 200, 60));
  expect(createSeaState('north-atlantic', undefined, 42).amplitudeM).toBe(0);
});
