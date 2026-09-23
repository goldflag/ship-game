/** CPU wave spectrum. Each cascade is a periodic tile whose wavevector lattice k = 2π·n/L holds
 * seeded Gaussian amplitudes drawn from a JONSWAP spectrum (Hasselmann et al. 1973) with
 * frequency-dependent directional spreading (Hasselmann et al. 1980), then scaled so the rendered
 * surface has exactly the requested significant height. Pure TypeScript: the GPU only evolves
 * and transforms what this file builds. */
import type { WaveCascadeInfo, WaveParameters } from '../contracts';

export const GRAVITY = 9.81;
/** Every angular frequency is a whole multiple of 2π/FOLD_PERIOD, so the sea repeats exactly
 * after this many seconds and the GPU can take time modulo it without float32 phase drift. */
export const FOLD_PERIOD = 4096;
/** The finer cascade takes over a band once its lattice has this many modes across the cut radius. */
const FINE_MODES_AT_CUT = 8;

export interface WaveBand {
  /** Wavenumbers |k| (rad/m) this cascade holds: lo ≤ |k| < hi. */
  readonly lo: number;
  readonly hi: number;
}

export interface CascadeSpectrum extends WaveCascadeInfo, WaveBand {
  /** Per texel, row z then column x, frequency n = i < N/2 ? i : i − N on each axis:
   * (Re a, Im a, ±m, 0). The texel's wave is a·e^{∓iωt} with ω = 2π·m/FOLD_PERIOD; the sign says
   * whether it travels toward +k (positive) or is the conjugate twin of one travelling toward −k. */
  readonly amplitudes: Float32Array;
  /** Time-averaged height variance (m²) this cascade contributes. */
  readonly variance: number;
  /** Its time-averaged slope variance (∂y/∂x)² + (∂y/∂z)². */
  readonly slopeVariance: number;
}

export interface WaveSpectrum {
  readonly cascades: readonly CascadeSpectrum[];
  /** Strict bound on |height|: Σ|a| over every texel of every cascade. */
  readonly maxHeight: number;
  /** Strict bound on the horizontal displacement's length: choppiness · Σ|a|. */
  readonly maxHorizontalDisplacement: number;
  /** Slope variance (dimensionless) of the waves shorter than the finest cascade resolves. */
  readonly tailSlopeVariance: number;
}

/** Deep-water angular frequency ω = √(g|k|), quantised to a whole multiple m of 2π/FOLD_PERIOD. */
export function frequencyMultiple(k: number): number {
  return Math.round(Math.sqrt(GRAVITY * k) * FOLD_PERIOD / (2 * Math.PI));
}

/** Where each cascade's band starts and ends. The largest tile holds everything longer than the
 * first cut; each cut sits where the finer lattice has FINE_MODES_AT_CUT modes across its radius
 * (but at most half the coarser tile's Nyquist, so the coarse texels still resolve the cut); the
 * finest tile runs to its own Nyquist. Bands are disjoint, so no wavevector is drawn twice. */
export function cascadeBands(cascades: readonly WaveCascadeInfo[]): WaveBand[] {
  const nyquist = (c: WaveCascadeInfo) => Math.PI * c.resolution / c.size;
  const cuts = cascades.slice(1).map((fine, i) => Math.min(FINE_MODES_AT_CUT * 2 * Math.PI / fine.size, nyquist(cascades[i]) / 2));
  return cascades.map((cascade, i) => ({ lo: i ? cuts[i - 1] : 0, hi: i < cuts.length ? cuts[i] : nyquist(cascade) }));
}

/** JONSWAP energy per unit angular frequency, without α (the normalisation sets the level). */
export function jonswap(omega: number, peak: number, gamma: number): number {
  if (!(omega > 0)) return 0;
  const sigma = omega <= peak ? .07 : .09;
  const r = Math.exp(-((omega - peak) ** 2) / (2 * sigma * sigma * peak * peak));
  return GRAVITY * GRAVITY / omega ** 5 * Math.exp(-1.25 * (peak / omega) ** 4) * gamma ** r;
}

/** Spreading exponent s of cos^{2s}(θ/2) (Hasselmann et al. 1980): narrowest near the peak, broader
 * for long and short waves; above the peak a younger sea (higher wind for its peak) spreads faster.
 * `sharpness` scales it: 1 is the measured spread, below 1 broader crossing seas. */
export function spreadingExponent(omega: number, peak: number, windSpeed: number, sharpness: number): number {
  const ratio = omega / peak;
  const age = Math.min(3, Math.max(.3, windSpeed * peak / GRAVITY));
  const s = ratio < 1.05 ? 6.97 * ratio ** 4.06 : 9.77 * ratio ** (-2.33 - 1.45 * (age - 1.17));
  return Math.max(0, s * sharpness);
}

/** ln Γ(x) for x > 0 (Lanczos, g = 7). */
function logGamma(x: number): number {
  if (x < .5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  const c = [.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  x -= 1;
  let sum = c[0];
  for (let i = 1; i < 9; i++) sum += c[i] / (x + i);
  const t = x + 7.5;
  return .5 * Math.log(2 * Math.PI) + (x + .5) * Math.log(t) - t + Math.log(sum);
}

/** Normalisation of |cos(θ/2)|^{2s} over a full turn: 2^{2s−1}Γ(s+1)² / (πΓ(2s+1)). */
export function spreadingNormalization(s: number): number {
  return Math.exp((2 * s - 1) * Math.LN2 + 2 * logGamma(s + 1) - logGamma(2 * s + 1)) / Math.PI;
}

/** PCG output permutation (Jarzynski & Olano, "Hash Functions for GPU Rendering", 2020) on uint32. */
function pcg(v: number): number {
  const state = (Math.imul(v, 747796405) + 2891336453) >>> 0;
  const word = Math.imul((state >>> ((state >>> 28) + 4)) ^ state, 277803737) >>> 0;
  return ((word >>> 22) ^ word) >>> 0;
}

/** Counter-based random stream for one lattice pair. Integers only: the seed's high and low words,
 * the cascade and both signed indices are mixed as uint32, so no two nearby modes share a phase
 * whatever the seed's magnitude. */
export function modeHash(seed: number, cascade: number, nx: number, nz: number): number {
  const whole = Math.trunc(seed);
  const high = Math.floor(whole / 4294967296) >>> 0, low = whole >>> 0;
  return pcg((nz >>> 0) + pcg((nx >>> 0) + pcg(cascade + pcg(low + pcg(high)))));
}
const unit = (bits: number) => (bits + .5) / 4294967296;

/** Build every cascade's amplitudes for `params`. Waves travel toward `windDirection`. */
export function buildSpectrum(cascades: readonly WaveCascadeInfo[], params: WaveParameters): WaveSpectrum {
  const bands = cascadeBands(cascades);
  const height = params.significantHeight, lambda = params.peakWavelength;
  const calm = !(height > 0) || !(lambda > 0) || !Number.isFinite(height) || !Number.isFinite(lambda);
  const peak = Math.sqrt(GRAVITY * 2 * Math.PI / lambda), gamma = Math.max(1, params.gamma);
  const cosWind = Math.cos(params.windDirection), sinWind = Math.sin(params.windDirection);
  let total = 0;
  const built = cascades.map((cascade, index) => {
    const { size, resolution: n } = cascade, { lo, hi } = bands[index];
    const amplitudes = new Float32Array(n * n * 4);
    const dk = 2 * Math.PI / size;
    if (!calm) for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
      const nx = x < n / 2 ? x : x - n, nz = z < n / 2 ? z : z - n;
      // One draw per ± pair, from its canonical member (nz > 0, or nz = 0 and nx > 0).
      if (nz < 0 || (nz === 0 && nx <= 0)) continue;
      const kx = nx * dk, kz = nz * dk, k = Math.hypot(kx, kz);
      // The Nyquist column has no distinct twin; it stays empty (its row never passes the test above).
      if (k < lo || k >= hi || nx === -n / 2) continue;
      const omega = Math.sqrt(GRAVITY * k), s = spreadingExponent(omega, peak, params.windSpeed, params.directionalSharpness);
      // cos(θ/2) toward +k and sin(θ/2) toward −k, θ measured from the wind.
      const cosTheta = (kx * cosWind + kz * sinWind) / k;
      const toward = Math.sqrt(Math.max(0, (1 + cosTheta) / 2)) ** (2 * s), away = Math.sqrt(Math.max(0, (1 - cosTheta) / 2)) ** (2 * s);
      // Directional wavenumber spectrum S(k)·D(θ)/k with S(k) = E(ω)·dω/dk, times the cell area.
      const density = jonswap(omega, peak, gamma) * GRAVITY / (2 * omega) * spreadingNormalization(s) / k * dk * dk;
      const pair = density * (toward + away);
      if (!(pair > 0)) continue;
      // Each pair is one travelling wave: its direction is drawn in proportion to the energy each
      // way, so the pair's variance is steady in time and the tile's Hm0 holds at every instant.
      const bits = modeHash(params.seed, index, nx, nz);
      const radius = Math.sqrt(-2 * Math.log(unit(pcg(bits + 1)))), angle = 2 * Math.PI * unit(pcg(bits + 2));
      const scale = Math.sqrt(pair / 4) * radius;
      const re = scale * Math.cos(angle), im = scale * Math.sin(angle);
      const forward = unit(pcg(bits + 3)) * (toward + away) < toward;
      const m = frequencyMultiple(k);
      const here = (z * n + x) * 4, twin = (((n - z) % n) * n + (n - x) % n) * 4;
      // Travelling toward +k: a at +k with e^{−iωt}; its conjugate twin at −k with e^{+iωt}.
      const [at, other] = forward ? [here, twin] : [twin, here];
      amplitudes[at] = re; amplitudes[at + 1] = im; amplitudes[at + 2] = m;
      amplitudes[other] = re; amplitudes[other + 1] = -im; amplitudes[other + 2] = -m;
      total += 2 * (re * re + im * im);
    }
    return { ...cascade, lo, hi, amplitudes, variance: 0, slopeVariance: 0 };
  });
  const scale = total > 0 ? height / (4 * Math.sqrt(total)) : 0;
  // Statistics come from the stored float32 amplitudes: the GPU transforms exactly these.
  let sum = 0;
  for (const cascade of built) {
    const a = cascade.amplitudes, n = cascade.resolution, dk = 2 * Math.PI / cascade.size;
    for (let i = 0; i < a.length; i += 4) if (a[i + 2]) {
      a[i] *= scale; a[i + 1] *= scale;
      const texel = i / 4, nx = texel % n, nz = (texel - nx) / n, energy = a[i] ** 2 + a[i + 1] ** 2;
      const k2 = ((nx < n / 2 ? nx : nx - n) ** 2 + (nz < n / 2 ? nz : nz - n) ** 2) * dk * dk;
      sum += Math.sqrt(energy); cascade.variance += energy; cascade.slopeVariance += energy * k2;
    }
  }
  const slopeVariance = built.reduce((total, cascade) => total + cascade.slopeVariance, 0);
  // Waves shorter than the finest tile still roughen the surface. Cox & Munk (1954) measured the
  // sea's total mean square slope as 0.003 + 0.00512·U; the tail supplies whatever the drawn waves
  // fall short of it, so the wind sets the roughness a tier cannot draw.
  const tailSlopeVariance = calm ? 0 : Math.max(0, .003 + .00512 * Math.max(0, params.windSpeed) - slopeVariance);
  return { cascades: built, maxHeight: sum, maxHorizontalDisplacement: Math.max(0, params.choppiness) * sum, tailSlopeVariance };
}
