import { expect, test } from 'bun:test';
import { fleetAirCourse } from './fleetAirCourse';
import { airWingTelemetry } from '../simulation/airTelemetry';
import { CombatSimulation } from '../simulation/combat';
import { squadronFlights } from '../simulation/aircraft';
import { shipPreset } from '../ships/presets';
import type { ContactTrack } from '../multiplayer/generated/ContactTrack';

test('strike lines end at the assigned report rather than a pilot approach waypoint', () => {
  const sim = new CombatSimulation(shipPreset('enterprise-cv6'));
  const group = squadronFlights(sim.player).find(f => f.squadronId === 'vt-6')!;
  group.order = { kind: 'strike', contactId: 'enterprise-contact' };
  sim.player.airWing!.flights.push(group);
  const plane = sim.player.airWing!.planes.find(p => group.planeIds.includes(p.id))!;
  Object.assign(plane, { phase: 'outbound', flightId: group.id, position: [100, 850, 200], navigationTarget: [6000, 850, -10000] });
  const report = { id: 'enterprise-contact', status: 'tracked', lastObservedTick: 0, estimatedPosition: [1000, 0, -2000], measuredPosition: [900, 0, -1900], velocity: [0, 0, 0] } as ContactTrack;
  const flight = airWingTelemetry(sim.player, sim.actors)!.groups.find(f => f.id === group.id)!;
  expect(fleetAirCourse(flight, flight.position, [report], 0).path).toEqual([flight.position, report.estimatedPosition]);
  expect(fleetAirCourse(flight, flight.position, [{ ...report, status: 'stale' }], 100).station).toEqual(report.measuredPosition);
  const returning = { ...flight, status: 'returning' as const, destination: [0, 0, 0] as [number, number, number] };
  expect(fleetAirCourse(returning, returning.position, [report], 0).contactId).toBeUndefined();
});
