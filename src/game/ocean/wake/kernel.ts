/** The wake's vertical-derivative operator √(−∇²), the core of iWave (Tessendorf, *Interactive Water
 * Surfaces*, 2004), as radial convolution kernels on a reduce/collapse pyramid.
 *
 * A single truncated kernel of radius P reproduces |k| only for wavelengths shorter than about P
 * cells: its response falls toward P·k²/4 beyond that, so long waves turn non-dispersive and slow.
 * On a 1.5 m grid that would stop a ship's 150 m transverse waves from outrunning its short ones, and
 * the Kelvin wedge would change shape with the quality tier. Following the pyramid idea of Canabal et
 * al., *Dispersion Kernels for Water Wave Simulation* (2016), each level applies a small kernel to a
 * binomially reduced copy of the field and the results are collapsed by bilinear upsampling; the
 * weights are fitted jointly so the total response stays within ~3% of |k| from 6 cells up to
 * 12 × 2^levels cells. Everything is in grid units; the field divides by its cell size. */

/** One tap on a level's own grid: offset in cells and weight in 1/cell. */
export interface KernelTap { readonly x: number; readonly y: number; readonly weight: number }

export interface DispersionPyramid {
  /** `levels[0]` runs on the field's grid, `levels[j]` on the grid reduced 2^j times. Each sums to 0. */
  readonly levels: readonly (readonly KernelTap[])[];
  /** Base-band response to a plane wave (kx, ky) in radians per fine cell; ≈ |k| up to the roll-off. */
  response(kx: number, ky: number): number;
}

/** Kernel radius (cells) on every level but the coarsest; the coarsest also carries the long-range tail. */
const RADIUS = 3;
const COARSEST_RADIUS = 6;

/** Response of the [1 3 3 1]/8 reduce, and equally of the 2× bilinear upsample, per axis. */
const binomial = (k: number) => (Math.cos(1.5 * k) + 3 * Math.cos(0.5 * k)) / 4;

/** The target: |k| with a smooth roll-off before Nyquist, where a grid cannot carry a wave anyway. */
const target = (q: number) => q * Math.exp(-((q / 2.6) ** 4));

/** Tap offsets grouped by 8-fold symmetry: (a, b), a ≥ b ≥ 0, a > 0, inside `radius`. */
function symmetryClasses(radius: number): [number, number][][] {
  const classes: [number, number][][] = [];
  for (let a = 1; a <= radius; a++) for (let b = 0; b <= a; b++) {
    if (a * a + b * b > radius * radius) continue;
    const taps = new Map<string, [number, number]>();
    for (const [x, y] of [[a, b], [b, a]]) for (const sx of [1, -1]) for (const sy of [1, -1]) taps.set(`${sx * x},${sy * y}`, [sx * x, sy * y]);
    classes.push([...taps.values()]);
  }
  return classes;
}

/** Fit the pyramid with `coarseLevels` reduced levels below the field's own grid. */
export function dispersionPyramid(coarseLevels: number): DispersionPyramid {
  const radii = Array.from({ length: coarseLevels + 1 }, (_, level) => level === coarseLevels ? COARSEST_RADIUS : RADIUS);
  // Each unknown is one symmetry class minus as much at the centre, so every level sums to zero and a
  // uniform raise of the sea never accelerates.
  const basis = radii.flatMap((radius, level) => symmetryClasses(radius).map(taps => ({ level, taps })));
  const basisResponse = ({ level, taps }: (typeof basis)[number], kx: number, ky: number) => {
    let filter = 1;
    for (let scale = 1; scale < 2 ** level; scale *= 2) filter *= (binomial(scale * kx) * binomial(scale * ky)) ** 2;
    let sum = 0;
    for (const [x, y] of taps) sum += Math.cos(2 ** level * (kx * x + ky * y)) - 1;
    return filter * sum;
  };
  // Weighted least squares on relative error, sampled log-uniformly in |k| over the whole Nyquist
  // square: the diagonal corner must stay positive or its modes grow instead of oscillating.
  const n = basis.length, normal = Array.from({ length: n }, () => new Float64Array(n)), rhs = new Float64Array(n);
  const kMin = 2 * Math.PI / (12 * 2 ** coarseLevels), kMax = Math.PI * Math.SQRT2;
  for (let i = 0; i < 90; i++) {
    const q = kMin * (kMax / kMin) ** (i / 89);
    for (let a = 0; a < 6; a++) {
      const kx = q * Math.cos(a / 5 * Math.PI / 4), ky = q * Math.sin(a / 5 * Math.PI / 4);
      if (kx > Math.PI) continue;
      const t = target(q), weight = (q < 2.2 ? 1 : .2) / Math.max(t, 1e-4) ** 2;
      const row = basis.map(entry => basisResponse(entry, kx, ky));
      for (let r = 0; r < n; r++) {
        rhs[r] += weight * row[r] * t;
        for (let c = 0; c < n; c++) normal[r][c] += weight * row[r] * row[c];
      }
    }
  }
  const ridge = normal.reduce((sum, row, i) => sum + row[i], 0) / n * 1e-6;
  normal.forEach((row, i) => row[i] += ridge);
  const weights = solve(normal, rhs);
  const levels = radii.map((_, level) => {
    const taps: KernelTap[] = [];
    let center = 0;
    basis.forEach((entry, i) => {
      if (entry.level !== level) return;
      for (const [x, y] of entry.taps) taps.push({ x, y, weight: weights[i] });
      center -= weights[i] * entry.taps.length;
    });
    return [{ x: 0, y: 0, weight: center }, ...taps];
  });
  return { levels, response: (kx, ky) => basis.reduce((sum, entry, i) => sum + weights[i] * basisResponse(entry, kx, ky), 0) };
}

/** Gaussian elimination with partial pivoting; the systems here are ~50 unknowns. */
function solve(matrix: Float64Array[], rhs: Float64Array): Float64Array {
  const n = rhs.length, a = matrix.map(row => row.slice()), b = rhs.slice();
  for (let i = 0; i < n; i++) {
    let pivot = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(a[r][i]) > Math.abs(a[pivot][i])) pivot = r;
    [a[i], a[pivot]] = [a[pivot], a[i]];
    [b[i], b[pivot]] = [b[pivot], b[i]];
    for (let r = i + 1; r < n; r++) {
      const f = a[r][i] / a[i][i];
      for (let c = i; c < n; c++) a[r][c] -= f * a[i][c];
      b[r] -= f * b[i];
    }
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i];
    for (let c = i + 1; c < n; c++) s -= a[i][c] * x[c];
    x[i] = s / a[i][i];
  }
  return x;
}
