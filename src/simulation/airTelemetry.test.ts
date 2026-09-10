import { expect, test } from 'bun:test';
import { shipPreset } from '../ships/presets';
import { CombatSimulation } from './combat';
import { squadronFlights } from './aircraft';
import { airWingTelemetry } from './airTelemetry';

test('native recovery and evasion reasons reach the selected flight without losing return status', () => {
  const sim = new CombatSimulation(shipPreset('enterprise-cv6'));
  const flight = squadronFlights(sim.player).find(f => f.squadronId === 'vb-6')!;
  const p = sim.player.airWing!.planes.find(p => flight.planeIds.includes(p.id))!;
  p.phase = 'returning'; p.flightId = flight.id;
  // Real presentation frames strip pilot state entirely.
  delete (p as Partial<typeof p>).pilot;
  p.behavior = { recoveryNotice: 'Carrier turning too sharply · Steady the course to recover aircraft' };
  const summary = () => airWingTelemetry(sim.player, sim.actors)!.groups.find(f => f.id === flight.id)!;
  expect(summary().status).toBe('returning');
  expect(summary().notice).toContain('Steady the course');
  p.behavior.evasionNotice = 'Evading fighter';
  expect(summary().status).toBe('returning');
  expect(summary().activity).toBe('Returning · Evading');
  expect(summary().notice).toBe('Evading fighter');
});
