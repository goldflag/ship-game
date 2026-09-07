import { expect, test } from 'bun:test';
import { antiAircraftCandidates, antiAircraftRange, updateAntiAircraft } from './antiAircraft';
import { airborne, onFlightDeck, type AirContext } from './aircraft';
import { CombatSimulation, type CombatEvent } from './combat';
import { shipPreset, shipPresets } from '../ships/presets';
import { muzzleWorld } from './weapons';

test('AA broad phase retains maximum-range targets at every mounted muzzle and hull attitude', () => {
  for (const id of Object.keys(shipPresets)) {
    const definition = shipPreset(id);
    const sim = new CombatSimulation(definition, { friendlyBots: [], enemies: [shipPreset('enterprise-cv6')] });
    const plane = sim.target.airWing!.planes[0]; plane.phase = 'outbound';
    // A wave trough moves the whole intact hull without submerging its guns.
    Object.assign(sim.player.motion, { x: 12000, z: -23000, y: -2, waveHeave: -2, heading: 1.7, roll: .4, pitch: -.2 });
    for (const [i, mount] of definition.mounts.entries()) {
      const range = antiAircraftRange(mount); if (!range) continue;
      Object.assign(sim.player.mounts[i], { train: 1.3, elevation: .8 });
      const origin = muzzleWorld(mount, sim.player.mounts[i], 0, sim.player.motion);
      for (const axis of [0, 1, 2]) for (const sign of [-1, 1]) {
        plane.position = [...origin]; plane.position[axis] += sign * (range - 1e-7);
        expect(antiAircraftCandidates(sim.player, [plane])).toEqual([plane]);
      }
    }
  }
});

test('indexed AA matches the full scan, including ties and kills by earlier guns', () => {
  const run = (indexed: boolean, killFirst: boolean) => {
    const sim = new CombatSimulation(shipPreset('bismarck'), { friendlyBots: [], enemies: [shipPreset('enterprise-cv6')] });
    const planes = sim.target.airWing!.planes;
    for (const [i, plane] of planes.entries()) Object.assign(plane, { phase: i < 3 ? 'outbound' : 'ready', position: [700, 250, 0], velocity: [0, 0, 0] });
    const candidates = antiAircraftCandidates(sim.player, sim.aircraft.filter(p => airborne(p) && !onFlightDeck(p)));
    if (killFirst) planes[0].hp = 0;
    const events: Omit<CombatEvent, 'tick' | 'sequence'>[] = [];
    let sequence = 0;
    const ctx: AirContext = { seed: 93, actors: sim.actors, planes: sim.aircraft, shells: [], torpedoes: [], releases: [], nextId: () => ++sequence, emit: event => events.push(event) };
    for (let tick = 0; tick < 600; tick++) sim.player.definition.mounts.forEach((mount, i) =>
      updateAntiAircraft(sim.player, mount, sim.player.mounts[i], ctx, 1 / 60, indexed ? candidates : undefined));
    return { mounts: sim.player.mounts, hp: planes.map(p => p.hp), events };
  };
  for (const killFirst of [false, true]) {
    const expected = run(false, killFirst);
    expect(expected.events.length).toBeGreaterThan(0);
    expect(run(true, killFirst)).toEqual(expected);
  }
});
