import { describe, expect, test } from 'bun:test';
import { OCEAN_MAPS } from '../../../maps/catalog';
import { windSea } from '../../../maps/seaCalibration';
import type { WaveCascadeInfo, WaveParameters } from '../contracts';
import { OCEAN_TIERS } from '../quality';
import { activeModes, referenceTexel } from './reference';
import { BREAKING_CHOPPINESS, MAX_TILE_GROWTH, PEAK_WAVELENGTHS_PER_TILE, drawnSea, seaStateCascades, windSeaFetch, windSeaGamma,
  windSeaPeakWavelength } from './seaState';
import { FOLD_PERIOD, GRAVITY, buildSpectrum, cascadeBands } from './spectrum';

const sea = (overrides: Partial<WaveParameters> = {}): WaveParameters => ({
  significantHeight: 1.8, windSpeed: 9, windDirection: .6, peakWavelength: 32, choppiness: 1.1,
  gamma: 2.6, directionalSharpness: .8, seed: 1941, dirty: true, ...overrides,
});
/** The calibration table's sea at `wind` on a map, as VisualEnvironment writes it to `ocean.waves`. */
const table = (wind: number, map = OCEAN_MAPS[0]) => {
  const waves = windSea(map, wind);
  return sea({ significantHeight: waves.significantHeightM, windSpeed: wind, peakWavelength: waves.peakWavelength, choppiness: waves.choppiness });
};
const WINDS = [1, 2, 3, 4, 5, 6, 7, 9, 10.5, 12, 15, 18, 21, 25, 30];
const deepWaterWavelength = (period: number) => GRAVITY * period * period / (2 * Math.PI);

describe('realistic wind sea', () => {
  test('eliminating the fetch reproduces both JONSWAP growth laws', () => {
    for (const wind of [5, 9, 15, 25, 30]) for (const fetch of [300, 3000, 1e4, 3e4]) {
      // Hasselmann et al. (1973): g²m0/U⁴ = 1.6e-7·χ, fp·U/g = 3.5·χ^-0.33.
      const height = 4 * Math.sqrt(1.6e-7 * fetch) * wind * wind / GRAVITY, frequency = 3.5 * GRAVITY / wind * fetch ** -.33;
      expect(windSeaFetch(height, wind) / fetch).toBeCloseTo(1, 10);
      expect(windSeaPeakWavelength(height, wind) / deepWaterWavelength(1 / frequency)).toBeCloseTo(1, 10);
    }
  });

  test('a fully developed sea has Pierson–Moskowitz wavelength', () => {
    // Pierson & Moskowitz (1964): Hs = 0.21·U19.5²/g, ωp = 0.877·g/U19.5, with U19.5 = 1.026·U10.
    for (const wind of [6, 9, 12, 20]) {
      const high = 1.026 * wind, height = .21 * high * high / GRAVITY, omega = .877 * GRAVITY / high;
      expect(Math.abs(windSeaPeakWavelength(height, wind) / (2 * Math.PI * GRAVITY / omega ** 2) - 1)).toBeLessThan(.05);
    }
    // The table's 9 m/s sea is that developed sea: 1.8 m on a 70 m peak (the table draws 32 m).
    expect(windSeaPeakWavelength(1.8, 9)).toBeGreaterThan(65);
    expect(windSeaPeakWavelength(1.8, 9)).toBeLessThan(75);
    expect(windSeaPeakWavelength(8.8, 25)).toBeGreaterThan(250);
    expect(windSeaPeakWavelength(8.8, 25)).toBeLessThan(350);
  });

  test('every calibrated sea keeps a real wind sea steepness, and grows longer with the wind', () => {
    for (const map of OCEAN_MAPS) {
      let previous = 0;
      for (const wind of WINDS) {
        const drawn = drawnSea(table(wind, map), true), steepness = drawn.significantHeight / drawn.peakWavelength;
        // Wind seas run from about 1/25 young to 1/40 developed; light airs keep an older, gentler sea.
        expect(steepness).toBeLessThan(1 / 25);
        expect(steepness).toBeGreaterThan(wind < 4 ? 1 / 55 : 1 / 45);
        if (wind >= 4) expect(drawn.peakWavelength).toBeGreaterThan(previous);
        previous = drawn.peakWavelength;
      }
    }
    // The table's own wavelengths are far steeper above a moderate breeze: 1/7 at 25 m/s, at the breaking limit.
    const storm = table(25);
    expect(storm.significantHeight / storm.peakWavelength).toBeGreaterThan(1 / 8);
  });

  test('γ follows the fetch between Pierson–Moskowitz and the JONSWAP mean', () => {
    for (const wind of WINDS) {
      const { gamma } = drawnSea(table(wind), true);
      expect(gamma).toBeGreaterThanOrEqual(1);
      expect(gamma).toBeLessThanOrEqual(3.3);
    }
    expect(drawnSea(table(9), true).gamma).toBeCloseTo(1.72, 1);
    expect(drawnSea(table(25), true).gamma).toBeCloseTo(1.96, 1);
    expect(windSeaGamma(0, 9, 2.6)).toBe(2.6);
  });

  test('off draws the given sea exactly; on changes only wavelength, γ and choppiness', () => {
    for (const wind of WINDS) {
      const given = table(wind), off = drawnSea(given, false), on = drawnSea(given, true);
      expect(off).toEqual(given);
      expect(off).not.toBe(given);
      const { peakWavelength, gamma, choppiness, ...kept } = on;
      const { peakWavelength: _l, gamma: _g, choppiness: _c, ...same } = given;
      expect(kept).toEqual(same);
      expect(choppiness).toBe(BREAKING_CHOPPINESS);
      expect(peakWavelength).toBeGreaterThan(0);
      expect(gamma).toBeGreaterThan(0);
    }
    // A trochoid scaled by the breaking choppiness cusps at Stokes' limit, ka = π·0.1412.
    expect(1 - BREAKING_CHOPPINESS * Math.PI * .1412).toBeCloseTo(0, 12);
  });

  test('flat water, no wind and nonsense stay finite', () => {
    expect(drawnSea(sea({ significantHeight: 0, windSpeed: 0 }), true).peakWavelength).toBe(32);
    expect(drawnSea(sea({ windSpeed: 0 }), true).peakWavelength).toBe(32);
    expect(drawnSea(sea({ windSpeed: Number.NaN }), true).peakWavelength).toBe(32);
    expect(windSeaPeakWavelength(0, 9)).toBe(0);
    expect(windSeaPeakWavelength(1, 0, 17)).toBe(17);
    expect(Number.isFinite(windSeaPeakWavelength(1e-4, 1e-3))).toBe(true);
  });
});

describe('sea-state tiles', () => {
  test('the largest tile holds eight peak wavelengths, every tile grown by one factor within the cap', () => {
    for (const tier of Object.values(OCEAN_TIERS)) {
      const base = tier.cascades[0].size;
      for (const wavelength of [0, 6, 32, 80, 128, 150, 298, 368, 512, 900, Number.NaN]) {
        const layout = seaStateCascades(tier.cascades, wavelength);
        const expected = Math.min(MAX_TILE_GROWTH * base, Math.max(base, PEAK_WAVELENGTHS_PER_TILE * wavelength || base));
        expect(layout[0].size).toBeCloseTo(expected, 9);
        layout.forEach((cascade, i) => {
          expect(cascade.resolution).toBe(tier.cascades[i].resolution);
          expect(cascade.size / tier.cascades[i].size).toBeCloseTo(layout[0].size / base, 12);
        });
        if (!(wavelength > base / PEAK_WAVELENGTHS_PER_TILE)) expect(layout).toEqual(tier.cascades.map(c => ({ ...c })));
      }
    }
  });

  test("the tier's tiles already hold every table sea as given", () => {
    // Off never grows the tiles: the table's longest peak fits eight times in the 1,024 m tile.
    for (const map of OCEAN_MAPS) for (const wind of WINDS) {
      expect(PEAK_WAVELENGTHS_PER_TILE * table(wind, map).peakWavelength).toBeLessThan(OCEAN_TIERS.low.cascades[0].size);
    }
  });

  const grown = (tier: readonly WaveCascadeInfo[], wind: number) => {
    const drawn = drawnSea(table(wind), true);
    return { drawn, layout: seaStateCascades(tier, drawn.peakWavelength) };
  };

  test('bands stay contiguous and disjoint, every mode in its band, and Hm0 exact on grown tiles', () => {
    for (const tier of Object.values(OCEAN_TIERS)) for (const wind of [6, 15, 25, 30]) {
      const { drawn, layout } = grown(tier.cascades, wind), bands = cascadeBands(layout);
      bands.forEach((band, i) => {
        expect(band.lo).toBeLessThan(band.hi);
        if (i) expect(band.lo).toBe(bands[i - 1].hi);
      });
      const spectrum = buildSpectrum(layout, drawn);
      for (const cascade of spectrum.cascades) {
        const modes = activeModes(cascade);
        for (let i = 0; i < modes.length; i += 5) {
          const k = Math.hypot(modes[i], modes[i + 1]);
          expect(k).toBeGreaterThanOrEqual(cascade.lo);
          expect(k).toBeLessThan(cascade.hi);
        }
      }
      expect(4 * Math.sqrt(spectrum.cascades.reduce((sum, c) => sum + c.variance, 0)) / drawn.significantHeight).toBeCloseTo(1, 7);
      // The largest tile draws the spectral peak.
      expect(bands[0].hi).toBeGreaterThan(2 * Math.PI / drawn.peakWavelength);
    }
  });

  test('grown tiles stay periodic in space and time', () => {
    // The largest layout the cap allows, on Ultra: its longest waves still fold time within 1% of their dispersion.
    const layout = seaStateCascades(OCEAN_TIERS.ultra.cascades, 1e4), spectrum = buildSpectrum(layout, sea({ significantHeight: 11.3, windSpeed: 30, peakWavelength: 500 }));
    expect(layout[0].size).toBe(MAX_TILE_GROWTH * OCEAN_TIERS.ultra.cascades[0].size);
    let worst = 0;
    for (const cascade of spectrum.cascades) {
      const modes = activeModes(cascade);
      for (let i = 0; i < modes.length; i += 5) {
        const k = Math.hypot(modes[i], modes[i + 1]), exact = Math.sqrt(GRAVITY * k);
        worst = Math.max(worst, Math.abs(2 * Math.PI * Math.abs(modes[i + 4]) / FOLD_PERIOD - exact) / exact);
        // Every wavevector lies on its own tile's lattice.
        expect(Math.abs(modes[i] * cascade.size / (2 * Math.PI) - Math.round(modes[i] * cascade.size / (2 * Math.PI)))).toBeLessThan(1e-9);
      }
    }
    expect(worst).toBeLessThan(.01);
    // A grown tile repeats after exactly its own size: texel x and x + N are the same point of the sea.
    const small = seaStateCascades([{ size: 256, resolution: 32 }, { size: 41, resolution: 32 }], 90), built = buildSpectrum(small, sea({ peakWavelength: 90 }));
    for (const cascade of built.cascades) {
      const modes = activeModes(cascade);
      for (const [x, z] of [[3, 5], [17, 30]]) {
        const here = referenceTexel(cascade, modes, 2, .3, x, z), there = referenceTexel(cascade, modes, 2, .3, x + 32, z - 32);
        for (const key of Object.keys(here) as (keyof typeof here)[]) expect(there[key]).toBeCloseTo(here[key], 9);
      }
    }
  });

  test('the realistic sea sharpens crests without folding them', () => {
    // Summed over the drawn waves, the horizontal compression ∂Dx/∂x + ∂Dz/∂z has standard deviation choppiness × RMS
    // slope. The calibrated storm's steep peak puts a fold (compression below −1) within 1.6σ; the realistic sea
    // keeps it beyond 2.5σ on every tier at every wind, however sharp the breaking choppiness makes its crests.
    for (const tier of Object.values(OCEAN_TIERS)) for (const wind of [3, 6, 9, 15, 25, 30]) {
      const { drawn, layout } = grown(tier.cascades, wind), spectrum = buildSpectrum(layout, drawn);
      const slopes = spectrum.cascades.reduce((sum, c) => sum + c.slopeVariance, 0);
      expect(drawn.choppiness * Math.sqrt(slopes)).toBeLessThan(1 / 2.5);
    }
    const storm = table(25), steep = buildSpectrum(OCEAN_TIERS.high.cascades, storm);
    expect(storm.choppiness * Math.sqrt(steep.cascades.reduce((sum, c) => sum + c.slopeVariance, 0))).toBeGreaterThan(1 / 1.6);
  });

  test("a realistic peak leaves the saturation cap unreached and the rest of Cox–Munk's slopes to the tail", () => {
    // JONSWAP normalised to a real sea's height has α near Phillips' 0.0081, below the 0.02 cap: the short waves are
    // JONSWAP's own, and the unresolved share of Cox–Munk's measured slopes roughens the surface.
    for (const wind of [6, 9, 15, 25, 30]) {
      const { drawn, layout } = grown(OCEAN_TIERS.high.cascades, wind), spectrum = buildSpectrum(layout, drawn);
      const drawnSlopes = spectrum.cascades.reduce((sum, c) => sum + c.slopeVariance, 0), total = .003 + .00512 * wind;
      expect(drawnSlopes).toBeLessThan(total);
      expect(spectrum.tailSlopeVariance).toBeCloseTo(total - drawnSlopes, 12);
    }
  });
});
