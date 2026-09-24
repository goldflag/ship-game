import { expect, test } from 'bun:test';
import { Matrix4, Quaternion, Vector3 } from 'three/webgpu';
import { sortDescending, sortKeys, writeInstancePose } from './instancePose';

const seeded = (seed: number) => { let s = seed >>> 0; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296; };
const bits = (values: Float32Array) => Array.from(new Uint32Array(values.buffer, values.byteOffset, values.length));

test('an instance pose written in place stores the floats Matrix4.compose and setMatrixAt store', () => {
  const random = seeded(3), matrix = new Matrix4();
  for (let i = 0; i < 2000; i++) {
    const position = new Vector3((random() - .5) * 1e4, (random() - .5) * 300, (random() - .5) * 1e4);
    const rotation = new Quaternion(random() - .5, random() - .5, random() - .5, random() - .5).normalize();
    // Zeros of either sign and degenerate scales, as sprites and collapsed ribbons produce.
    if (i % 7 === 0) rotation.set(0, -0, i % 2 ? -0 : 0, 1);
    const scale = new Vector3(random() * 40, i % 5 ? random() * 40 : 0, i % 3 ? 1 : random());
    const expected = new Float32Array(32), actual = new Float32Array(32);
    matrix.compose(position, rotation, scale).toArray(expected, 16);
    writeInstancePose(actual, 16, position.x, position.y, position.z, rotation.x, rotation.y, rotation.z, rotation.w, scale.x, scale.y, scale.z);
    expect(bits(actual)).toEqual(bits(expected));
  }
});

test('the radix order is the order a stable comparison sort gives, ties included', () => {
  const random = seeded(11);
  for (const n of [0, 1, 2, 7, 47, 48, 49, 300, 1165, 4000]) for (let round = 0; round < 6; round++) {
    const keys = sortKeys(n), values: number[] = [];
    // Keys a few units in the last place apart share their high words: short runs of them, and one long run.
    const near = (base: number, spread: number) => base + Math.floor(random() * spread) * 2 ** (Math.floor(Math.log2(base)) - 52);
    const clusters = Array.from({ length: 12 }, () => 1 + random() * 1e6);
    for (let i = 0; i < n; i++) {
      // Squared distances: wide range, whole-number ties, repeated values and exact zeros.
      const value = round === 0 ? Math.floor(random() * 50) : round === 1 ? random() * 1e8 : round === 2 ? (random() < .2 ? 0 : random() ** 8 * 1e6) : round === 3 ? 42
        : round === 4 ? (random() < .3 ? random() * 1e6 : near(clusters[Math.floor(random() * 12)], 40)) : near(4096.5, 1e6);
      keys[i] = value; values.push(value);
    }
    const expected = values.map((value, index) => ({ value, index })).sort((a, b) => b.value - a.value).map(entry => entry.index);
    expect(Array.from(sortDescending(n).subarray(0, n))).toEqual(expected);
  }
});
