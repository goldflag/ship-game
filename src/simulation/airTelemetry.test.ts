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

test('sortie notices expire after the last aircraft lands instead of replacing deck status', () => {
  const sim = new CombatSimulation(shipPreset('enterprise-cv6'));
  const flight = squadronFlights(sim.player).find(f => f.squadronId === 'vf-6')!;
  flight.order = { kind: 'search-area', center: [0, -4000], radiusM: 2000, altitude: 'medium', policy: 'report' };
  flight.notice = 'Scout withdrawing · Preserving aircraft';
  sim.player.airWing!.flights.push(flight);
  const planes = sim.player.airWing!.planes.filter(p => flight.planeIds.includes(p.id));
  planes.forEach(p => { p.flightId = flight.id; p.phase = 'returning'; });
  const summary = () => airWingTelemetry(sim.player, sim.actors)!.groups.find(f => f.id === flight.id)!;
  expect(summary().notice).toBe(flight.notice);
  for (const p of planes.slice(1)) { p.phase = 'parking'; p.deckSlot = 0; }
  expect(summary().notice).toBe(flight.notice);
  for (const phase of ['rollout', 'parking', 'rearming', 'ready', 'hangar', 'repairing', 'raising', 'lowering', 'lost', 'withdrawn'] as const) {
    planes.forEach(p => { p.phase = phase; p.deckSlot = ['rollout', 'parking', 'ready', 'rearming'].includes(phase) ? 0 : undefined; });
    expect(summary().notice).toBeUndefined();
    expect(summary().activity).not.toContain('withdrawing');
  }
});
