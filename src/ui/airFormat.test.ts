import { expect, test } from 'bun:test';
import { mission } from './airFormat';
import { airWingTelemetry } from '../simulation/airTelemetry';
import { CombatSimulation } from '../simulation/combat';
import { shipPreset } from '../ships/presets';

test('returning and landed groups describe current activity rather than their old search order', () => {
  const sim = new CombatSimulation(shipPreset('enterprise-cv6'));
  const base = airWingTelemetry(sim.player, sim.actors)!.groups[0];
  const order = { kind: 'search-area' as const, center: [0, 0] as [number, number], radiusM: 2000, altitude: 'medium' as const, policy: 'report' as const };
  expect(mission({ ...base, order, status: 'on-mission', activity: 'Searching' })).toContain('Search and report');
  for (const [status, activity] of [['returning', 'Returning'], ['servicing', 'Servicing'], ['hangar', 'In hangar'], ['ready', 'Ready'], ['lost', 'Lost']] as const) {
    expect(mission({ ...base, order, status, activity })).toBe(activity);
  }
});
