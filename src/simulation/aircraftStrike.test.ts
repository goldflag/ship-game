import { expect, test } from 'bun:test';
import { shipPreset } from '../ships/presets';
import { CombatSimulation } from './combat';
import { stepAircraft, squadronFlights, type AirContext } from './aircraft';

for (const distance of [1000, 5000]) for (const speed of [0, 8.5]) for (const squadron of ['vb-6', 'vt-6']) {
  test(`${squadron} completes a strike from ${distance} m against a ship crossing at ${speed} m/s`, () => {
    const sim = new CombatSimulation(shipPreset('enterprise-cv6'), {
      friendlyBots: [], enemies: [{ definition: shipPreset('bismarck'), aiLevel: 'static' }], spawnDistance: distance, seed: 11,
    });
    sim.target.motion.heading = Math.PI / 2;
    sim.target.motion.speed = speed;
    let id = 0, released = 0;
    const ctx: AirContext = { seed: sim.seed, actors: sim.actors, planes: sim.aircraft, shells: [], torpedoes: [], releases: [],
      nextId: () => ++id, emit: e => { if (e.kind === 'bomb-release' || e.kind === 'aircraft-release') released++; } };
    const group = squadronFlights(sim.player).find(f => f.squadronId === squadron)!;
    expect(sim.commandSquadron(group.id, { kind: 'attack', targetId: sim.target.motion.id })).toBe(true);
    for (let tick = 0; tick < 300 * 60 && released < 6; tick++) {
      sim.target.motion.x += speed / 60;
      stepAircraft(ctx, 1 / 60, tick / 60);
    }
    expect(released).toBe(6);
  });
}
