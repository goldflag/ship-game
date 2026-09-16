import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { encodeRuntimeDefinition as encode, decodeRuntimeDefinition as decode } from './runtimeEncoding';
import { runtimeProjection } from './runtimeProjection';
import type { ShipDefinition } from './blueprint';
describe('lossless runtime definition encoding', () => {
  test('preserves exact doubles, keys, IDs and array order; shares immutable equal geometry', () => {
    const cell = { faces: [{ vertices: [[0, -0, 1.0000000000000002], [Math.PI, 1e-15, -93.578]] }] };
    const source = { stableId: 'mount-a.barrel-1.muzzle', cells: [cell, structuredClone(cell)], empty: [], nothing: null, flags: [true, false] };
    const encoded = encode(source), copy = decode<typeof source>(encoded);
    expect(copy).toEqual(source); expect(Object.is(copy.cells[0].faces[0].vertices[0][1], -0)).toBe(true);
    expect(copy.cells[0]).toBe(copy.cells[1]); expect(Object.isFrozen(copy.cells[0].faces)).toBe(true);
    expect(encode({ z: 1, a: source })).toEqual(encode({ a: source, z: 1 }));
  });
  test('rejects truncation, unknown versions, trailing data and forward references', () => {
    const bytes = encode({ a: [[1, 2, 3]], b: 'foo' });
    for (let i = 0; i < bytes.length; i++) expect(() => decode(bytes.subarray(0, i))).toThrow();
    expect(() => decode(new Uint8Array([...bytes, 0]))).toThrow();
    const future = bytes.slice(); future[3] = 2;
    expect(() => decode(future)).toThrow();
    expect(() => decode(new Uint8Array([78, 83, 68, 1, 1, 0, 5, 1, 0]))).toThrow();
    expect(() => encode(NaN)).toThrow();
    expect(() => encode({ missing: undefined })).toThrow('non-JSON value');
    expect(() => encode([undefined])).toThrow('non-JSON value');
  });
  test('published Hipper is exact and deterministic without quantization', () => {
    const original = JSON.parse(readFileSync('public/models/admiral-hipper-construction.json', 'utf8'));
    const bytes = encode(original);
    expect(decode(bytes)).toEqual(original);
    expect(encode(original)).toEqual(bytes);
    expect(bytes.length).toBeLessThan(25_000_000);
  }, 30_000);
  test('runtime projection retains auxiliary power ratings and leaves editable source intact', () => {
    const source = JSON.parse(readFileSync('public/models/admiral-hipper-construction.json', 'utf8')) as ShipDefinition;
    const original = JSON.stringify(source);
    const runtime = runtimeProjection(source);
    const equipment = source.loading!.contributions.filter(c => c.kind === 'equipment');
    expect(equipment.length).toBeGreaterThan(0);
    expect(runtime.loading!.contributions).toEqual(equipment);
    expect({ ...runtime.loading, contributions: [] }).toEqual({ ...source.loading, contributions: [] });
    expect(runtime.construction!.equipment).toBe(source.construction!.equipment);
    expect(runtime.construction!.primitives).toEqual([]);
    expect(source.construction!.primitives.length).toBeGreaterThan(0);
    expect(JSON.stringify(source)).toBe(original);
  });
});
