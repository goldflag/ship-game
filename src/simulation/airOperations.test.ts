import { expect, test } from 'bun:test';
import { shipPreset } from '../ships/presets';
import { CombatSimulation } from './combat';
import { airborne, onFlightDeck, stepAircraft, type AirContext } from './aircraft';

function fixture() {
  const def = shipPreset('enterprise-cv6');
  const sim = new CombatSimulation(def, { enemies: [def, def], friendlyBots: [], spawnDistance: 5000, seed: 42 });
  sim.actors.slice(1).forEach(a => { a.controller = 'idle'; a.mounts.forEach(m => { m.hp = 0; }); });
  let id = 0, tick = 0;
  const events: { time: number; kind: string; id?: string }[] = [];
  const context: AirContext = { actors: sim.actors, planes: sim.aircraft, shells: [], torpedoes: [], releases: [], nextId: () => ++id, emit: event => events.push({ time: tick / 60, kind: event.kind, id: event.aircraft?.id }) };
  const run = (seconds: number) => { for (let i = 0; i < seconds * 60; i++, tick++) stepAircraft(context, 1 / 60, tick / 60); };
  const wing = () => sim.telemetry('main', [0, 0, -5000]).airWing!;
  return { sim, run, wing, events };
}

test('48 aircraft have a bounded ready deck, hangar reserve and conserved whole-wing counts', () => {
  const { sim, run, wing } = fixture(); run(1 / 60);
  expect(sim.player.airWing!.planes).toHaveLength(48);
  expect(sim.player.airWing!.planes.filter(onFlightDeck)).toHaveLength(12);
  expect(new Set(sim.player.airWing!.planes.filter(onFlightDeck).map(p => p.deckSlot)).size).toBe(12);
  expect(wing().inHangar).toBe(36); expect(wing().counts.ready).toBe(48);
  expect(wing().flights.filter(p => p.followable)).toHaveLength(12);
  expect(wing().squadrons.map(s => s.total)).toEqual([18, 18, 12]);
});

test('six-plane flights retain separate orders and four active slots include queued flights', () => {
  const { sim, wing } = fixture();
  for (const squadron of ['vf-6', 'vb-6', 'vt-6', 'vf-6']) expect(sim.launchAircraft(squadron)).toBe(6);
  expect(sim.launchAircraft('vb-6')).toBe(0);
  expect(wing().activeFlights).toBe(4);
  expect(wing().counts.launching).toBe(24);
  const flights = sim.player.airWing!.flights;
  const strike = flights[1], otherTarget = sim.actors[2];
  sim.selectTarget(otherTarget.motion.id);
  expect(wing().groups.find(f => f.id === strike.id)!.order).toEqual({ kind: 'attack', targetId: sim.actors[1].motion.id });
  expect(sim.orderFlight(strike.id, { kind: 'attack', targetId: otherTarget.motion.id })).toBe(true);
  expect(sim.player.airWing!.planes.filter(p => p.flightId === strike.id).every(p => p.targetId === otherTarget.motion.id)).toBe(true);
  expect(sim.orderFlight(flights[0].id, { kind: 'escort', flightId: strike.id })).toBe(true);
  expect(sim.orderFlight(flights[0].id, { kind: 'escort', flightId: flights[0].id })).toBe(false);
  expect(sim.orderFlight(strike.id, { kind: 'patrol', point: [0, 420, 0] })).toBe(false);
  expect(sim.orderFlight(flights[0].id, { kind: 'patrol', point: [NaN, 420, 0] })).toBe(false);
  expect(sim.orderFlight('enemy/flight-1', { kind: 'return' })).toBe(false);
  sim.recallAircraft(strike.id);
  expect(wing().groups.find(f => f.id === strike.id)!.active).toBe(false);
  expect(wing().counts.launching).toBe(18);
  expect(wing().counts.ready).toBe(30);
  expect(sim.launchAircraft('vb-6')).toBe(6);
});

test('a full 24-plane rotation recovers, rearms and launches again without endurance losses', () => {
  const { sim, run, wing, events } = fixture();
  for (const squadron of ['vf-6', 'vb-6', 'vt-6', 'vf-6']) sim.launchAircraft(squadron);
  for (let second = 0; second < 750; second++) {
    run(1);
    if (second === 180) sim.recallAircraft();
    const telemetry = wing();
    expect(Object.values(telemetry.counts).reduce((a, b) => a + b, 0)).toBe(48);
    expect(sim.player.airWing!.planes.filter(onFlightDeck).length).toBeLessThanOrEqual(12);
  }
  const lost = sim.player.airWing!.planes.filter(p => p.phase === 'lost').map(p => ({ id: p.id, reason: p.lossReason }));
  expect(lost).toEqual([]);
  expect(wing().counts.ready).toBe(48);
  expect(events.filter(e => e.kind === 'aircraft-recovered')).toHaveLength(24);
  expect(sim.launchAircraft('vt-6')).toBe(6);
  run(60);
  expect(sim.player.airWing!.planes.filter(airborne)).toHaveLength(6);
}, 30000);
