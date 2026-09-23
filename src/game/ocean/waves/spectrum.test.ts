import { describe, expect, test } from 'bun:test';
import type { WaveCascadeInfo, WaveParameters } from '../contracts';
import { OCEAN_TIERS } from '../quality';
import { activeModes, referenceTexel } from './reference';
import { FOLD_PERIOD, GRAVITY, buildSpectrum, cascadeBands, jonswap, modeHash, seaSpectrum, spectrumLevel } from './spectrum';

const sea = (overrides: Partial<WaveParameters> = {}): WaveParameters => ({
  significantHeight: 1.8, windSpeed: 9, windDirection: .6, peakWavelength: 32, choppiness: 1.2,
  gamma: 2.6, directionalSharpness: .8, seed: 1, dirty: true, ...overrides,
});
/** Small tiles keep the explicit DFT checks fast while keeping three bands. */
const SMALL: WaveCascadeInfo[] = [{ size: 256, resolution: 32 }, { size: 41, resolution: 32 }, { size: 7.3, resolution: 32 }];

describe('wave spectrum', () => {
  test('is deterministic per seed and differs between seeds', () => {
    const a = buildSpectrum(OCEAN_TIERS.high.cascades, sea()), b = buildSpectrum(OCEAN_TIERS.high.cascades, sea());
    const c = buildSpectrum(OCEAN_TIERS.high.cascades, sea({ seed: 2 }));
    a.cascades.forEach((cascade, i) => {
      expect(cascade.amplitudes).toEqual(b.cascades[i].amplitudes);
      expect(cascade.amplitudes).not.toEqual(c.cascades[i].amplitudes);
    });
  });

  test('large seeds keep neighbouring phases independent', () => {
    for (const seed of [1941, 2 ** 31 - 1, 1e9, -7, 2 ** 40 + 3]) {
      const spectrum = buildSpectrum(OCEAN_TIERS.high.cascades, sea({ seed }));
      for (const cascade of spectrum.cascades) {
        const { amplitudes: a, resolution: n } = cascade;
        let pairs = 0, repeats = 0, correlation = 0;
        for (let z = 0; z < n; z++) for (let x = 0; x + 1 < n; x++) {
          const i = (z * n + x) * 4, j = i + 4;
          if (!(a[i] || a[i + 1]) || !(a[j] || a[j + 1])) continue;
          const d = Math.atan2(a[i + 1], a[i]) - Math.atan2(a[j + 1], a[j]);
          pairs++; correlation += Math.cos(d);
          if (Math.abs(Math.sin(d / 2)) < 1e-6) repeats++;
        }
        expect(pairs).toBeGreaterThan(1000);
        expect(repeats).toBe(0);
        // Independent phases: the mean of cos Δφ is within a few standard errors of zero.
        expect(Math.abs(correlation / pairs)).toBeLessThan(5 / Math.sqrt(pairs));
      }
      const hashes = new Set<number>();
      for (let x = -64; x < 64; x++) for (let z = 0; z < 64; z++) hashes.add(modeHash(seed, 0, x, z));
      expect(hashes.size).toBe(128 * 64);
    }
  });

  test('bands are contiguous and disjoint, and every mode lies in its band', () => {
    for (const tier of Object.values(OCEAN_TIERS)) {
      const bands = cascadeBands(tier.cascades);
      bands.forEach((band, i) => {
        expect(band.lo).toBeLessThan(band.hi);
        if (i) expect(band.lo).toBe(bands[i - 1].hi);
      });
      const spectrum = buildSpectrum(tier.cascades, sea({ peakWavelength: 12 }));
      for (const cascade of spectrum.cascades) {
        const modes = activeModes(cascade);
        expect(modes.length).toBeGreaterThan(0);
        for (let i = 0; i < modes.length; i += 5) {
          const k = Math.hypot(modes[i], modes[i + 1]);
          expect(k).toBeGreaterThanOrEqual(cascade.lo);
          expect(k).toBeLessThan(cascade.hi);
        }
      }
    }
  });

  test('significant height is exact at every instant over whole tiles', () => {
    for (const [height, wavelength] of [[.05, 6.4], [1.8, 32], [11.3, 110]]) {
      const spectrum = buildSpectrum(SMALL, sea({ significantHeight: height, peakWavelength: wavelength }));
      // Exact up to the float32 amplitudes the GPU receives.
      expect(4 * Math.sqrt(spectrum.cascades.reduce((sum, c) => sum + c.variance, 0)) / height).toBeCloseTo(1, 7);
      // The cascades are independent bands, so the tile variances add; check each one explicitly.
      for (const phase of [0, .137, .61]) {
        let variance = 0;
        for (const cascade of spectrum.cascades) {
          const modes = activeModes(cascade), n = cascade.resolution;
          let sum = 0;
          for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) sum += referenceTexel(cascade, modes, 1, phase, x, z).dy ** 2;
          variance += sum / (n * n);
        }
        expect(4 * Math.sqrt(variance) / height).toBeCloseTo(1, 7);
      }
    }
  });

  test('realistic tiers normalise across the game sea range', () => {
    for (const tier of Object.values(OCEAN_TIERS)) for (const [height, wavelength] of [[.05, 6.4], [.9, 21], [4, 53], [11.3, 110]]) {
      const spectrum = buildSpectrum(tier.cascades, sea({ significantHeight: height, peakWavelength: wavelength }));
      const variance = spectrum.cascades.reduce((sum, c) => sum + c.variance, 0);
      expect(4 * Math.sqrt(variance) / height).toBeCloseTo(1, 7);
      expect(Number.isFinite(spectrum.maxHeight) && spectrum.maxHeight > height / 2).toBe(true);
      // The tail tops the drawn slopes up to Cox–Munk's total at the 9 m/s test wind, never beyond.
      expect(spectrum.tailSlopeVariance).toBeGreaterThanOrEqual(0);
      expect(spectrum.tailSlopeVariance).toBeLessThanOrEqual(.003 + .00512 * 9);
      if (height < .1) expect(spectrum.tailSlopeVariance).toBeGreaterThan(.01);
    }
  });

  test('steep seas hold their short waves at the saturation level', () => {
    // The 25 m/s calibration (Hs 8.8 m at λp 62 m) is several times steeper than a developed sea:
    // its drawn slopes stay near Cox–Munk's measured total instead of a JONSWAP scaled to its height.
    const storm = buildSpectrum(OCEAN_TIERS.high.cascades, sea({ significantHeight: 8.8, peakWavelength: 62.2, windSpeed: 25 }));
    expect(storm.cascades.reduce((sum, c) => sum + c.slopeVariance, 0)).toBeLessThan(1.5 * (.003 + .00512 * 25));
    // A gentle sea is below saturation everywhere: the drawn spectrum is JONSWAP itself.
    const peak = Math.sqrt(GRAVITY * 2 * Math.PI / 10.67), level = spectrumLevel(peak, 2.6, (.15 / 4) ** 2);
    for (const ratio of [.8, 1, 2, 4, 8]) expect(seaSpectrum(ratio * peak, peak, 2.6, level) / jonswap(ratio * peak, peak, 2.6)).toBeCloseTo(level, 12);
  });

  test('bounds hold against an explicit inverse DFT', () => {
    const spectrum = buildSpectrum(SMALL, sea({ significantHeight: 3, peakWavelength: 20, choppiness: 1.4 }));
    let height = 0, horizontal = 0;
    for (const phase of [0, .01, .3, .77]) for (let z = 0; z < 32; z += 3) for (let x = 0; x < 32; x += 3) {
      // The bound covers any sum of one point per tile, so the tiles need not share a position.
      const fields = spectrum.cascades.map(c => referenceTexel(c, activeModes(c), 1.4, phase, x, z));
      height = Math.max(height, Math.abs(fields.reduce((sum, f) => sum + f.dy, 0)));
      horizontal = Math.max(horizontal, Math.hypot(fields.reduce((sum, f) => sum + f.dx, 0), fields.reduce((sum, f) => sum + f.dz, 0)));
    }
    expect(height).toBeGreaterThan(.5);
    expect(height).toBeLessThanOrEqual(spectrum.maxHeight);
    expect(horizontal).toBeLessThanOrEqual(spectrum.maxHorizontalDisplacement);
  });

  test('zero height is flat', () => {
    for (const overrides of [{ significantHeight: 0 }, { significantHeight: 0, windSpeed: 0 }, { peakWavelength: 0 }]) {
      const spectrum = buildSpectrum(OCEAN_TIERS.medium.cascades, sea(overrides));
      expect(spectrum.maxHeight).toBe(0);
      expect(spectrum.maxHorizontalDisplacement).toBe(0);
      expect(spectrum.tailSlopeVariance).toBe(0);
      for (const cascade of spectrum.cascades) expect(cascade.amplitudes.every(v => v === 0)).toBe(true);
    }
  });

  test('quantised frequencies stay within 1% of deep-water dispersion', () => {
    const spectrum = buildSpectrum(OCEAN_TIERS.ultra.cascades, sea({ peakWavelength: 110 }));
    let worst = 0;
    for (const cascade of spectrum.cascades) {
      const modes = activeModes(cascade);
      for (let i = 0; i < modes.length; i += 5) {
        const exact = Math.sqrt(GRAVITY * Math.hypot(modes[i], modes[i + 1]));
        worst = Math.max(worst, Math.abs(2 * Math.PI * Math.abs(modes[i + 4]) / FOLD_PERIOD - exact) / exact);
      }
    }
    expect(worst).toBeGreaterThan(0);
    expect(worst).toBeLessThan(.01);
  });

  test('waves travel toward the wind, more tightly with higher sharpness', () => {
    const spread = (sharpness: number) => {
      const spectrum = buildSpectrum(OCEAN_TIERS.high.cascades, sea({ windDirection: 2, directionalSharpness: sharpness }));
      let energy = 0, along = 0;
      for (const cascade of spectrum.cascades) {
        const modes = activeModes(cascade);
        for (let i = 0; i < modes.length; i += 5) if (modes[i + 4] > 0) {
          const e = modes[i + 2] ** 2 + modes[i + 3] ** 2, angle = Math.atan2(modes[i + 1], modes[i]);
          energy += e; along += e * Math.cos(angle - 2);
        }
      }
      return along / energy;
    };
    expect(spread(.8)).toBeGreaterThan(.5);
    expect(spread(2)).toBeGreaterThan(spread(.8));
    expect(spread(0)).toBeLessThan(.2);
  });
});
