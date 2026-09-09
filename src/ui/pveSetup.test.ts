import { expect, test } from 'bun:test';
import { moveFormation, budgetError, aircraftCount } from './pveSetup';

test('deployment rotation preserves escort spacing and unselected ships', () => {
  const ships = [{ id: 'carrier', spawn: { x: 0, z: 16000, heading: 0 } }, { id: 'escort', spawn: { x: 800, z: 16000, heading: 0 } }, { id: 'front', spawn: { x: 0, z: 8000, heading: 0 } }];
  const next = moveFormation(ships, ['carrier', 'escort'], 2000, 17000, Math.PI / 2);
  expect(next[0].spawn.x).toBeCloseTo(2000); expect(next[0].spawn.z).toBeCloseTo(16600);
  expect(next[1].spawn.x).toBeCloseTo(2000); expect(next[1].spawn.z).toBeCloseTo(17400);
  expect(next[0].spawn.heading).toBeCloseTo(Math.PI / 2);
  expect(next[2]).toBe(ships[2]);
  expect(ships[0].spawn.z).toBe(16000);
});
test('fleet allowance feedback uses authored aircraft totals, not a carrier count', () => {
  const budget = { maxShips: 15, maxAircraft: 100, maxDisplacementKg: 200000000 };
  const carrier = (id: string, presetId: string) => ({ id, presetId, groupId: 'rear' });
  expect(aircraftCount('enterprise-cv6')).toBeGreaterThan(0);
  const pair = [carrier('cv1', 'enterprise-cv6'), carrier('cv2', 'enterprise-cv6')];
  expect(budgetError(pair, budget)).toBe('');
  expect(budgetError([...pair, carrier('cv3', 'enterprise-cv6')], budget)).toContain('aircraft');
  expect(budgetError([], budget)).toContain('at least one');
});
