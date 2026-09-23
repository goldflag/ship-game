/** The realistic wind sea behind `OceanRealism.seaState`: the peak wavelength a real wind sea has at the calibrated
 * significant height and wind, from the JONSWAP fetch-limited growth laws (Hasselmann et al. 1973); the measured
 * wind-sea spectrum of Donelan, Hamilton & Hui (1985) at that wave age; crests that sharpen toward Stokes' breaking
 * limit; and tiles large enough that the longest waves do not repeat. The calibration table keeps its heights, which
 * combat and hull motion share. Pure functions: the wave field applies them when it rebuilds. */
import type { WaveCascadeInfo, WaveParameters } from '../contracts';
import { GRAVITY } from './spectrum';

/** JONSWAP's growth with dimensionless fetch χ = gX/U²: total variance g²m0/U⁴ = 1.6e-7·χ, peak frequency
 * fp·U/g = 3.5·χ^-0.33 (Hasselmann et al. 1973, U at 10 m). */
const ENERGY_GROWTH = 1.6e-7, PEAK_FREQUENCY = 3.5, PEAK_DECAY = .33;
/** Stokes' highest wave is H/λ = 0.1412 (Michell 1893; Williams 1981), ka = π·0.1412 = 0.444. */
const STOKES_LIMIT = .1412;
/** A choppy trochoid's Jacobian is 1 − choppiness·ka at the crest: at this choppiness a crest cusps exactly at Stokes'
 * limit, so crests sharpen as waves steepen and fold only where the linear sea passes the breaking steepness. */
export const BREAKING_CHOPPINESS = 1 / (Math.PI * STOKES_LIMIT);
/** Tiles hold at least this many peak wavelengths, so the longest waves do not repeat visibly from the air. */
export const PEAK_WAVELENGTHS_PER_TILE = 8;
/** Tiles grow at most this much beyond the tier's layout (4,096 m from its 1,024 m). */
export const MAX_TILE_GROWTH = 4;

/** The fetch χ at which a wind sea of significant height `height` (m) has grown under `windSpeed` (m/s) at 10 m. */
export function windSeaFetch(height: number, windSpeed: number): number {
  return (height / 4) ** 2 * GRAVITY ** 2 / windSpeed ** 4 / ENERGY_GROWTH;
}

/** Peak wavelength (m) of a wind sea with this significant height under this wind: eliminating the fetch between
 * JONSWAP's two growth laws gives Hs ∝ Tp^(3/2) at a given wind, the form of Toba's 3/2 law. The table's seas up to
 * 9 m/s are fully developed (Pierson–Moskowitz: 1.8 m and 71 m at 9 m/s, where this gives 70 m); above it they are
 * fetch-limited and younger, so steeper. Beyond full development (light airs, where the table keeps some sea) the
 * law continues as an older, longer sea. 0 for a flat sea; `fallback` without wind. */
export function windSeaPeakWavelength(height: number, windSpeed: number, fallback = 0): number {
  if (!(height > 0) || !Number.isFinite(height)) return 0;
  if (!(windSpeed > 0) || !Number.isFinite(windSpeed)) return fallback;
  const frequency = PEAK_FREQUENCY * GRAVITY / windSpeed * windSeaFetch(height, windSpeed) ** -PEAK_DECAY;
  return GRAVITY / (2 * Math.PI * frequency * frequency);
}

/** Wave age U/cp: the wind over the peak's phase speed; about 0.83 fully developed, larger in a younger sea. */
export function waveAge(peakWavelength: number, windSpeed: number): number {
  const age = windSpeed / Math.sqrt(GRAVITY * peakWavelength / (2 * Math.PI));
  return Number.isFinite(age) && age > 0 ? age : 0;
}

/** Donelan, Hamilton & Hui's (1985) peak enhancement at a wave age: 1.7 for a fully developed sea (and the older seas
 * of light airs), 1.7 + 6·log10(U/cp) for a younger one, fitted up to U/cp = 5. */
export function windSeaGamma(age: number): number {
  return 1.7 + 6 * Math.log10(Math.min(5, Math.max(1, age)));
}

/** The sea the wave field draws: `params` itself, or with `seaState` on the wavelength of a real wind sea at the same
 * height and wind, Donelan's spectrum at its wave age, and crests sharpened toward the breaking limit. */
export function drawnSea(params: WaveParameters, seaState: boolean): WaveParameters {
  if (!seaState) return { ...params };
  const peakWavelength = windSeaPeakWavelength(params.significantHeight, params.windSpeed, params.peakWavelength) || params.peakWavelength;
  return { ...params, peakWavelength, gamma: windSeaGamma(waveAge(peakWavelength, params.windSpeed)),
    choppiness: BREAKING_CHOPPINESS, equilibriumRange: true };
}

/** The tier's tiles grown by one factor until the largest holds PEAK_WAVELENGTHS_PER_TILE peak wavelengths (never
 * shrunk, at most MAX_TILE_GROWTH). One factor keeps every band's place on its lattice (modes across each cut, texels
 * per wavelength), so the tier's quality, band splits, mip fades and ripples hold at any sea state. The tier's own
 * layout covers every sea up to a 128 m peak. */
export function seaStateCascades(base: readonly WaveCascadeInfo[], peakWavelength: number): WaveCascadeInfo[] {
  const growth = Math.min(MAX_TILE_GROWTH, Math.max(1, PEAK_WAVELENGTHS_PER_TILE * peakWavelength / base[0].size));
  const factor = Number.isFinite(growth) ? growth : 1;
  return base.map(({ size, resolution }) => ({ size: size * factor, resolution }));
}
