import { expect, test } from 'bun:test';
import { dispersionPyramid, type KernelTap } from './kernel';

/** The GPU passes on a periodic CPU grid: [1 3 3 1] reduce, per-level kernels, bilinear collapse. */
function applyPyramid(levels: readonly (readonly KernelTap[])[], field: Float64Array, size: number): Float64Array {
  const wrap = (i: number, n: number) => (i % n + n) % n;
  const reduce = (u: Float64Array, n: number) => {
    const out = new Float64Array(n * n / 4), w = [1, 3, 3, 1];
    for (let j = 0; j < n / 2; j++) for (let i = 0; i < n / 2; i++) {
      let sum = 0;
      for (let b = 0; b < 4; b++) for (let a = 0; a < 4; a++) sum += w[a] * w[b] * u[wrap(2 * j + b - 1, n) * n + wrap(2 * i + a - 1, n)];
      out[j * n / 2 + i] = sum / 64;
    }
    return out;
  };
  const upsample = (c: Float64Array, n: number) => {
    const out = new Float64Array(n * n * 4), m = 2 * n;
    const taps = (f: number): [number, number][] => f % 2 ? [[(f - 1) / 2, .75], [(f + 1) / 2, .25]] : [[f / 2 - 1, .25], [f / 2, .75]];
    for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) {
      let sum = 0;
      for (const [cj, wj] of taps(j)) for (const [ci, wi] of taps(i)) sum += wi * wj * c[wrap(cj, n) * n + wrap(ci, n)];
      out[j * m + i] = sum;
    }
    return out;
  };
  const convolve = (u: Float64Array, n: number, kernel: readonly KernelTap[]) => {
    const out = new Float64Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      let sum = 0;
      for (const tap of kernel) sum += tap.weight * u[wrap(j + tap.y, n) * n + wrap(i + tap.x, n)];
      out[j * n + i] = sum;
    }
    return out;
  };
  const pyramid = [field];
  for (let level = 1; level < levels.length; level++) pyramid.push(reduce(pyramid[level - 1], size >> (level - 1)));
  let collapsed: Float64Array | undefined;
  for (let level = levels.length - 1; level >= 0; level--) {
    const n = size >> level, own = convolve(pyramid[level], n, levels[level]);
    if (collapsed) { const up = upsample(collapsed, n / 2); own.forEach((value, i) => own[i] = value + up[i]); }
    collapsed = own;
  }
  return collapsed!;
}

test('every level of the dispersion pyramid sums to zero', () => {
  for (const coarse of [3, 4, 5]) for (const level of dispersionPyramid(coarse).levels) {
    expect(Math.abs(level.reduce((sum, tap) => sum + tap.weight, 0))).toBeLessThan(1e-9);
  }
});

test('the pyramid follows deep-water |k| from 6 cells to 12 × 2^levels cells in every direction', () => {
  for (const coarse of [3, 4, 5]) {
    const pyramid = dispersionPyramid(coarse);
    for (let wavelength = 6; wavelength <= 12 * 2 ** coarse; wavelength *= 1.25) for (const angle of [0, .2, .4, .6, Math.PI / 4]) {
      const k = 2 * Math.PI / wavelength;
      expect(Math.abs(pyramid.response(k * Math.cos(angle), k * Math.sin(angle)) / k - 1)).toBeLessThan(.04);
    }
  }
});

test('the response is positive over the whole Nyquist square, so every mode oscillates', () => {
  for (const coarse of [3, 4, 5]) {
    const pyramid = dispersionPyramid(coarse);
    let smallest = Infinity, largest = 0;
    for (let x = 0; x <= 48; x++) for (let y = 0; y <= 48; y++) if (x || y) {
      const value = pyramid.response(x / 48 * Math.PI, y / 48 * Math.PI);
      smallest = Math.min(smallest, value); largest = Math.max(largest, value);
    }
    expect(smallest).toBeGreaterThan(0);
    expect(largest).toBeLessThan(1.6);
  }
});

test('reduce and collapse on a real grid match the fitted response with little aliasing', () => {
  const size = 128, pyramid = dispersionPyramid(3);
  for (const [p, q] of [[2, 0], [2, 1], [4, 0], [3, 3], [8, 2], [12, 5], [16, 0], [20, 6]]) {
    const kx = 2 * Math.PI * p / size, ky = 2 * Math.PI * q / size, k = Math.hypot(kx, ky);
    const field = new Float64Array(size * size);
    for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) field[j * size + i] = Math.cos(kx * i + ky * j);
    const result = applyPyramid(pyramid.levels, field, size);
    let projection = 0, energy = 0;
    field.forEach((value, i) => { projection += value * result[i]; energy += value * value; });
    const response = projection / energy;
    let residual = 0, total = 0;
    result.forEach((value, i) => { residual += (value - response * field[i]) ** 2; total += value * value; });
    expect(Math.abs(response / pyramid.response(kx, ky) - 1)).toBeLessThan(.03);
    expect(Math.abs(response / k - 1)).toBeLessThan(.05);
    expect(Math.sqrt(residual / total)).toBeLessThan(.06);
  }
});
