/** Whitecaps: how much of the sea the wind turns white, and where each cascade's crests break to make it so. Pure
 * TypeScript over the CPU spectrum; the wave field applies the result when it rebuilds.
 *
 * A crest breaks where it is both compressed (the choppy displacement's −∇·D, largest at the crest) and steep on its
 * forward face (the slope falling away downwind). Both are linear in the wave amplitudes, and for every travelling mode
 * they are a quarter period apart, so over the tile they are uncorrelated Gaussian fields whose variances the spectrum
 * gives exactly. Their normalised blend is a standard normal "breaking indicator" peaking on the forward face; a crest
 * breaks where it passes a quantile chosen for the coverage the wind calls for. The foam that covers the sea therefore
 * follows the wind, whatever the wavelengths, heights or choppiness of the waves that carry it. */
import type { WaveSpectrum } from './spectrum';
import { GRAVITY } from './spectrum';

/** Monahan & O'Muircheartaigh (1980): whitecaps cover 3.84e-6·U^3.41 of the sea at wind U (m/s at 10 m). */
const MONAHAN_SCALE = 3.84e-6, MONAHAN_EXPONENT = 3.41;
/** Wind (m/s) below which no crest breaks, and where coverage has reached Monahan's curve. */
const ONSET_START = 3.5, ONSET_FULL = 5;
/** Wind (m/s) over which old foam is blown into windrows, from Beaufort 7 ("foam blown in streaks along the wind")
 * to Beaufort 11, and the share of the whitecap coverage they then hold. */
const WINDROW_START = 13, WINDROW_FULL = 30, WINDROW_SHARE = .15;
/** Forward shift of the breaking indicator from the crest (radians of wave phase): foam starts on the crest and
 * spills down the face ahead of it. */
const FACE_SHIFT = .9;
/** The waves that break, relative to the sea's mean wavelength: none longer than twice it (swell does not break),
 * fully from it down to a sixteenth, fading out below a thirty-second. Breaking area is spread over octaves of
 * shorter waves (Melville & Matusov 2002), so the band weights slope variance. */
const BREAKING_LONGEST = 2, BREAKING_LONG = 1, BREAKING_SHORT = 1 / 16, BREAKING_SHORTEST = 1 / 32;
/** Wavelengths (m) below which waves fold without whitecaps whatever the sea: ripples roughen, they do not foam. */
const RIPPLE_START = 3, RIPPLE_END = 5;
/** A cascade needing fewer active texels than this breaks nowhere (a quantile beyond ~5σ). */
const MIN_ACTIVE = 1e-7;

/** The share of the sea whitecaps cover at `windSpeed`, active and residual foam together. */
export function whitecapCoverage(windSpeed: number): number {
  const wind = Math.max(0, Math.min(40, windSpeed || 0));
  const t = Math.min(1, Math.max(0, (wind - ONSET_START) / (ONSET_FULL - ONSET_START)));
  return MONAHAN_SCALE * wind ** MONAHAN_EXPONENT * t * t * (3 - 2 * t);
}

/** The share of the sea old foam covers in windrows at `windSpeed`: part of `whitecapCoverage`, not added to it. */
export function windrowCoverage(windSpeed: number): number {
  const t = Math.min(1, Math.max(0, ((windSpeed || 0) - WINDROW_START) / (WINDROW_FULL - WINDROW_START)));
  return whitecapCoverage(windSpeed) * WINDROW_SHARE * t * t * (3 - 2 * t);
}

/** Inverse of the standard normal CDF (Acklam's rational approximation, relative error below 1.2e-9). */
export function normalQuantile(p: number): number {
  if (!(p > 0)) return -Infinity;
  if (!(p < 1)) return Infinity;
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-.007784894002430293, -.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [.007784695709041462, .3224671290700398, 2.445134137142996, 3.754408661907416];
  const tail = (q: number) => (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  if (p < .02425) return tail(Math.sqrt(-2 * Math.log(p)));
  if (p > 1 - .02425) return -tail(Math.sqrt(-2 * Math.log(1 - p)));
  const q = p - .5, r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/** Standard normal upper tail Q(z) = P(Z > z) (Abramowitz & Stegun 26.2.17, absolute error below 7.5e-8). */
export function normalTail(z: number): number {
  if (z === Infinity) return 0;
  if (z === -Infinity) return 1;
  const t = 1 / (1 + .2316419 * Math.abs(z));
  const tail = Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI) * t * (.31938153 + t * (-.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z >= 0 ? tail : 1 - tail;
}

/** How one cascade breaks. `compression` and `face` weight its crest compression −(∂Dx/∂x + ∂Dz/∂z) and forward-face
 * slope −(∇h·ŵ) so that their sum is a standard normal indicator; crests break where it passes `threshold`. */
export interface CascadeBreaking {
  readonly compression: number;
  readonly face: number;
  /** Indicator where breaking starts; Infinity where this cascade holds no breaking waves. */
  threshold: number;
  /** Share of the sea's breaking this cascade carries, 0–1 over all cascades. */
  readonly share: number;
  /** Period (s) of the waves that break in this cascade: their foam lives a set number of these. */
  readonly period: number;
}

/** Smooth 0→1 as `x` rises from `a` to `b`, even in log(x). */
function logRamp(x: number, a: number, b: number): number {
  const t = Math.min(1, Math.max(0, Math.log(x / a) / Math.log(b / a)));
  return t * t * (3 - 2 * t);
}

/** Weight of waves of `wavelength` (m) among those that break, in a sea of mean wavelength `mean`. */
function breakingWindow(wavelength: number, mean: number): number {
  const ratio = wavelength / mean;
  return logRamp(ratio, BREAKING_SHORTEST, BREAKING_SHORT) * (1 - logRamp(ratio, BREAKING_LONG, BREAKING_LONGEST)) * logRamp(wavelength, RIPPLE_START, RIPPLE_END);
}

/** Each cascade's breaking statistics for a built spectrum drawn with `choppiness`, under a wind blowing toward the
 * unit vector (wx, wz): the indicator weights, its share of the breaking waves and their period. Thresholds are left
 * at Infinity; `setBreakingThresholds` places them for a coverage. */
export function cascadeBreaking(spectrum: WaveSpectrum, wx: number, wz: number, choppiness: number): CascadeBreaking[] {
  // The sea's mean wavelength 2π·E[1/k] (energy-weighted): about 0.8–0.9 of the peak's for these spectra.
  let energy = 0, inverse = 0;
  for (const cascade of spectrum.cascades) forModes(cascade, (e, kx, kz) => { energy += e; inverse += e / Math.hypot(kx, kz); });
  const mean = energy > 0 ? 2 * Math.PI * inverse / energy : 0;
  const stats = spectrum.cascades.map(cascade => {
    let slope = 0, face = 0, weight = 0, weightedInverse = 0;
    forModes(cascade, (e, kx, kz) => {
      const k2 = kx * kx + kz * kz, k = Math.sqrt(k2), along = kx * wx + kz * wz;
      slope += e * k2; face += e * along * along;
      const w = e * k2 * breakingWindow(2 * Math.PI / k, mean);
      weight += w; weightedInverse += w / k;
    });
    const compression = Math.max(0, choppiness) ** 2 * slope;
    // Weights so that (a·compression + b·face) ~ N(0, 1): cos and sin of the forward shift over each deviation.
    const a = compression > 0 ? Math.cos(FACE_SHIFT) / Math.sqrt(compression) : 0;
    const b = face > 0 ? (compression > 0 ? Math.sin(FACE_SHIFT) : 1) / Math.sqrt(face) : 0;
    const wavelength = weight > 0 ? 2 * Math.PI * weightedInverse / weight : 0;
    return { compression: a, face: b, weight, period: wavelength > 0 ? Math.sqrt(2 * Math.PI * wavelength / GRAVITY) : 0 };
  });
  const total = stats.reduce((sum, s) => sum + s.weight, 0);
  return stats.map(s => ({ compression: s.compression, face: s.face, threshold: Infinity, share: total > 0 ? s.weight / total : 0, period: s.period }));
}

/** Calls `visit(energy, kx, kz)` for every stored texel of a cascade (both members of each travelling pair). */
function forModes(cascade: WaveSpectrum['cascades'][number], visit: (energy: number, kx: number, kz: number) => void): void {
  const { amplitudes: a, resolution: n, size } = cascade, dk = 2 * Math.PI / size;
  for (let i = 0; i < a.length; i += 4) {
    if (!a[i + 2]) continue;
    const texel = i / 4, x = texel % n, z = (texel - x) / n;
    visit(a[i] * a[i] + a[i + 1] * a[i + 1], (x < n / 2 ? x : x - n) * dk, (z < n / 2 ? z : z - n) * dk);
  }
}

/** Whitecap coverage per unit of sea breaking at an instant: a crest's foam outlives its passing several times over.
 * Measured on the GPU with `bun scripts/browser/ocean-waves.ts --coverage`. */
const PERSISTENCE = 3;

/** The fraction of the sea breaking at any instant for the whitecaps (less windrows) `windSpeed` calls for, times `scale`. */
export function activeBreaking(windSpeed: number, scale = 1): number {
  return (whitecapCoverage(windSpeed) - windrowCoverage(windSpeed)) * Math.max(0, scale) / PERSISTENCE;
}

/** Place each cascade's threshold so that its crests break over the share of `active` (the fraction of the sea
 * breaking at any instant) it carries. */
export function setBreakingThresholds(cascades: CascadeBreaking[], active: number): void {
  for (const cascade of cascades) {
    const fraction = Math.min(.5, cascade.share * active);
    cascade.threshold = fraction > MIN_ACTIVE && (cascade.compression || cascade.face) ? -normalQuantile(fraction) : Infinity;
  }
}
