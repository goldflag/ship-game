import { expect, test } from 'bun:test';
import source from '../../assets/ships/shokaku/blueprint.json';
import catalog from '../../assets/parts/guns.json';
import { compileShip } from '../ships/blueprint';
import { CombatSimulation, type CombatEvent } from './combat';
import { commandSquadron, hasFoldingWings, squadronFlights, stepAircraft, type AirContext } from './aircraft';
import { aircraftTorpedo } from './aircraftWeapons';
import { torpedoSpeed } from './mobility';

const definition = compileShip(source, catalog);
function fixture() {
  const sim = new CombatSimulation(definition, { friendlyBots: [], enemies: [definition], spawnDistance: 5000 });
  sim.target.controller = 'idle';
  let time = 0, next = 1000;
  const events: Omit<CombatEvent, 'sequence' | 'tick'>[] = [];
  const context: AirContext = { actors: sim.actors, planes: sim.aircraft, shells: sim.shells, torpedoes: sim.torpedoes, releases: sim.airReleases,
    nextId: () => ++next, emit: event => events.push(event) };
  const run = (seconds: number, done?: () => boolean) => { for (let i = 0; i < seconds * 60 && !done?.(); i++) { stepAircraft(context, 1 / 60, time); time += 1 / 60; } };
  return { sim, events, run };
}

test('Shokaku fits the 1941 guns and air group through the common blueprint', () => {
  expect(definition.mounts.filter(m => m.weapon.caliberM === .127)).toHaveLength(8);
  expect(definition.mounts.filter(m => m.weapon.caliberM === .025)).toHaveLength(12);
  expect(definition.mounts.filter(m => m.partId === 'type89-127-a1-mod2-twin')).toHaveLength(2);
  const { sim } = fixture();
  expect(sim.player.airWing!.planes).toHaveLength(72);
  const flights = squadronFlights(sim.player);
  expect(flights.map(f => f.planeIds.length)).toEqual([6, 6, 6, 6, 6, 6, 6, 3, 6, 6, 6, 6, 3]);
  expect(hasFoldingWings('a6m2-zero')).toBe(false);
  expect(hasFoldingWings('b5n2-kate')).toBe(false);
  expect(hasFoldingWings('d3a1-val')).toBe(false);
});

test('Japanese aircraft launch, recover, service and preserve squadron inventory', () => {
  const { sim, run, events } = fixture();
  const before = squadronFlights(sim.player).map(f => f.planeIds);
  for (const pool of definition.airWing!.squadrons) {
    const flight = squadronFlights(sim.player).find(f => f.squadronId === pool.id)!;
    expect(commandSquadron(sim.player, flight.id, { kind: 'patrol', point: [1000, 0, -1800] }, sim.actors)).toBe(true);
  }
  run(40);
  expect(sim.player.airWing!.planes.filter(p => p.phase === 'outbound')).toHaveLength(18);
  expect(sim.player.airWing!.planes.filter(p => p.phase === 'outbound').every(p => p.wingFold === 0)).toBe(true);
  sim.recallAircraft(); run(750, () => sim.player.airWing!.planes.every(p => p.phase === 'ready'));
  expect(sim.player.airWing!.planes.every(p => p.phase === 'ready')).toBe(true);
  expect(events.filter(e => e.kind === 'aircraft-recovered')).toHaveLength(18);
  expect(squadronFlights(sim.player).map(f => f.planeIds)).toEqual(before);
  expect(sim.launchAircraft('shokaku-fighters')).toBe(6);
  sim.reset();
  expect(sim.player.airWing!.planes).toHaveLength(72);
  expect(sim.player.airWing!.planes.every(p => p.phase === 'ready')).toBe(true);
});

test('Japanese attacks retain their bomb and torpedo variants after release', () => {
  const { sim, run, events } = fixture();
  expect(sim.launchAircraft('shokaku-dive')).toBe(6);
  expect(sim.launchAircraft('shokaku-torpedo')).toBe(6);
  run(580, () => sim.shells.length === 6 && sim.torpedoes.length === 6);
  expect(events.some(e => e.kind === 'bomb-release')).toBe(true);
  expect(sim.shells.some(s => s.weaponLabel === 'Type 99 No. 25 250 kg bomb' && s.he?.explosiveKg === 60)).toBe(true);
  expect(events.some(e => e.kind === 'torpedo-launch')).toBe(true);
  expect(sim.torpedoes.length).toBeGreaterThan(0);
  expect(sim.torpedoes.every(t => t.weapon.id === 'type91-mod2-game' && t.ownerId === 'player')).toBe(true);
  for (const torpedo of sim.torpedoes) expect(Math.hypot(...torpedo.velocity)).toBeCloseTo(torpedoSpeed(aircraftTorpedo('b5n2-kate').speed), 8);
});
