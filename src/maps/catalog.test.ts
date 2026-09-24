import { expect, test } from 'bun:test';
import { MISSION_TERRAIN_OFFSET, OCEAN_MAPS, battleTerrainOffset, chartUp, customTerrainOffset, loadMapTerrain, mapAction, mapTerrainId, northFromUp, oceanMap, placedMapTerrain, trueBearing } from './catalog';
import { OPEN_SEA, terrainHeight, terrainLandWithin } from './heightfield';
import { installMapTerrain } from './testing';

test('five maps: the open Atlantic and four real battle sites, each naming its chart and bearing', () => {
  expect(OCEAN_MAPS.map(map => map.id)).toEqual(['north-atlantic', 'iron-bottom-sound', 'vestfjord', 'sunda-strait', 'strait-of-dover']);
  expect(OCEAN_MAPS.map(map => map.bearing)).toEqual([0, 315, 75, 295, 45]);
  expect(mapTerrainId('north-atlantic')).toBeUndefined();
  expect(oceanMap('north-atlantic').battle).toBeUndefined();
  for (const map of OCEAN_MAPS.slice(1)) {
    expect(mapTerrainId(map.id)).toBe(map.id);
    expect(map.battle).toMatch(/\d{4}/);
  }
  expect(mapAction(oceanMap('strait-of-dover'))).toBe('Channel Dash, 12 February 1942');
  expect(mapAction(oceanMap('iron-bottom-sound'))).toBe('Savo Island, 9 August 1942');
  expect(mapAction(oceanMap('north-atlantic'))).toBeUndefined();
});

test('custom and online battles centre the chart between the spawn lines; missions on their area', () => {
  expect(customTerrainOffset(5000)).toEqual([0, -2500]);
  expect(customTerrainOffset(20000)).toEqual([0, -10000]);
  expect(MISSION_TERRAIN_OFFSET).toEqual([0, 0]);
  expect(battleTerrainOffset({ spawnDistance: 7000 })).toEqual([0, -3500]);
  expect(battleTerrainOffset({ spawnDistance: 16000, missionRules: {} })).toEqual([0, 0]);
});

test('a placed chart is open sea, pending until its heightfield loads, then the field at the offset', async () => {
  expect(placedMapTerrain('north-atlantic', [0, -2500])).toBe(OPEN_SEA);
  expect(await loadMapTerrain('north-atlantic')).toBeUndefined();
  // Loaded fields are shared by everything in one test process: any map not charted yet reads as pending.
  for (const map of OCEAN_MAPS) if (map.land.terrain && !placedMapTerrain(map.id, [0, 0])) expect(placedMapTerrain(map.id, [0, -2500])).toBeUndefined();
  const field = await installMapTerrain('strait-of-dover');
  expect(await loadMapTerrain('strait-of-dover')).toBe(field);
  const placed = placedMapTerrain('strait-of-dover', customTerrainOffset(5000))!;
  expect(placed.field).toBe(field);
  // World = chart + offset: the chart's centre lies midway between the default spawn lines.
  for (const [x, z] of [[0, 0], [-14000, 9000], [21000, -30000]]) {
    expect(terrainHeight(placed, x, z - 2500)).toBe(field.height(x, z));
    expect(terrainLandWithin(placed, x, z - 2500, 300)).toBe(field.landWithin(x, z, 300));
  }
  // The chart keeps a clear lane for the default spawns at any distance.
  for (const distance of [1000, 5000, 20000]) {
    const lane = placedMapTerrain('strait-of-dover', customTerrainOffset(distance))!;
    expect(terrainLandWithin(lane, 0, 0, 300)).toBe(false);
    expect(terrainLandWithin(lane, 0, -distance, 300)).toBe(false);
  }
});

test('chart bearings read as true bearings, and the chart says where north lies', () => {
  expect(trueBearing(0, 315)).toBe(315);
  expect(trueBearing(90, 315)).toBe(45);
  expect(trueBearing(-30, 0)).toBe(330);
  expect(chartUp(0)).toBe('North up');
  expect(chartUp(75)).toBe('075° up');
  expect(northFromUp(0)).toBe('north up');
  expect(northFromUp(45)).toBe('north 45° left of up');
  expect(northFromUp(315)).toBe('north 45° right of up');
});
