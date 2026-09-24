/** `Matrix4.compose(position, quaternion, scale)` written straight into an instance array at `offset`: the same operations in
 * the same order as three's, so the stored floats are identical, without a Matrix4 in between or the copy `setMatrixAt` makes. */
export function writeInstancePose(target: Float32Array, offset: number, px: number, py: number, pz: number,
  x: number, y: number, z: number, w: number, sx: number, sy: number, sz: number): void {
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  target[offset] = (1 - (yy + zz)) * sx; target[offset + 1] = (xy + wz) * sx; target[offset + 2] = (xz - wy) * sx; target[offset + 3] = 0;
  target[offset + 4] = (xy - wz) * sy; target[offset + 5] = (1 - (xx + zz)) * sy; target[offset + 6] = (yz + wx) * sy; target[offset + 7] = 0;
  target[offset + 8] = (xz + wy) * sz; target[offset + 9] = (yz - wx) * sz; target[offset + 10] = (1 - (xx + yy)) * sz; target[offset + 11] = 0;
  target[offset + 12] = px; target[offset + 13] = py; target[offset + 14] = pz; target[offset + 15] = 1;
}

const probe = new Uint32Array(new Float64Array([1]).buffer);
/** Index of the low 32-bit word of a float64 in a Uint32Array view: 0 on little-endian machines. */
const LOW = probe[0] === 0 ? 0 : 1, HIGH = 1 - LOW;
let keys = new Float64Array(0), words = new Uint32Array(0), highs = new Uint32Array(0), order = new Uint32Array(0), spare = new Uint32Array(0);
/** One 256-bucket histogram per byte of the high words. */
const counts = new Uint32Array(1024);

/** Scratch for `sortDescending`: fill `keys[0, n)` and call it before anything else claims the scratch (one caller at a time). */
export function sortKeys(n: number): Float64Array {
  if (keys.length < n) {
    const size = Math.max(n, keys.length * 2, 64);
    keys = new Float64Array(size); words = new Uint32Array(keys.buffer); highs = new Uint32Array(size); order = new Uint32Array(size); spare = new Uint32Array(size);
  }
  return keys;
}

/** The permutation of `sortKeys()[0, n)` a stable `Array.prototype.sort((a, b) => b - a)` gives: descending, equal keys in
 * their original order. Keys must be finite and not -0 (squared distances are), so their bits order as their values do. An
 * LSD radix sort over the complemented high words (sign, exponent and top of the mantissa), skipping bytes every key shares,
 * then a stable insertion over each run of equal high words by the low words, orders exactly the way the comparison sort
 * does, several times faster. */
export function sortDescending(n: number): Uint32Array {
  let from = order, to = spare;
  for (let i = 0; i < n; i++) from[i] = i;
  if (n < 48) {
    // Stable insertion: move each key ahead of the smaller ones.
    for (let i = 1; i < n; i++) {
      const index = from[i], key = keys[index];
      let j = i - 1;
      while (j >= 0 && keys[from[j]] < key) { from[j + 1] = from[j]; j--; }
      from[j + 1] = index;
    }
    return from;
  }
  // Every byte's histogram in one read of the keys.
  counts.fill(0);
  for (let i = 0; i < n; i++) {
    const high = ~words[i * 2 + HIGH] >>> 0;
    highs[i] = high;
    counts[high & 255]++; counts[256 + ((high >>> 8) & 255)]++; counts[512 + ((high >>> 16) & 255)]++; counts[768 + (high >>> 24)]++;
  }
  for (let pass = 0; pass < 4; pass++) {
    const base = pass * 256, shift = pass * 8;
    let shared = false;
    for (let b = base; b < base + 256; b++) if (counts[b]) { shared = counts[b] === n; break; }
    if (shared) continue;
    let sum = 0;
    for (let b = base; b < base + 256; b++) { const count = counts[b]; counts[b] = sum; sum += count; }
    for (let i = 0; i < n; i++) { const index = from[i]; to[counts[base + ((highs[index] >>> shift) & 255)]++] = index; }
    const swap = from; from = to; to = swap;
  }
  // Equal high words keep their original order so far: order each such run by the low words, larger first, equal keys in place.
  for (let start = 0; start < n - 1;) {
    const high = highs[from[start]];
    let end = start + 1;
    while (end < n && highs[from[end]] === high) end++;
    if (end - start > 32) sortLows(from, to, start, end);
    else for (let i = start + 1; i < end; i++) {
      const index = from[i], low = words[index * 2 + LOW];
      let j = i - 1;
      while (j >= start && words[from[j] * 2 + LOW] < low) { from[j + 1] = from[j]; j--; }
      from[j + 1] = index;
    }
    start = end;
  }
  order = from; spare = to;
  return from;
}

/** A long run of equal high words: the same radix sort over the complemented low words of `from[start, end)`, `to` as scratch. */
function sortLows(from: Uint32Array, to: Uint32Array, start: number, end: number): void {
  const n = end - start;
  let source = from, target = to;
  for (let pass = 0; pass < 4; pass++) {
    const shift = pass * 8;
    counts.fill(0, 0, 256);
    for (let i = start; i < end; i++) counts[(~words[source[i] * 2 + LOW] >>> shift) & 255]++;
    let shared = false;
    for (let b = 0; b < 256; b++) if (counts[b]) { shared = counts[b] === n; break; }
    if (shared) continue;
    let sum = start;
    for (let b = 0; b < 256; b++) { const count = counts[b]; counts[b] = sum; sum += count; }
    for (let i = start; i < end; i++) { const index = source[i]; target[counts[(~words[index * 2 + LOW] >>> shift) & 255]++] = index; }
    const swap = source; source = target; target = swap;
  }
  if (source !== from) from.set(source.subarray(start, end), start);
}
