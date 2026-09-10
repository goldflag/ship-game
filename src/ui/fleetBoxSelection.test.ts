import { expect, test } from 'bun:test';
import { fleetBoxSelection, fleetDragMode } from './fleetBoxSelection';
import type { Vec3 } from '../ships/blueprint';

const contains = ([x, , z]: Vec3) => x >= 10 && x <= 20 && z >= 10 && z <= 20;
const planes = [{ id: 'wingman', flightId: 'carrier-a/flight', position: [15, 200, 15] as Vec3 },
  { id: 'leader-outside', flightId: 'carrier-a/flight', position: [300, 200, 300] as Vec3 },
  { id: 'another-carrier', flightId: 'carrier-b/flight', position: [17, 300, 17] as Vec3 }];
test('boxing individual planes selects their flights across carriers even on the Ships tab', () => {
  expect(fleetBoxSelection([], planes, 'ships', contains)).toEqual({ kind: 'aircraft', ids: ['carrier-a/flight', 'carrier-b/flight'] });
});
test('mixed boxes use the active tab, deduplicate flights and still select ships from the Aircraft tab', () => {
  const ships = [{ id: 'ship', position: [15, 0, 15] as Vec3 }];
  expect(fleetBoxSelection(ships, planes, 'ships', contains)).toEqual({ kind: 'ships', ids: ['ship'] });
  expect(fleetBoxSelection(ships, [...planes, planes[0]], 'aircraft', contains)).toEqual({ kind: 'aircraft', ids: ['carrier-a/flight', 'carrier-b/flight'] });
  expect(fleetBoxSelection(ships, [], 'aircraft', contains)).toEqual({ kind: 'ships', ids: ['ship'] });
});
test('Shift-left drag selects, Ctrl/Cmd adds to the box selection, and unshifted modifiers orbit', () => {
  expect(fleetDragMode(0, true, false, false)).toBe('select');
  expect(fleetDragMode(0, true, true, false)).toBe('select');
  expect(fleetDragMode(0, false, true, false)).toBe('orbit');
  expect(fleetDragMode(1, true, false, false)).toBe('orbit');
  expect(fleetDragMode(0, true, false, true)).toBe('pan');
});
