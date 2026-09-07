import { expect, test } from 'bun:test';
import { formationSpawns, resolveBattleFleet, validateBattleSetup, validateSpawns, type BattleSetup } from './battle';
import { OCEAN_MAPS, mapIslands } from '../maps/catalog';
import { shipPreset } from '../ships/presets';
import { CombatSimulation } from './combat';

test('every formation fits all maps at minimum and maximum distance with up to thirty ships', () => {
  for (const map of OCEAN_MAPS) for (const distance of [1000, 5000, 20000]) for (const count of [1, 5, 30]) for (const formation of ['line', 'column', 'wedge'] as const) {
    const positions = formationSpawns(count, count, distance, formation);
    expect(() => validateSpawns(positions, count, count, mapIslands(map.id, distance, count))).not.toThrow();
    expect(positions.friendly.every(p => p.z >= 0)).toBe(true);
    expect(positions.enemy.every(p => p.z <= -distance)).toBe(true);
  }
});

test('custom positions and headings reach every actor and survive reset without sharing mutable setup state', () => {
  const setup: BattleSetup = { playerShipId: 'bismarck', friendlyBots: ['bismarck'], enemies: ['bismarck'], spawnDistance: 5000,
    spawns: { friendly: [{ x: 1000, z: 500, heading: Math.PI / 2 }, { x: -650, z: 1000, heading: 0 }], enemy: [{ x: 1500, z: -3000, heading: Math.PI }] } };
  validateBattleSetup(setup, ['bismarck']);
  const sim = new CombatSimulation(shipPreset('bismarck'), resolveBattleFleet(setup, shipPreset));
  expect(sim.actors.map(a => [a.motion.x, a.motion.z, a.motion.heading])).toEqual([[1000, 500, Math.PI / 2], [-650, 1000, 0], [1500, -3000, Math.PI]]);
  setup.spawns!.friendly[0].x = 9000;
  sim.ship.x = 8000; sim.reset();
  expect(sim.ship.x).toBe(1000);
  expect(sim.ship.heading).toBe(Math.PI / 2);
});

test('placement rejects overlapping ships, malformed positions, out of bounds and land', () => {
  const positions = formationSpawns(1, 1, 5000);
  const check = () => validateSpawns(positions, 1, 1, []);
  positions.enemy[0].z = 0;
  expect(check).toThrow('350 m');
  positions.enemy[0].z = NaN;
  expect(check).toThrow('positions');
  positions.enemy[0].z = -41000;
  expect(check).toThrow('40 km');
  positions.enemy = [];
  expect(check).toThrow('every ship');
  const islands = mapIslands('pacific-islands', 5000, 1);
  positions.enemy = [{ x: islands[0].x, z: islands[0].z, heading: 0 }];
  expect(() => validateSpawns(positions, 1, 1, islands)).toThrow('land');
  expect(() => new CombatSimulation(shipPreset('bismarck'), { friendlyBots: [], enemies: [shipPreset('bismarck')], spawns: positions, mapId: 'pacific-islands' })).toThrow('land');
});
