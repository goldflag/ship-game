import { expect, test } from 'bun:test';
import blueprint from '../../assets/ships/mogami/blueprint.json';
import catalog from '../../assets/parts/guns.json';
import { compileShip } from '../ships/blueprint';
import { CombatSimulation } from './combat';

const definition = compileShip(blueprint, catalog);
const helm = { throttle: 0, rudder: 0 };
const aim: [number, number, number] = [1800, 0, 0];

test('Mogami trains all five twin main turrets for a ten-shell broadside', () => {
  const sim = new CombatSimulation(definition);
  for (let i = 0; i < 1800; i++) sim.step(helm, { aim, fire: false, battery: 'main' });
  const mounts = sim.player.mounts.filter(m => m.id.startsWith('main-'));
  expect(mounts.map(m => m.status)).toEqual(Array(5).fill('ready'));
  const before = mounts.map(m => m.ammo);
  sim.step(helm, { aim, fire: true, battery: 'main' });
  const shots = sim.events.filter(e => e.kind === 'shot' && e.shell?.caliberM === .203);
  expect(shots).toHaveLength(10);
  expect(new Set(shots.map(e => JSON.stringify(e.position))).size).toBe(10);
  expect(mounts.map(m => m.ammo)).toEqual(before.map(n => n - 2));
  sim.step(helm, { aim, fire: true, battery: 'main' });
  expect(mounts.map(m => m.ammo)).toEqual(before.map(n => n - 2));
});

test('Mogami can fire its two starboard 127 mm mounts without spending main ammunition', () => {
  const sim = new CombatSimulation(definition);
  for (let i = 0; i < 1800; i++) sim.step(helm, { aim, fire: false, battery: 'secondary', ammunition: 'he' });
  const before = sim.player.mounts.filter(m => m.id.startsWith('main-')).map(m => m.ammo);
  sim.step(helm, { aim, fire: true, battery: 'secondary' });
  expect(sim.events.filter(e => e.kind === 'shot' && e.shell?.caliberM === .127)).toHaveLength(4);
  expect(sim.player.mounts.filter(m => m.id.startsWith('main-')).map(m => m.ammo)).toEqual(before);
});

test('Mogami launches eight starboard torpedoes and restores the full outfit on reset', () => {
  const sim = new CombatSimulation(definition);
  const guns = sim.player.mounts.map(m => m.ammo);
  for (let i = 0; i < 1800; i++) sim.step(helm, { aim, fire: false, battery: 'torpedo' });
  for (let i = 0; i < 420; i++) sim.step(helm, { aim, fire: true, battery: 'torpedo' });
  expect(sim.torpedoes).toHaveLength(8);
  expect(sim.player.torpedoTubes!.reduce((n, t) => n + t.ammo, 0)).toBe(8);
  expect(sim.player.mounts.map(m => m.ammo)).toEqual(guns);
  sim.reset();
  expect(sim.torpedoes).toHaveLength(0);
  expect(sim.player.torpedoTubes!.reduce((n, t) => n + t.ammo, 0)).toBe(16);
});
