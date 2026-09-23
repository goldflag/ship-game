import { describe, expect, test } from 'bun:test';
import type { WaveCascadeInfo, WaveParameters } from '../contracts';
import { activeModes, referenceTexel } from './reference';
import { drawnSea } from './seaState';
import { buildSpectrum } from './spectrum';
import { type CascadeBreaking, cascadeBreaking, normalQuantile, setBreakingThresholds, whitecapCoverage, whitecapDepth, windrowCoverage } from './whitecaps';

const sea = (overrides: Partial<WaveParameters> = {}): WaveParameters => ({
  significantHeight: 4, windSpeed: 15, windDirection: .6, peakWavelength: 53, choppiness: 1.55,
  gamma: 2.6, directionalSharpness: .8, seed: 7, dirty: true, ...overrides,
});
/** Small tiles keep the explicit DFT fast while keeping three bands. */
const SMALL: WaveCascadeInfo[] = [{ size: 256, resolution: 32 }, { size: 41, resolution: 32 }, { size: 7.3, resolution: 32 }];

describe('whitecaps', () => {
  test('coverage follows Monahan & O\'Muircheartaigh above the onset and none below it', () => {
    expect(whitecapCoverage(0)).toBe(0);
    expect(whitecapCoverage(3.4)).toBe(0);
    for (const wind of [6, 9, 15, 25, 30]) expect(whitecapCoverage(wind)).toBeCloseTo(3.84e-6 * wind ** 3.41, 12);
    let previous = 0;
    for (let wind = 0; wind <= 40; wind += .5) {
      expect(whitecapCoverage(wind)).toBeGreaterThanOrEqual(previous);
      previous = whitecapCoverage(wind);
    }
    // Windrows are part of the coverage: none below a near gale, a small share of it in a storm.
    expect(windrowCoverage(12)).toBe(0);
    expect(windrowCoverage(25)).toBeGreaterThan(0);
    expect(windrowCoverage(30)).toBeLessThan(.1 * whitecapCoverage(30));
  });

  test('the normal quantile matches tabulated values', () => {
    // Φ(z) for z = −5 … 2.
    for (const [z, p] of [[-5, 2.866515718791939e-7], [-4, 3.1671241833119863e-5], [-3, 1.3498980316300946e-3], [-2, .022750131948179195],
      [-1, .15865525393145707], [0, .5], [1, .8413447460685429], [2, .9772498680518208]]) expect(normalQuantile(p)).toBeCloseTo(z, 7);
  });

  test('the breaking indicator is standard normal over any whole tile, whatever the sea', () => {
    // Compression along the wind and the forward-face slope are in quadrature for every travelling mode, and distinct
    // lattice modes are orthogonal over a periodic tile, so the indicator's tile variance is exactly the CPU spectrum's.
    const seas = [sea(), sea({ windDirection: 2.3, choppiness: 2.25 }), drawnSea(sea({ windSpeed: 25, significantHeight: 8.8, peakWavelength: 62 }), true),
      sea({ windSpeed: 9, significantHeight: 1.8, peakWavelength: 32, choppiness: 1.1, directionalSharpness: 2 })];
    for (const params of seas) {
      const spectrum = buildSpectrum(SMALL, params), breaking = cascadeBreaking(spectrum, Math.cos(params.windDirection), Math.sin(params.windDirection), params.choppiness);
      const wx = Math.cos(params.windDirection), wz = Math.sin(params.windDirection);
      spectrum.cascades.forEach((cascade, c) => {
        const modes = activeModes(cascade), n = cascade.resolution, { compression, face } = breaking[c];
        for (const phase of [0, .37]) {
          let sum = 0, square = 0;
          for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
            const t = referenceTexel(cascade, modes, params.choppiness, phase, x, z);
            const squeeze = -(wx * wx * t.dxx + 2 * wx * wz * t.dxz + wz * wz * t.dzz), slope = -(t.hx * wx + t.hz * wz);
            const indicator = compression * squeeze + face * slope;
            sum += indicator; square += indicator * indicator;
          }
          expect(Math.abs(sum / (n * n))).toBeLessThan(1e-6);
          expect(square / (n * n)).toBeCloseTo(1, 4);
        }
      });
      expect(breaking.reduce((total, b) => total + b.share, 0)).toBeCloseTo(1, 9);
    }
  });

  test('breaking waves lie near the sea\'s own wavelengths, not on ripples', () => {
    const spectrum = buildSpectrum(SMALL, sea()), breaking = cascadeBreaking(spectrum, 1, 0, 1.55);
    // The 7 m tile holds waves under 5 m, most of which fold without whitecaps.
    expect(breaking[2].share).toBeLessThan(.05);
    expect(breaking[0].share + breaking[1].share).toBeGreaterThan(.95);
    // Foam lives in periods of the waves that broke: the coarse cascade's are the longer.
    expect(breaking[0].period).toBeGreaterThan(breaking[1].period);
  });

  test('thresholds follow each cascade\'s share and hand on what a capped cascade cannot carry', () => {
    const cascades = (...shares: number[]): CascadeBreaking[] => shares.map(share => ({ compression: 1, face: 1, threshold: Infinity, share, period: 4 }));
    const light = cascades(.2, .8, 0);
    setBreakingThresholds(light, whitecapDepth(9));
    expect(light[2].threshold).toBe(Infinity);
    // The larger share breaks more often: its threshold sits lower.
    expect(light[1].threshold).toBeLessThan(light[0].threshold);
    const calm = cascades(.2, .8, 0);
    setBreakingThresholds(calm, whitecapDepth(3));
    expect(calm.every(c => c.threshold === Infinity)).toBe(true);
    // A storm crowding its breakers into one cascade: that one breaks over half its crests at most, the other takes more.
    const crowded = cascades(.3, .7, 0), uncapped = cascades(.3, .7, 0);
    setBreakingThresholds(crowded, 1.4);
    setBreakingThresholds(uncapped, .5);
    expect(crowded[1].threshold).toBeCloseTo(0, 9);
    expect(crowded[0].threshold).toBeLessThan(uncapped[0].threshold);
    // More wind, more breaking, at every cascade.
    const [gale, storm] = [cascades(.4, .6), cascades(.4, .6)];
    setBreakingThresholds(gale, whitecapDepth(15)); setBreakingThresholds(storm, whitecapDepth(25));
    gale.forEach((c, i) => expect(storm[i].threshold).toBeLessThan(c.threshold));
  });
});
