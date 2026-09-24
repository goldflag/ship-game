import { expect, test } from 'bun:test';
import { formationSpawns, resolveBattleFleet, validateBattleSetup, validateSpawns, type BattleSetup } from './battle';
import { OCEAN_MAPS, customTerrainOffset, placedMapTerrain } from '../maps/catalog';
import { OPEN_SEA, terrainLandWithin } from '../maps/heightfield';
import { installMapTerrain } from '../maps/testing';
import { shipPreset } from '../ships/presets';
import { CombatSimulation } from './combat';

test('every formation clears the real coasts at minimum and maximum distance with up to twelve ships a side', async () => {
  // Each chart keeps the lane between the default spawn lines clear of land; thirty abreast can reach a coast.
  for (const map of OCEAN_MAPS) {
    if (map.land.terrain) await installMapTerrain(map.id);
    for (const distance of [1000, 5000, 20000]) for (const count of [1, 5, 12]) for (const formation of ['line', 'column', 'wedge'] as const) {
      const positions = formationSpawns(count, count, distance, formation);
      expect(() => validateSpawns(positions, count, count, placedMapTerrain(map.id, customTerrainOffset(distance))!)).not.toThrow();
      expect(positions.friendly.every(p => p.z >= 0)).toBe(true);
      expect(positions.enemy.every(p => p.z <= -distance)).toBe(true);
    }
  }
});

test('custom positions and headings reach every actor and survive reset without sharing mutable setup state', () => {
  const setup: BattleSetup = { playerShipId: 'bismarck', friendlyBots: ['bismarck'], enemies: ['bismarck'], spawnDistance: 5000,
    spawns: { friendly: [{ x: 1000, z: 500, heading: Math.PI / 2 }, { x: -650, z: 1000, heading: 0 }], enemy: [{ x: 1500, z: -3000, heading: Math.PI }] } };
  validateBattleSetup(setup, ['bismarck'], OPEN_SEA);
  const sim = new CombatSimulation(shipPreset('bismarck'), resolveBattleFleet(setup, shipPreset));
  expect(sim.actors.map(a => [a.motion.x, a.motion.z, a.motion.heading])).toEqual([[1000, 500, Math.PI / 2], [-650, 1000, 0], [1500, -3000, Math.PI]]);
  setup.spawns!.friendly[0].x = 9000;
  sim.ship.x = 8000; sim.reset();
  expect(sim.ship.x).toBe(1000);
  expect(sim.ship.heading).toBe(Math.PI / 2);
});

test('placement rejects overlapping ships, malformed positions, out of bounds and land', async () => {
  const positions = formationSpawns(1, 1, 5000);
  const check = () => validateSpawns(positions, 1, 1, OPEN_SEA);
  positions.enemy[0].z = 0;
  expect(check).toThrow('350 m');
  positions.enemy[0].z = NaN;
  expect(check).toThrow('positions');
  positions.enemy[0].z = -41000;
  expect(check).toThrow('40 km');
  positions.enemy = [];
  expect(check).toThrow('every ship');
  // Savo Island, the chart's northern sentinel, stands about 9 km across and 19 km up Iron Bottom Sound's chart.
  const field = await installMapTerrain('iron-bottom-sound'), terrain = placedMapTerrain('iron-bottom-sound', customTerrainOffset(5000))!;
  expect(field.height(9400, -19200)).toBeGreaterThan(200);
  positions.enemy = [{ x: 9400, z: -19200 - 2500, heading: 0 }];
  expect(() => validateSpawns(positions, 1, 1, terrain)).toThrow('land');
  expect(() => new CombatSimulation(shipPreset('bismarck'), { friendlyBots: [], enemies: [shipPreset('bismarck')], spawns: positions, mapId: 'iron-bottom-sound', spawnDistance: 5000 })).toThrow('land');
});

test('a spawn is legal exactly when no land sample lies within 300 m', async () => {
  const field = await installMapTerrain('iron-bottom-sound'), terrain = placedMapTerrain('iron-bottom-sound', customTerrainOffset(8000))!;
  /** Distance from chart point (x, z) to the nearest land sample, searching 400 m around it. */
  const nearestLand = (x: number, z: number) => {
    let best = Infinity;
    for (let j = Math.floor((z - 400 - field.originZ) / field.cell); j <= Math.ceil((z + 400 - field.originZ) / field.cell); j++)
      for (let i = Math.floor((x - 400 - field.originX) / field.cell); i <= Math.ceil((x + 400 - field.originX) / field.cell); i++)
        if (field.sampleIsLand(i, j)) best = Math.min(best, Math.hypot(field.originX + i * field.cell - x, field.originZ + j * field.cell - z));
    return best;
  };
  // March from the open lane toward Guadalcanal and toward the Florida Islands until the clearance ring touches a coast.
  for (const side of [-1, 1]) {
    let x = 0;
    while (Math.abs(x) < 45000 && !terrainLandWithin(terrain, x + side * 20, -4000, 300)) x += side * 20;
    expect(Math.abs(x)).toBeLessThan(45000);
    // The battle places this chart 4 km north: world z −4000 is chart z 0.
    expect(nearestLand(x, 0)).toBeGreaterThan(300);
    expect(nearestLand(x + side * 20, 0)).toBeLessThanOrEqual(300);
    const legal = { friendly: [{ x, z: -4000, heading: 0 }], enemy: [{ x: 0, z: -8000, heading: Math.PI }] };
    expect(() => validateSpawns(legal, 1, 1, terrain)).not.toThrow();
    const beached = { ...legal, friendly: [{ x: x + side * 20, z: -4000, heading: 0 }] };
    expect(() => validateSpawns(beached, 1, 1, terrain)).toThrow('Move the ship farther from land.');
  }
});
