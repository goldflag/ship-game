/** Inverse FFT layout shared by the GPU passes and their CPU check. A Stockham transform writes
 * one output per fragment: for a pass of radix R after sub-transforms of length p,
 *
 *   y[j] = Σ_{r<R} x[i + r·N/R] · e^{2πi·r·q/(R·p)},  q = j mod R·p,  i = ⌊j/(R·p)⌋·p + j mod p,
 *
 * and the passes run with p = 1, R₁, R₁R₂, … so the result lands in natural order. */

/** Radices (each at most 16) that transform `n` points in the fewest passes; every render pass
 * costs CPU time in three.js, while a wider radix only costs texture reads. */
export function fftRadices(n: number): number[] {
  const bits = Math.log2(n);
  if (!Number.isInteger(bits) || bits < 1) throw new Error(`FFT size ${n} is not a power of two`);
  const passes = Math.ceil(bits / 4);
  return Array.from({ length: passes }, (_, i) => 2 ** (Math.floor(bits / passes) + (i < bits % passes ? 1 : 0)));
}

/** Where output `j` of a pass reads: the first input index, the stride to the next, and the
 * twiddle angle step θ (input r is weighted by e^{i·r·θ}). */
export function stockhamInputs(n: number, radix: number, span: number, j: number): { first: number; stride: number; angle: number } {
  const block = radix * span;
  return { first: Math.floor(j / block) * span + j % span, stride: n / radix, angle: 2 * Math.PI * (j % block) / block };
}
