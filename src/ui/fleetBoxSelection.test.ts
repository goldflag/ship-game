import { expect, test } from 'bun:test';
import { fleetBoxSelection, fleetDragMode, fleetWaterAction } from './fleetBoxSelection';
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

test('a destination is one click: plain sends and releases, Shift extends, right leaves the move', () => {
  const water = { right: false, shift: false, flights: false, lead: true };
  expect(fleetWaterAction('move', water)).toBe('move');
  expect(fleetWaterAction('move', { ...water, shift: true })).toBe('move');
  expect(fleetWaterAction('move', { ...water, right: true })).toBe('cancel-move');
  // Outside the move order the chart keeps its own idioms: right-click orders, plain clears.
  expect(fleetWaterAction(undefined, { ...water, right: true })).toBe('move');
  expect(fleetWaterAction(undefined, { ...water, shift: true })).toBe('move');
  expect(fleetWaterAction(undefined, { ...water, shift: true, lead: false })).toBe('clear');
  expect(fleetWaterAction(undefined, water)).toBe('clear');
  // An armed order that wants a unit ignores water rather than clearing the selection.
  expect(fleetWaterAction('other', water)).toBeUndefined();
});

test('selected air groups take the water click before any ship order does', () => {
  const air = { right: false, shift: false, flights: true, lead: true };
  expect(fleetWaterAction('search', air)).toBe('search');
  expect(fleetWaterAction('squadron', air)).toBe('air');
  expect(fleetWaterAction(undefined, { ...air, right: true })).toBe('air');
  expect(fleetWaterAction(undefined, { ...air, shift: true })).toBe('clear');
  expect(fleetWaterAction('search', { ...air, flights: false })).toBeUndefined();
});
