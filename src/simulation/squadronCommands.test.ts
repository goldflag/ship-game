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

test('landed matching survivors combine without reviving losses or skipping service', () => {
  const { sim, run, groups } = fixture();
  const [first, second] = squadronFlights(sim.player);
  const state = sim.player.airWing!;
  const survivors = state.planes.filter(p => first.planeIds.slice(0, 2).includes(p.id) || second.planeIds.slice(0, 3).includes(p.id));
  for (const p of state.planes.filter(p => first.planeIds.includes(p.id) || second.planeIds.includes(p.id))) {
    p.flightId = first.planeIds.includes(p.id) ? first.id : second.id;
    p.phase = survivors.includes(p) ? 'rearming' : 'lost';
    p.hp = survivors.includes(p) ? 20 : 0; p.timer = 10; p.ammo = 0;
  }
  const originalIds = state.planes.map(p => p.id);
  run(1 / 60);
  expect(groups().some(f => f.id === second.id)).toBe(false);
  expect(groups().find(f => f.id === first.id)!.surviving).toBe(5);
  expect(sim.commandSquadron(first.id, { kind: 'defend' })).toBe(false);
  expect(survivors.every(p => p.flightId === first.id && p.hp === 20 && p.timer > 9)).toBe(true);
  run(11);
  expect(survivors.every(p => p.hp === 60)).toBe(true);
  expect(sim.commandSquadron(first.id, { kind: 'defend' })).toBe(true);
  expect(survivors.every(p => p.phase === 'queued')).toBe(true);
  expect(state.planes.map(p => p.id)).toEqual(originalIds);
  expect(state.planes.filter(p => p.phase === 'lost')).toHaveLength(7);
  expect(new Set(state.flights.flatMap(f => f.planeIds)).size).toBe(state.flights.flatMap(f => f.planeIds).length);
});

for (const blocker of ['airborne', 'deck', 'capacity', 'model', 'role'] as const) test(`squadron consolidation respects ${blocker}`, () => {
  const { sim, run, groups } = fixture();
  const [first, second] = squadronFlights(sim.player);
  const keep = blocker === 'capacity' ? 4 : 2;
  const all = sim.player.airWing!.planes;
  for (const f of [first, second]) for (const [index, id] of f.planeIds.entries()) {
    const p = all.find(p => p.id === id)!;
    p.flightId = f.id; p.phase = index < keep ? 'rearming' : 'lost'; p.timer = 100;
  }
  const p = all.find(p => p.id === second.planeIds[0])!;
  if (blocker === 'airborne') { p.phase = 'returning'; p.position = [0, 500, 5000]; }
  if (blocker === 'deck') p.deckSlot = 0;
  if (blocker === 'model') p.modelId = 'a6m2-zero';
  if (blocker === 'role') p.role = 'dive-bomber';
  run(1 / 60);
  expect(groups().find(f => f.id === first.id)!.surviving).toBe(keep);
  expect(groups().find(f => f.id === second.id)!.surviving).toBe(keep);
});

test('damage adds service time on landing and repairs only up to 60 HP', () => {
  const { sim, run } = fixture();
  const planes = sim.player.airWing!.planes.slice(0, 4);
  for (const [i, p] of planes.entries()) {
    p.phase = 'rollout'; p.timer = 1.2; p.deckPosition = [0, 20, 0]; p.deckSlot = i;
    p.hp = [100, 80, 40, 10][i]; p.ammo = 0;
  }
  run(1 / 60);
  const base = sim.player.definition.airWing!.rearmSeconds;
  expect(planes.map(p => p.timer)).toEqual([base, base * 1.2, base * 1.6, base * 1.9]);
  run(base + .1);
  expect(planes[0].phase).toBe('ready');
  expect(planes[1].phase).toBe('rearming');
  run(base);
  expect(planes.map(p => p.hp)).toEqual([100, 80, 60, 60]);
  expect(planes.every(p => p.phase === 'ready' && p.ammo > 0)).toBe(true);
});
