import { expect, test } from 'bun:test';
import type { ConstructionSource, Vec3 } from '../../ships/blueprint';
import { mirroredPrimitive } from '../../ships/constructionEditor';
import { rotateBlock } from '../../ships/constructionOrientation';
import { attachmentOffset, fillLattice, mirrorTwin, pieceExtents, placementCenter, strokeSegment } from './placement';

test('underside propeller placement leaves the entire blade sweep below the hull', () => {
  const position = placementCenter({ kind: 'equipment', size: [4.3, 4.3, 2.32], boundsCenter: [0, 0, -.16], bearingDeg: 0, propellerDiameterM: 4.3,
    sockets: [{ id: 'attachment', kind: 'shaft', position: [0, 0, -1.32], direction: [0, 0, -1] }] }, { point: [2, -3, 20], normal: [0, -1, 0] }, .25);
  expect(position[1] + 4.3 / 2).toBeLessThan(-3);
  expect(position[0]).toBe(2);
  expect(position[2]).toBe(21.25);
});

test('a hull piece rests on the hit face and snaps its corner to the grid in the face plane', () => {
  const cube = { kind: 'hull' as const, shape: 'box' as const, size: [1, 1, 1] as [number, number, number], rotationDeg: 0 };
  expect(placementCenter(cube, { point: [2.3, 2.5, -7.6], normal: [0, 1, 0] }, 1)).toEqual([2.5, 3, -7.5]);
  const slab = { ...cube, size: [4, 1, 4] as [number, number, number] };
  expect(placementCenter(slab, { point: [3.9, 2.5, 0.2], normal: [0, 1, 0] }, 1)).toEqual([4, 3, 0]);
  expect(placementCenter(slab, { point: [4, 0.4, 1.7], normal: [1, 0, 0] }, 1)).toEqual([6, 0.5, 2]);
  expect(placementCenter(slab, { point: [1.2, -2.5, 3], normal: [0, 1, 0] }, 1)).toEqual([1, -2, 3]);
});

test('rotated pieces swap their footprint and fittings land on their attachment socket', () => {
  expect(pieceExtents({ kind: 'hull', shape: 'box', size: [1, 2, 4], rotationDeg: 90 })).toEqual([4, 2, 1]);
  const part = { size: [3, 4, 8] as [number, number, number], boundsCenter: [0, 2, 0] as [number, number, number], sockets: [{ id: 'attachment', kind: 'deck', position: [0, -0.5, 1] as [number, number, number], direction: [0, -1, 0] as [number, number, number] }] };
  expect(attachmentOffset(part, 0)).toEqual([0, -0.5, 1]);
  const turned = attachmentOffset(part, 90);
  expect(turned[0]).toBeCloseTo(-1); expect(turned[2]).toBeCloseTo(0);
  const placed = placementCenter({ kind: 'equipment', size: part.size, boundsCenter: part.boundsCenter, bearingDeg: 0, sockets: part.sockets }, { point: [1.1, 2.5, -14.05], normal: [0, 1, 0] }, .25);
  expect(placed).toEqual([1, 3, -15]);
  expect(attachmentOffset({ size: [2, 2, 2], boundsCenter: [0, 1, 0] }, 0)).toEqual([0, 0, 0]);
  const inside = placementCenter({ kind: 'equipment', size: [3, 3, 6], boundsCenter: [0, 1.5, 0], bearingDeg: 0, inset: .016 }, { point: [0.3, -2.5, 5.1], normal: [0, 1, 0] }, .25);
  expect(inside).toEqual([0.25, -2.484, 5]);
  const wall = placementCenter({ kind: 'equipment', size: [3, 3, 6], boundsCenter: [0, 1.5, 0], bearingDeg: 0, inset: .016 }, { point: [-4, -1.2, 5.1], normal: [1, 0, 0] }, .25);
  expect(wall[0]).toBeCloseTo(-2.484); expect(wall[1]).toBe(-1.25); expect(wall[2]).toBe(5);
});

test('fill covers the rectangle between two placements without exceeding the gesture limit', () => {
  const points = fillLattice([0.5, 3, 0.5], [2.5, 3, -1.5], [1, 1, 1], 1);
  expect(points).toHaveLength(9);
  expect(points).toContainEqual([2.5, 3, -1.5]);
  expect(fillLattice([0, 0, 0], [400, 0, 400], [1, 1, 1], 1)).toHaveLength(128);
  expect(strokeSegment([0.5, 3, 0.5], [3.5, 3, 0.5], [1, 1, 1], 1)).toEqual([[1.5, 3, 0.5], [2.5, 3, 0.5], [3.5, 3, 0.5]]);
});

test('deck fittings keep their attachment on the slope after grid snapping', () => {
  const part = { kind: 'equipment' as const, size: [3, 4, 8] as Vec3,
    boundsCenter: [0, 2, 0] as Vec3, bearingDeg: 37,
    sockets: [{ id: 'attachment', kind: 'deck', position: [0, -.5, 1] as Vec3, direction: [0, -1, 0] as Vec3 }] };
  const point: Vec3 = [1.43, 8, -3.47];
  for (const normal of [[0, Math.cos(.08), Math.sin(.08)], [Math.sin(.08), Math.cos(.08), 0]] as Vec3[]) {
    for (const step of [null, .25, 1]) {
      const position = placementCenter(part, { point, normal }, step);
      const socket = attachmentOffset(part, part.bearingDeg);
      const distance = position.reduce((sum, v, i) => sum + (v + socket[i] - point[i]) * normal[i], 0);
      expect(distance).toBeCloseTo(0, 10);
      if (step !== null) {
        expect(position[0] / step).toBeCloseTo(Math.round(position[0] / step));
        expect(position[2] / step).toBeCloseTo(Math.round(position[2] / step));
      }
    }
  }
});

test('slow pointer samples do not pack overlapping fittings into a run', () => {
  const points: [number, number, number][] = [[0, 2.57, 0]];
  for (let x = .25; x <= 8; x += .25) points.push(...strokeSegment(points.at(-1)!, [x, 2.57, 0], [4, 3, 4], 1));
  expect(points).toEqual([[0, 2.57, 0], [4, 2.57, 0], [8, 2.57, 0]]);
});

test('the mirror twin is the piece reflected across the centerline', () => {
  const source = { construction: { primitives: [
    { id: 'a', kind: 'corner', size: [4, 2, 6], position: [5, 1, 0], rotationDeg: 0 },
    { id: 'b', kind: 'corner', size: [6, 2, 4], position: [-5, 1, 0], rotationDeg: 270 },
    { id: 'c', kind: 'box', size: [1, 1, 1], position: [-5, 1, 0], rotationDeg: 0 },
  ] } } as unknown as ConstructionSource;
  expect(mirrorTwin(source, source.construction.primitives[0])?.id).toBe('b');
  expect(mirrorTwin(source, source.construction.primitives[2])).toBeUndefined();
  const centered = { id: 'hull', kind: 'box', size: [8, 5, 48], position: [0, 0, 0], rotationDeg: 0 };
  source.construction.primitives.push(centered as never);
  expect(mirrorTwin(source, centered as never)?.id).toBe('hull');
});


test('new blocks align face to face with the centered starter on every side', () => {
  const cube = { kind: 'hull' as const, shape: 'box' as const, size: [1, 1, 1] as [number, number, number], rotationDeg: 0 };
  for (const axis of [0, 1, 2]) for (const sign of [-1, 1]) {
    const normal: [number, number, number] = [0, 0, 0]; normal[axis] = sign;
    const point: [number, number, number] = [.1, -.1, .2]; point[axis] = sign * .5;
    const expected: [number, number, number] = [0, 0, 0]; expected[axis] = sign;
    expect(placementCenter(cube, { point, normal, snapOrigin: [-.5, -.5, -.5] }, 1)).toEqual(expected);
  }
});


test('balcony placement seats its full deck footprint against a sloping hull side', () => {
  const piece = { kind: 'hull' as const, shape: 'balcony' as const, size: [2, .08, 1] as Vec3, rotationDeg: 0 };
  const normal: Vec3 = [.8, -.6, 0], point: Vec3 = [4, 1, 0];
  const position = placementCenter(piece, { point, normal }, null);
  // The inner top deck corner sits into the slope, regardless of wall height.
  const contact = [position[0] - 1.03, position[1] + .04, position[2]];
  const distance = contact.reduce((sum, v, i) => sum + (v - point[i]) * normal[i], 0);
  expect(distance).toBeLessThanOrEqual(1e-8);
  expect(distance).toBeGreaterThan(-1);
});

test('the complete balcony inner edge seats against sloped and tapered surfaces', () => {
  const piece = { kind: 'hull' as const, shape: 'balcony' as const, size: [1, .08, 2] as Vec3, rotationDeg: 0 };
  for (const normal of [[1, 0, 0], [.8, .6, 0], [.8, -.6, 0], [.8, 0, .6]] as Vec3[]) {
    const point: Vec3 = [4, 0, 0];
    const position = placementCenter(piece, { point, normal }, 1);
    for (const y of [-.04, .04]) for (const z of [-1.03, 1.03]) {
      const corner = [position[0] - .53, position[1] + y, position[2] + z];
      expect(corner.reduce((sum, value, k) => sum + (value - point[k]) * normal[k], 0)).toBeLessThanOrEqual(0);
    }
  }
});

test('twins match by their turned axes and their shape, however the angles are written', () => {
  const tipped = rotateBlock({ id: 'a', kind: 'vertex', size: [2, 1, 4], position: [3, 1, 0], rotationDeg: 90 }, 0, 90);
  const source = { construction: { primitives: [tipped, { ...mirroredPrimitive(tipped), id: 'b' }] } } as unknown as ConstructionSource;
  const [a, b] = source.construction.primitives;
  expect(mirrorTwin(source, a)?.id).toBe('b');
  expect(mirrorTwin(source, b)?.id).toBe('a');
  // The same pose written with a full extra turn is still the twin; a rounded edge on one side is not.
  b.rotationDeg += 360;
  expect(mirrorTwin(source, a)?.id).toBe('b');
  b.shaping = { version: 1, style: 'round', radius: .2, edges: [0] };
  expect(mirrorTwin(source, a)).toBeUndefined();
  expect(mirrorTwin(source, a, new Set(['b']))).toBeUndefined();
});
