import { expect, test } from 'bun:test';
import { OCEAN_MAPS, customTerrainOffset, placedMapTerrain } from '../../maps/catalog';
import { OPEN_SEA, terrainLandWithin } from '../../maps/heightfield';
import { installMapTerrain } from '../../maps/testing';
import { shipPresets } from '../../ships/presets';
import { BATTLE_SPAWN_DISTANCE, MAX_BATTLE_SPAWN_DISTANCE, MIN_BATTLE_SPAWN_DISTANCE, formationSpawns, validateBattleSetup, validateSpawns } from './battleSetup';

test('fleet validation rejects empty enemies, unavailable presets and overfull teams', () => {
  const setup = { playerShipId: 'bismarck', friendlyBots: [], enemies: ['yamato'], spawnDistance: BATTLE_SPAWN_DISTANCE };
  const ids = Object.keys(shipPresets);
  expect(() => validateBattleSetup(setup, ids, OPEN_SEA)).not.toThrow();
  expect(() => validateBattleSetup({ ...setup, friendlyBots: Array(29).fill('bismarck'), enemies: Array(30).fill('yamato') }, ids, OPEN_SEA)).not.toThrow();
  expect(() => validateBattleSetup({ ...setup, enemies: [] }, ids, OPEN_SEA)).toThrow('at least one enemy');
  expect(() => validateBattleSetup({ ...setup, playerShipId: 'missing' }, ids, OPEN_SEA)).toThrow('unavailable');
  expect(() => validateBattleSetup({ ...setup, friendlyBots: Array(30).fill('bismarck') }, ids, OPEN_SEA)).toThrow('up to 30');
  expect(() => validateBattleSetup({ ...setup, enemies: Array(31).fill('bismarck') }, ids, OPEN_SEA)).toThrow('up to 30');
});

test('spawn distance accepts its limits and rejects invalid values', () => {
  const setup = { playerShipId: 'bismarck', friendlyBots: [], enemies: ['yamato'], spawnDistance: BATTLE_SPAWN_DISTANCE };
  const ids = Object.keys(shipPresets);
  for (const spawnDistance of [MIN_BATTLE_SPAWN_DISTANCE, 7500, MAX_BATTLE_SPAWN_DISTANCE]) {
    expect(() => validateBattleSetup({ ...setup, spawnDistance }, ids, OPEN_SEA)).not.toThrow();
  }
  for (const spawnDistance of [NaN, Infinity, -Infinity, 0, -1000, MIN_BATTLE_SPAWN_DISTANCE - 1, MAX_BATTLE_SPAWN_DISTANCE + 1]) {
    expect(() => validateBattleSetup({ ...setup, spawnDistance }, ids, OPEN_SEA)).toThrow('spawn distance');
  }
});

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
