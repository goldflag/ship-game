import { expect, test } from 'bun:test';
import { shipPreset } from '../ships/presets';
import { CombatSimulation } from './combat';
import { onFlightDeck, squadronFlights, stepAircraft, type AirContext } from './aircraft';

function fixture() {
  const def = shipPreset('enterprise-cv6');
  const sim = new CombatSimulation(def, { enemies: [def], friendlyBots: [def], spawnDistance: 5000 });
  sim.actors.forEach(a => { if (a !== sim.player) a.controller = 'idle'; a.mounts.forEach(m => { m.hp = 0; }); });
  let tick = 0;
  const ctx: AirContext = { actors: sim.actors, planes: sim.aircraft, shells: [], torpedoes: [], releases: [], nextId: () => 1, emit() {} };
  const run = (seconds: number) => { for (let n = 0; n < seconds * 60; n++, tick++) stepAircraft(ctx, 1 / 60, tick / 60); };
  const groups = () => sim.telemetry('main', [0, 0, -5000]).airWing!.groups;
  return { sim, ctx, run, groups };
}

test('a ready six-plane bomber squadron launches to water within ten seconds and retains its static station', () => {
  const { sim, run, groups } = fixture();
  const squadron = groups().find(f => f.role === 'dive-bomber')!;
  const ids = squadron.aircraftIds;
  expect(sim.player.airWing!.planes.some(onFlightDeck)).toBe(false);
  expect(sim.commandSquadron(squadron.id, { kind: 'patrol', point: [1800, 420, -2000] })).toBe(true);
  expect(sim.player.airWing!.planes.some(onFlightDeck)).toBe(false);
  run(10.2);
  const planes = sim.player.airWing!.planes.filter(p => ids.includes(p.id));
  expect(planes.every(p => p.phase === 'outbound' && !onFlightDeck(p))).toBe(true);
  expect(sim.player.airWing!.planes.filter(p => !ids.includes(p.id)).every(p => p.phase === 'ready' && !onFlightDeck(p))).toBe(true);
  run(100);
  const first = groups().find(f => f.id === squadron.id)!;
  run(20);
  const second = groups().find(f => f.id === squadron.id)!;
  expect(first.destination).toEqual([1800, 0, -2000]); expect(second.destination).toEqual(first.destination);
  expect(second.position).not.toEqual(first.position); expect(second.activity).toBe('Loitering');
  expect(planes.every(p => p.payload)).toBe(true);
  expect(sim.commandSquadron(squadron.id, { kind: 'attack', targetId: sim.target.motion.id })).toBe(true);
  expect(planes.every(p => p.targetId === sim.target.motion.id)).toBe(true);
});

test('role and team validation is atomic for launches, interception, defense, and retasking', () => {
  const { sim, run, groups } = fixture();
  const fighter = groups()[0], bomber = groups().find(f => f.role === 'torpedo-bomber')!;
  const ally = sim.actors.find(a => a.controller === 'idle' && a.team === 'friendly')!;
  expect(sim.commandSquadron(fighter.id, { kind: 'attack', targetId: sim.target.motion.id })).toBe(false);
  expect(sim.commandSquadron(bomber.id, { kind: 'defend', targetId: ally.motion.id })).toBe(false);
  expect(sim.commandSquadron(fighter.id, { kind: 'patrol', point: [NaN, 420, 0] })).toBe(false);
  expect(sim.commandSquadron(fighter.id, { kind: 'patrol', point: [40000, 420, 0] })).toBe(false);
  expect(sim.player.airWing!.flights).toHaveLength(0);
  expect(sim.commandSquadron(fighter.id, { kind: 'defend', targetId: ally.motion.id })).toBe(true);
  expect(groups()[0].destination).toEqual([ally.motion.x, 0, ally.motion.z]);
  sim.target.controller = 'bot'; run(12); sim.target.controller = 'idle';
  const enemy = sim.target.airWing!.flights[0];
  expect(sim.commandSquadron(fighter.id, { kind: 'intercept', flightId: enemy.id })).toBe(true);
  expect(sim.commandSquadron(fighter.id, { kind: 'intercept', flightId: fighter.id })).toBe(false);
  expect(sim.commandSquadron(bomber.id, { kind: 'intercept', flightId: enemy.id })).toBe(false);
  expect(sim.commandSquadron(fighter.id, { kind: 'defend', targetId: sim.target.motion.id })).toBe(false);
  expect(groups()[0].order).toEqual({ kind: 'intercept', flightId: enemy.id });
  sim.target.airWing!.planes.filter(p => p.flightId === enemy.id).forEach(p => { p.phase = 'lost'; p.hp = 0; });
  run(1);
  expect(groups()[0].order.kind).toBe('patrol');
});

test('squadron identity, losses and hotkey order persist across recall and relaunch', () => {
  const { sim, run, groups } = fixture();
  const initial = groups().map(f => ({ id: f.id, aircraftIds: f.aircraftIds }));
  const fighter = groups()[0];
  expect(sim.commandSquadron(fighter.id, { kind: 'patrol', point: [0, 420, -1000] })).toBe(true);
  run(12);
  const lost = sim.player.airWing!.planes.find(p => p.id === fighter.aircraftIds[0])!;
  lost.phase = 'lost'; lost.hp = 0;
  sim.recallAircraft(fighter.id); run(650);
  const ready = groups()[0];
  expect(ready.status).toBe('ready'); expect(ready.surviving).toBe(5);
  expect(groups().map(f => ({ id: f.id, aircraftIds: f.aircraftIds }))).toEqual(initial);
  expect(sim.commandSquadron(fighter.id, { kind: 'patrol', point: [1000, 420, 0] })).toBe(true);
  run(10.2);
  expect(lost.phase).toBe('lost');
  expect(sim.player.airWing!.planes.filter(p => p.flightId === fighter.id && p.phase === 'outbound')).toHaveLength(5);
  expect(squadronFlights(sim.player).map(f => f.id)).toEqual(initial.map(f => f.id));
});
