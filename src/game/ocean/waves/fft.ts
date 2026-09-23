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
