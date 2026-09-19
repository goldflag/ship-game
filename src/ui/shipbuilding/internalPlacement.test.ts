import { expect, test } from 'bun:test';
import type { Vec3 } from '../../ships/blueprint';
import { baseFootprint, interiorFloor, type HullCrossing } from './internalPlacement';

const deckTop: HullCrossing = { point: [0, 6, 0], outward: [0, 1, 0] };
const bottom: HullCrossing = { point: [0, 0, 0], outward: [0, -1, 0] };
const down: Vec3 = [0, -1, 0];

test('an internal package passes the weather deck to the inner hull bottom', () => {
  expect(interiorFloor([deckTop, bottom], down).floor).toBe(bottom);
});

test('a deck crossed from above inside the hull is the floor; one above the hull is not', () => {
  const tween: HullCrossing = { point: [0, 3, 0], outward: [0, 1, 0], deck: true };
  expect(interiorFloor([deckTop, tween, bottom], down).floor).toBe(tween);
  expect(interiorFloor([{ ...tween, point: [0, 9, 0] }, deckTop, bottom], down).floor).toBe(bottom);
});

test('a ray through both sides reports its span, and a ray starting inside lands on the deck beneath', () => {
  const port: HullCrossing = { point: [-5, 3, 0], outward: [-1, 0, 0] }, starboard: HullCrossing = { point: [5, 3, 0], outward: [1, 0, 0] };
  const through = interiorFloor([port, starboard], [1, 0, 0]);
  expect(through.floor).toBeUndefined();
  expect(through.span).toEqual([port.point, starboard.point]);
  const tween: HullCrossing = { point: [0, 2, 0], outward: [0, 1, 0], deck: true };
  expect(interiorFloor([tween, bottom], down).floor).toBe(bottom);
  expect(interiorFloor([tween, bottom], down, true).floor).toBe(tween);
});

test('the base footprint turns with the bearing', () => {
  const corners = baseFootprint({ kind: 'equipment', size: [2, 3, 8], boundsCenter: [0, 1.5, 0], bearingDeg: 90 }, [10, 1, 20]);
  expect(corners[0]).toEqual([10, 1, 20]);
  expect(Math.max(...corners.map(corner => Math.abs(corner[0] - 10)))).toBeCloseTo(4);
  expect(Math.max(...corners.map(corner => Math.abs(corner[2] - 20)))).toBeCloseTo(1);
  expect(corners.every(corner => Math.abs(corner[1] - 1) < 1e-9)).toBe(true);
});
