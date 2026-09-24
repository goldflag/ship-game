import { expect, test } from 'bun:test';
import { deflateSync } from 'node:zlib';
import { OPEN_SEA_M, decodeHeightfield, terrainHeight, terrainLandWithin } from './heightfield';

/** The same 3 x 4 field as `terrain::tests` in naval-sim, so both decoders answer alike. */
function encode(columns: number, rows: number, quanta: number[]): Uint8Array {
  const residuals = new DataView(new ArrayBuffer(quanta.length * 2));
  for (let j = 0; j < rows; j++) for (let i = 0; i < columns; i++) {
    const at = j * columns + i;
    const left = i > 0 ? quanta[at - 1] : 0, up = j > 0 ? quanta[at - columns] : 0, upLeft = i > 0 && j > 0 ? quanta[at - columns - 1] : 0;
    residuals.setInt16(at * 2, quanta[at] - left - up + upLeft, true);
  }
  const payload = deflateSync(new Uint8Array(residuals.buffer), { level: 9 });
  const header = new DataView(new ArrayBuffer(36));
  new Uint8Array(header.buffer).set([78, 84, 70, 49]);
  header.setUint32(4, columns, true); header.setUint32(8, rows, true);
  [40, -40, -80, 0.25].forEach((value, k) => header.setFloat32(12 + k * 4, value, true));
  header.setUint32(28, 0, true); header.setUint32(32, payload.byteLength, true);
  const bytes = new Uint8Array(36 + payload.byteLength);
  bytes.set(new Uint8Array(header.buffer)); bytes.set(payload, 36);
  return bytes;
}

test('decodes planar residuals and samples exactly like the Rust battle', async () => {
  const field = await decodeHeightfield(encode(3, 4, [-8, -8, -8, -8, 400, -8, -8, 800, 1200, -8, -8, -8]));
  expect([field.columns, field.rows]).toEqual([3, 4]);
  expect(field.sample(1, 1)).toBe(100);
  expect(field.height(0, -40)).toBe(100);
  expect(field.height(20, -20)).toBe((100 * 0.5 - 2 * 0.5) * 0.5 + (200 * 0.5 + 300 * 0.5) * 0.5);
  expect(field.height(41, 0)).toBe(OPEN_SEA_M);
  expect(field.height(Number.NaN, 0)).toBe(OPEN_SEA_M);
  expect(field.bounds()).toEqual([-40, -80, 40, 40]);
  expect(field.landWithin(0, -60, 20)).toBe(true);
  expect(field.landWithin(-40, -80, 39)).toBe(false);
  expect(field.landWithin(-40, -80, 40 * Math.SQRT2)).toBe(true);
  expect(field.landWithin(5000, 5000, 100)).toBe(false);
  const placed = { field, offset: [0, -1000] as const };
  expect(terrainHeight(placed, 0, -1040)).toBe(100);
  expect(terrainLandWithin(placed, 0, -1060, 20)).toBe(true);
  expect(terrainLandWithin(undefined, 0, 0, 1e6)).toBe(false);
});

test('rejects truncated or foreign bytes', async () => {
  const bytes = encode(3, 4, Array(12).fill(0));
  await expect(decodeHeightfield(bytes.subarray(0, bytes.length - 1))).rejects.toThrow('Invalid terrain');
  await expect(decodeHeightfield(new Uint8Array([80, 78, 71, 0]))).rejects.toThrow('Invalid terrain');
});
