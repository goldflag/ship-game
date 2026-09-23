import { expect, test } from 'bun:test';
import { fftRadices, stockhamInputs } from './fft';

test('radices cover each size in the fewest passes', () => {
  expect(fftRadices(256)).toEqual([16, 16]);
  expect(fftRadices(512)).toEqual([8, 8, 8]);
  expect(fftRadices(128)).toEqual([16, 8]);
  expect(fftRadices(1024)).toEqual([16, 8, 8]);
  expect(fftRadices(16)).toEqual([16]);
  expect(() => fftRadices(300)).toThrow();
});

test('the per-output Stockham passes equal an inverse DFT', () => {
  for (const n of [8, 32, 128, 256, 512]) {
    const re = Array.from({ length: n }, (_, i) => Math.sin(i * 1.7) + (i % 5) * .3);
    const im = Array.from({ length: n }, (_, i) => Math.cos(i * .9) - (i % 3) * .2);
    let x = { re: [...re], im: [...im] }, span = 1;
    for (const radix of fftRadices(n)) {
      const y = { re: new Array<number>(n).fill(0), im: new Array<number>(n).fill(0) };
      for (let j = 0; j < n; j++) {
        const { first, stride, angle } = stockhamInputs(n, radix, span, j);
        for (let r = 0; r < radix; r++) {
          const c = Math.cos(r * angle), s = Math.sin(r * angle), a = x.re[first + r * stride], b = x.im[first + r * stride];
          y.re[j] += a * c - b * s; y.im[j] += a * s + b * c;
        }
      }
      x = y; span *= radix;
    }
    for (let j = 0; j < n; j++) {
      let sr = 0, si = 0;
      for (let k = 0; k < n; k++) {
        const t = 2 * Math.PI * j * k / n;
        sr += re[k] * Math.cos(t) - im[k] * Math.sin(t); si += re[k] * Math.sin(t) + im[k] * Math.cos(t);
      }
      expect(x.re[j]).toBeCloseTo(sr, 8);
      expect(x.im[j]).toBeCloseTo(si, 8);
    }
  }
});
