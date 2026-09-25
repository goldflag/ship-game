import { expect, test } from 'bun:test';
import { inflateSync } from 'node:zlib';
import { compareCuts, crc32, cut, drawSections, encodePng, parseSections } from './sections';
import type { MeshView } from '../construction/slice';

/** A 10 m wide, 7 m deep box from z = -20 to 20, keel at y = -4. */
function box(half = 5): MeshView {
  const p = [[-half, -4, -20], [half, -4, -20], [half, 3, -20], [-half, 3, -20], [-half, -4, 20], [half, -4, 20], [half, 3, 20], [-half, 3, 20]].flat();
  const faces = [[0, 1, 2, 0, 2, 3], [4, 6, 5, 4, 7, 6], [0, 4, 5, 0, 5, 1], [3, 2, 6, 3, 6, 7], [0, 3, 7, 0, 7, 4], [1, 5, 6, 1, 6, 2]].flat();
  return { positions: Float32Array.from(p), index: Uint32Array.from(faces), ranges: [{ first: 0, count: faces.length / 3 }] };
}

test('section specs', () => {
  expect(parseSections('z=-40,y=6.5,x=0')).toEqual([{ axis: 'z', value: -40 }, { axis: 'y', value: 6.5 }, { axis: 'x', value: 0 }]);
  expect(() => parseSections('z:-40')).toThrow('axis=value');
});

test('an offset reference is cut at the shifted plane and drawn in the ship frame', () => {
  // Shifted up 1 m, the reference's keel reads -3; cut at z = 19.5 it is still inside the box after a 1 m aft shift.
  const segments = cut(box(), { axis: 'z', value: 20.5 }, [0, 1, 1]);
  const ys = segments.flat().map((p) => p[1]);
  expect(Math.min(...ys)).toBeCloseTo(-3, 6);
  expect(Math.max(...ys)).toBeCloseTo(4, 6);
  expect(cut(box(), { axis: 'z', value: 20.5 })).toEqual([]);
});

test('half-breadth differences of two stations', () => {
  const spec = { axis: 'z' as const, value: 0 };
  const difference = compareCuts(spec, cut(box(5), spec), cut(box(5.5), spec))!;
  expect(difference.difference).toBeCloseTo(0.5, 6);
  expect(difference.mean).toBeCloseTo(0.5, 6);
  expect(compareCuts({ axis: 'x', value: 0 }, [], [])).toBeUndefined();
});

test('the drawing is a valid PNG with both outlines', () => {
  const spec = { axis: 'y' as const, value: 0 };
  const drawing = drawSections(spec, cut(box(5), spec), cut(box(5.5), spec), 600);
  expect(drawing.png.subarray(1, 4).toString('ascii')).toBe('PNG');
  expect(drawing.right).toBe('-z (bow)');
  // IDAT inflates to one filter byte plus RGB per row; red and blue pixels are both present.
  const idat = drawing.png.indexOf('IDAT');
  const length = drawing.png.readUInt32BE(idat - 4);
  const raw = inflateSync(drawing.png.subarray(idat + 4, idat + 4 + length));
  expect(raw.length).toBe((drawing.width * 3 + 1) * drawing.height);
  let red = 0, blue = 0;
  for (let i = 0; i + 2 < raw.length; i++) {
    if (raw[i] === 215 && raw[i + 1] === 40 && raw[i + 2] === 40) red++;
    if (raw[i] === 40 && raw[i + 1] === 90 && raw[i + 2] === 220) blue++;
  }
  expect(red).toBeGreaterThan(0);
  expect(blue).toBeGreaterThan(0);
});

test('PNG chunks carry standard CRCs', () => {
  expect(crc32(Buffer.from('IEND'))).toBe(0xae426082);
  const png = encodePng(new Uint8Array([255, 0, 0]), 1, 1);
  expect(png.subarray(png.length - 4).readUInt32BE(0)).toBe(0xae426082);
});
