import { expect, test } from 'bun:test';
import blueprint from '../../assets/ships/baltimore/blueprint.json';
import catalog from '../../assets/parts/guns.json';
import { compileShip } from '../ships/blueprint';
import { CombatSimulation } from './combat';

const definition = compileShip(blueprint, catalog);
const helm = { throttle: 0, rudder: 0 };
const aim: [number, number, number] = [1800, 0, 0];

test('Baltimore trains three triple turrets, fires nine distinct shells, and holds during reload', () => {
  const sim = new CombatSimulation(definition);
  const mounts = sim.player.mounts.filter(m => m.id.startsWith('main-'));
  for (let i = 0; i < 3600 && mounts.some(m => m.status !== 'ready'); i++) {
    sim.step(helm, { aim, fire: false, battery: 'main' });
  }
  expect(mounts.map(m => m.status)).toEqual(['ready', 'ready', 'ready']);
  sim.step(helm, { aim, fire: true, battery: 'main' });
  const shots = sim.events.filter(e => e.kind === 'shot');
  expect(shots).toHaveLength(9);
  expect(new Set(shots.map(e => JSON.stringify(e.position))).size).toBe(9);
  expect(mounts.map(m => m.ammo)).toEqual([447, 447, 447]);
  for (let i = 0; i < 300; i++) sim.step(helm, { aim, fire: true, battery: 'main' });
  expect(mounts.map(m => m.ammo)).toEqual([447, 447, 447]);
});

test('Baltimore secondary broadside uses the four clear twin mounts and preserves main ammunition', () => {
  const sim = new CombatSimulation(definition);
  for (let i = 0; i < 3600; i++) sim.step(helm, { aim, fire: false, battery: 'secondary' });
  const secondary = sim.player.mounts.filter(m => m.id.startsWith('secondary-'));
  expect(secondary).toHaveLength(6);
  expect(secondary.filter(m => m.status === 'ready')).toHaveLength(4);
  const before = new Map(sim.player.mounts.map(m => [m.id, m.ammo]));
  sim.step(helm, { aim, fire: true, battery: 'secondary' });
  const shots = sim.events.filter(e => e.kind === 'shot');
  expect(shots).toHaveLength(8);
  expect(new Set(shots.map(e => JSON.stringify(e.position))).size).toBe(8);
  expect(secondary.filter(m => m.ammo === before.get(m.id)! - 2)).toHaveLength(4);
  expect(sim.player.mounts.filter(m => m.id.startsWith('main-')).map(m => m.ammo)).toEqual([450, 450, 450]);
});
