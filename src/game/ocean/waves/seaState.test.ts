import { describe, expect, test } from 'bun:test';
import { OCEAN_MAPS } from '../../../maps/catalog';
import { windSea } from '../../../maps/seaCalibration';
import type { WaveCascadeInfo, WaveParameters } from '../contracts';
import { OCEAN_TIERS } from '../quality';
import { activeModes, referenceTexel } from './reference';
import { BREAKING_CHOPPINESS, MAX_TILE_GROWTH, PEAK_WAVELENGTHS_PER_TILE, drawnSea, seaStateCascades, waveAge, windSeaFetch, windSeaGamma,
  windSeaPeakWavelength } from './seaState';
import { FOLD_PERIOD, GRAVITY, buildSpectrum, cascadeBands, type CascadeSpectrum } from './spectrum';

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

  test("γ and the spectrum's form follow the wave age (Donelan et al. 1985)", () => {
    for (const wind of WINDS) {
      const drawn = drawnSea(table(wind), true);
      expect(drawn.gamma).toBeGreaterThanOrEqual(1.7);
      expect(drawn.gamma).toBeLessThan(2.4);
      expect(drawn.equilibriumRange).toBe(true);
    }
    // Fully developed at 9 m/s (U/cp 0.86); younger in the storm (U/cp 1.16).
    expect(waveAge(drawnSea(table(9), true).peakWavelength, 9)).toBeCloseTo(.86, 2);
    expect(drawnSea(table(9), true).gamma).toBeCloseTo(1.7, 6);
    expect(drawnSea(table(25), true).gamma).toBeCloseTo(1.7 + 6 * Math.log10(waveAge(drawnSea(table(25), true).peakWavelength, 25)), 6);
    expect(windSeaGamma(0)).toBe(1.7);
    expect(windSeaGamma(9)).toBeCloseTo(1.7 + 6 * Math.log10(5), 12);
  });

  test("off draws the given sea exactly; on changes only wavelength, γ, choppiness and the spectrum's form", () => {
    for (const wind of WINDS) {
      const given = table(wind), off = drawnSea(given, false), on = drawnSea(given, true);
      expect(off).toEqual(given);
      expect(off).not.toBe(given);
      const { peakWavelength, gamma, choppiness, equilibriumRange, ...kept } = on;
      const { peakWavelength: _l, gamma: _g, choppiness: _c, ...same } = given;
      expect(equilibriumRange).toBe(true);
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

/** In-place radix-2 inverse FFT (sign +i) of an n×n complex grid, rows then columns. */
function inverseFft(re: Float64Array, im: Float64Array, n: number): void {
  const line = (offset: number, stride: number) => {
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        const a = offset + i * stride, b = offset + j * stride;
        [re[a], re[b]] = [re[b], re[a]]; [im[a], im[b]] = [im[b], im[a]];
      }
    }
    for (let size = 2; size <= n; size <<= 1) for (let start = 0; start < n; start += size) for (let k = 0; k < size / 2; k++) {
      const turn = 2 * Math.PI * k / size, c = Math.cos(turn), s = Math.sin(turn);
      const a = offset + (start + k) * stride, b = offset + (start + k + size / 2) * stride;
      const tr = re[b] * c - im[b] * s, ti = re[b] * s + im[b] * c;
      re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
    }
  };
  for (let z = 0; z < n; z++) line(z * n, 1);
  for (let x = 0; x < n; x++) line(x, n);
}

/** Shares of a 600 m square (at 1 m) where the summed cascades' Jacobian folds (J < 0) and where crests sharpen
 * (J < 0.5), from each cascade's exact ∂Dx/∂x, ∂Dz/∂z and ∂Dx/∂z at time 0, interpolated like the GPU's texels. */
function jacobianStats(cascades: readonly CascadeSpectrum[], choppiness: number) {
  const grids = cascades.map(cascade => {
    const { amplitudes: a, resolution: n, size } = cascade, dk = 2 * Math.PI / size;
    return { n, size, fields: [0, 1, 2].map(field => {
      const re = new Float64Array(n * n), im = new Float64Array(n * n);
      for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
        const i = (z * n + x) * 4;
        if (!a[i + 2]) continue;
        const kx = (x < n / 2 ? x : x - n) * dk, kz = (z < n / 2 ? z : z - n) * dk, k = Math.hypot(kx, kz);
        const factor = -choppiness * (field === 0 ? kx * kx : field === 1 ? kz * kz : kx * kz) / k;
        re[z * n + x] = a[i] * factor; im[z * n + x] = a[i + 1] * factor;
      }
      inverseFft(re, im, n);
      return re;
    }) };
  });
  let folded = 0, sharp = 0, count = 0;
  for (let z = 0; z < 600; z++) for (let x = 0; x < 600; x++) {
    const strain = [0, 0, 0];
    for (const { n, size, fields } of grids) {
      const u = (x + .5) / size * n, v = (z + .5) / size * n, x0 = Math.floor(u), z0 = Math.floor(v), fx = u - x0, fz = v - z0;
      const at = (i: number, j: number) => ((j % n + n) % n) * n + (i % n + n) % n;
      fields.forEach((f, i) => { strain[i] += (f[at(x0, z0)] * (1 - fx) + f[at(x0 + 1, z0)] * fx) * (1 - fz) + (f[at(x0, z0 + 1)] * (1 - fx) + f[at(x0 + 1, z0 + 1)] * fx) * fz; });
    }
    const jacobian = (1 + strain[0]) * (1 + strain[1]) - strain[2] * strain[2];
    count++; if (jacobian < 0) folded++; if (jacobian < .5) sharp++;
  }
  return { folded: folded / count, sharp: sharp / count };
}

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
    // The combined Jacobian of the horizontal displacement over a 600 m square, from every cascade's exact fields:
    // the breaking choppiness sharpens a tenth of the surface's crests (J < 0.5) and folds them almost nowhere, where
    // the calibrated storm folds 2% of its surface into loops.
    const stats = (tier: readonly WaveCascadeInfo[], drawn: WaveParameters) => jacobianStats(buildSpectrum(tier, drawn).cascades, drawn.choppiness);
    for (const wind of [9, 25]) {
      const { drawn, layout } = grown(OCEAN_TIERS.high.cascades, wind), { folded, sharp } = stats(layout, drawn);
      expect(folded).toBeLessThan(.002);
      expect(sharp).toBeGreaterThan(.02);
    }
    const storm = stats(OCEAN_TIERS.high.cascades, table(25));
    expect(storm.folded).toBeGreaterThan(.01);
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
