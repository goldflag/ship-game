import { expect, test } from 'bun:test';
import blueprint from '../../assets/ships/admiral-hipper/blueprint.json';
import catalog from '../../assets/parts/guns.json';
import { compileShip, type Vec3 } from '../ships/blueprint';
import { CombatSimulation } from './combat';
import { mountPoseClear, moveMountWithClearance } from './mountClearance';
import { createMountState } from './weapons';

const definition = compileShip(blueprint, catalog);
const helm = { throttle: 0, rudder: 0 };
// These exercise 25–30 simulated seconds of the TypeScript migration reference
// with every fitted gun active. Allow for the parallel fleet test runner.
const scenarioTimeoutMs = 120_000;

test.each([-1, 1])('Hipper trains and fires all four main turrets on broadside %s', side => {
  const sim = new CombatSimulation(definition);
  const aim: Vec3 = [1800 * side, 0, 0];
  for (let tick = 0; tick < 1800; tick++) sim.step(helm, { aim, fire: false, battery: 'main' });
  const main = sim.player.mounts.filter(m => m.id.startsWith('main-'));
  expect(main.every(m => m.status === 'ready')).toBe(true);
  const before = main.map(m => m.ammo);
  sim.step(helm, { aim, fire: true, battery: 'main' });
  const shots = sim.events.filter(e => e.kind === 'shot' && e.shell?.caliberM === .203);
  expect(shots).toHaveLength(8);
  expect(new Set(shots.map(e => JSON.stringify(e.position))).size).toBe(8);
  expect(main.map(m => m.ammo)).toEqual(before.map(n => n - 2));
}, scenarioTimeoutMs);

test.each([-1, 1])('Hipper launches the two outboard triple banks on side %s and resets', side => {
  const sim = new CombatSimulation(definition);
  const aim: Vec3 = [1800 * side, 0, 0];
  const guns = sim.player.mounts.map(m => m.ammo);
  for (let tick = 0; tick < 1500; tick++) sim.step(helm, { aim, fire: tick >= 900, battery: 'torpedo' });
  expect(sim.events.filter(e => e.kind === 'torpedo-launch')).toHaveLength(6);
  expect(sim.torpedoes.every(t => t.velocity[0] * side > 0)).toBe(true);
  expect(sim.player.torpedoTubes!.reduce((n, tube) => n + tube.ammo, 0)).toBe(6);
  expect(sim.player.mounts.map(m => m.ammo)).toEqual(guns);
  sim.reset();
  expect(sim.torpedoes).toHaveLength(0);
  expect(sim.player.torpedoTubes!.reduce((n, tube) => n + tube.ammo, 0)).toBe(12);
}, scenarioTimeoutMs);

test('Hipper tower AA starts seated, elevates, and stops its projecting guard above the gallery', () => {
  const states = definition.mounts.map(createMountState);
  for (const id of ['port-20-twin-1', 'starboard-20-twin-1']) {
    const index = definition.mounts.findIndex(m => m.id === id);
    const state = states[index];
    expect(mountPoseClear(definition, index, state, states)).toBe(true);
    expect(moveMountWithClearance(definition, index, state, { train: 0, elevation: 80 * Math.PI / 180 }, states)).toBe(true);
    expect(moveMountWithClearance(definition, index, state, { train: 0, elevation: Math.PI / 180 }, states)).toBe(false);
    expect(mountPoseClear(definition, index, state, states)).toBe(true);
    expect(moveMountWithClearance(definition, index, state, { train: 0, elevation: 30 * Math.PI / 180 }, states)).toBe(true);
  }
});
