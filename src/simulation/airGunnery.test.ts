import { expect, test } from 'bun:test';
import { AIR_GUNNERY, gunnerySeed, initialFireDiscipline, stepFireDiscipline } from './airGunnery';
import { dispersedDirection } from './ballistics';
import { length, scale, sub } from './geometry';
import { shipPreset } from '../ships/presets';
import { CombatSimulation } from './combat';
import { updateAntiAircraft } from './antiAircraft';
import type { AirContext } from './aircraft';

test('calm fighter fire usually misses; close range remains more effective', () => {
  const rate = (range: number) => {
    let hits = 0;
    for (let shot = 0; shot < 20000; shot++) {
      const direction = dispersedDirection([0, 0, -1], AIR_GUNNERY.fighterSpread(0), 73, shot);
      if (length(sub(scale(direction, range), [0, 0, -range])) <= 7) hits++;
    }
    return hits / 20000;
  };
  expect(rate(400)).toBeGreaterThan(.02); expect(rate(400)).toBeLessThan(.05);
  expect(rate(200)).toBeGreaterThan(rate(400) * 3);
});

test('panic persists across ticks, recovers, rises under pressure and replays from serialized state', () => {
  const run = (pressure: number, id = 'crew-1') => {
    const state = initialFireDiscipline(), seed = gunnerySeed(id, 93);
    let panicTicks = 0, recoveries = 0;
    for (let tick = 0; tick < 36000; tick++) {
      const before = structuredClone(state);
      stepFireDiscipline(state, 1 / 60, pressure, seed);
      if (state.panic) panicTicks++;
      if (before.panic && !state.panic) recoveries++;
      if (before.remaining > 1 / 60) expect(state.panic).toBe(before.panic);
      if (tick === 100) {
        stepFireDiscipline(before, 1 / 60, pressure, seed);
        expect(state).toEqual(before);
      }
    }
    stepFireDiscipline(state, 1 / 60, pressure, seed, false);
    expect(state.panic).toBe(false);
    return { panicTicks, recoveries, state };
  };
  const calm = run(0), stressed = run(1);
  expect(calm.panicTicks).toBeGreaterThan(0); expect(calm.recoveries).toBeGreaterThan(0);
  expect(stressed.panicTicks).toBeGreaterThan(calm.panicTicks * 2);
  expect(run(1)).toEqual(stressed); expect(run(1, 'crew-2')).not.toEqual(stressed);
});

for (const caliber of [.02, .037, .105]) test(`${caliber * 1000} mm: rare strong AA hits and visible off-target panic fire`, () => {
  const run = (panic: boolean, inbound = false) => {
    const sim = new CombatSimulation(shipPreset('bismarck'), { friendlyBots: [], enemies: [shipPreset('enterprise-cv6')], seed: 93 });
    const plane = sim.target.airWing!.planes[0];
    Object.assign(plane, { hp: 100, phase: 'outbound', position: [1000, 250, 0], velocity: inbound ? [-100, 0, 0] : [0, 0, 0] });
    const index = sim.player.definition.mounts.findIndex(m => m.weapon.caliberM === caliber && m.position[0] > 0);
    const mount = sim.player.definition.mounts[index], state = sim.player.mounts[index];
    state.aaDiscipline = { remaining: 10000, sequence: 0, panic, yaw: .45, pitch: .2 };
    state.ammo = 100000; state.heAmmo = 0;
    let shots = 0, hits = 0, id = 0, damage = 0, offTarget = 0;
    const ctx: AirContext = { seed: 93, actors: sim.actors, planes: sim.aircraft, shells: [], torpedoes: [], releases: [], nextId: () => ++id,
      emit: event => {
        shots++;
        const miss = length(sub(event.aircraft!.target!, plane.position));
        if (miss < (caliber > .08 ? 14 : 6)) hits++;
        if (miss > 200) offTarget++;
        expect(event.aircraft!.panic).toBe(panic);
      } };
    for (let tick = 0; tick < 6000; tick++) {
      state.reload = 0; plane.hp = 100;
      updateAntiAircraft(sim.player, mount, state, ctx, .1);
      damage += 100 - plane.hp;
    }
    expect(shots).toBeGreaterThan(5000);
    expect(100000 - state.ammo).toBe(shots);
    return { shots, hits, damage, offTarget };
  };
  const calm = run(false), panic = run(true);
  expect(calm.hits).toBeGreaterThan(0);
  expect(calm.hits / calm.shots).toBeLessThan(caliber > .08 ? .05 : .015);
  expect(calm.damage / calm.hits).toBe(caliber > .08 ? 100 : caliber > .025 ? 40 : 20);
  expect(panic.hits).toBeLessThan(calm.hits / 10);
  expect(panic.offTarget / panic.shots).toBeGreaterThan(.9);
  const inbound = run(false, true);
  expect(inbound.damage).toBeGreaterThan(0);
  expect(inbound.damage / AIR_GUNNERY.aaDamage(caliber) / inbound.shots).toBeLessThan(.08);
});
