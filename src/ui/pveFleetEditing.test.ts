import { expect, test } from 'bun:test';
import type { PveRequest } from '../multiplayer/generated/PveRequest';
import { transferFleetShip } from './pveFleetEditing';

const budget = { maxShips: 15, maxAircraft: 100, maxDisplacementKg: 200000000 };
const initial = (): PveRequest => ({ version: 1, seed: 123, mapId: 'pacific-islands', weather: 'partly-cloudy', difficulty: 'normal', groups: [{ id: 'front', name: 'Group 1', station: 'front' }, { id: 'rear', name: 'Group 2', station: 'rear' }], ships: [{ id: 'unit-1', presetId: 'fletcher', groupId: 'front' }] });

test('moving a ship between groups preserves its identity and the frozen mission choices', () => {
  const request = initial(), before = structuredClone(request);
  const result = transferFleetShip(request, { kind: 'unit', id: 'unit-1' }, 'rear', 'unused', ['fletcher'], budget);
  expect(result.error).toBeUndefined();
  expect(result.request).toEqual({ ...before, ships: [{ id: 'unit-1', presetId: 'fletcher', groupId: 'rear' }] });
  expect(request).toEqual(before);
});

test('catalog drops allow duplicates with distinct identities and enforce the shared aircraft allowance', () => {
  const eligible = ['enterprise-cv6'];
  const first = transferFleetShip(initial(), { kind: 'catalog', id: 'enterprise-cv6' }, 'rear', 'unit-2', eligible, budget);
  const second = transferFleetShip(first.request, { kind: 'catalog', id: 'enterprise-cv6' }, 'rear', 'unit-3', eligible, budget);
  expect(second.error).toBeUndefined();
  expect(second.request.ships.map(ship => ship.id)).toEqual(['unit-1', 'unit-2', 'unit-3']);
  const third = transferFleetShip(second.request, { kind: 'catalog', id: 'enterprise-cv6' }, 'rear', 'unit-4', eligible, budget);
  expect(third.error).toContain('aircraft allowance');
  expect(third.request).toBe(second.request);
});

test('stale or foreign drops cannot mutate the request', () => {
  const request = initial();
  for (const [transfer, destination] of [[{ kind: 'unit', id: 'missing' }, 'rear'], [{ kind: 'catalog', id: 'unknown' }, 'rear'], [{ kind: 'unit', id: 'unit-1' }, 'missing']] as const) {
    const result = transferFleetShip(request, transfer, destination, 'unit-2', ['fletcher'], budget);
    expect(result.error).toBeTruthy();
    expect(result.request).toBe(request);
  }
});
