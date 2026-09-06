import { expect, test } from 'bun:test';
import { OCEAN_MAPS, coastOutline, islandHeight, islandRadius, mapIslands } from '../maps/catalog';
import { deployment, validateBattleSetup } from './battle';
import { CombatSimulation } from './combat';
import { shipPreset } from '../ships/presets';
import { avoidLand, firstLandHit, resolveLandContact } from './land';

const bismarck = shipPreset('bismarck');
test('all maps keep maximum-size formations clear at both spawn-distance limits', () => {
  for (const map of OCEAN_MAPS) for (const distance of [1000, 5000, 20000]) {
    const islands = mapIslands(map.id, distance, 30);
    for (const team of ['friendly', 'enemy'] as const) for (let i = 0; i < 30; i++) {
      const p = deployment(i, team, distance);
      for (const island of islands) expect(islandRadius(island, p.x, p.z)).toBeGreaterThan(1.1);
    }
    for (const island of islands) for (const [x, z] of coastOutline(island)) expect(Math.abs(islandHeight(island, x, z))).toBeLessThan(.001);
  }
});
test('coast contact keeps a hull offshore and permits reversing away', () => {
  const sim = new CombatSimulation(bismarck, { friendlyBots: [], enemies: [bismarck], mapId: 'pacific-islands' });
  const island = sim.islands[0], [x, z] = coastOutline(island)[0];
  Object.assign(sim.ship, { x: x - 25, z, heading: -Math.PI / 2, speed: 12 });
  resolveLandContact(sim.player, sim.islands);
  expect(islandRadius(island, sim.ship.x, sim.ship.z)).toBeGreaterThan(1);
  expect(sim.ship.speed).toBe(0);
  sim.ship.speed = -4;
  resolveLandContact(sim.player, sim.islands);
  expect(sim.ship.speed).toBe(-4);
  const command = avoidLand(sim.player, { throttle: .8, rudder: 0 }, sim.islands);
  expect(Math.abs(command.rudder)).toBeGreaterThan(.1);
  sim.reset();
  expect(sim.mapId).toBe('pacific-islands');
  expect(sim.ship.x).toBe(0);
});
test('swept land contact stops low projectiles, allows overflight, and leaves open ocean clear', () => {
  const island = mapIslands('indian-volcanic-coast', 5000, 1)[0];
  const from: [number,number,number] = [island.x - island.rx * 2, 40, island.z];
  const to: [number,number,number] = [island.x + island.rx * 2, 40, island.z];
  const hit = firstLandHit([island], from, to)!;
  expect(hit.t).toBeGreaterThan(0); expect(hit.t).toBeLessThan(.5);
  expect(islandHeight(island, hit.point[0], hit.point[2])).toBeCloseTo(40, 1);
  expect(firstLandHit([island], [from[0], 2000, from[2]], [to[0], 2000, to[2]])).toBeUndefined();
  expect(firstLandHit([], from, to)).toBeUndefined();
});
test('battle map selection rejects unknown maps and sea conditions while old setups remain valid', () => {
  const setup = { playerShipId: 'bismarck', friendlyBots: [], enemies: ['bismarck'], spawnDistance: 5000 };
  expect(() => validateBattleSetup(setup, ['bismarck'])).not.toThrow();
  expect(() => validateBattleSetup({ ...setup, mapId: 'missing' as never }, ['bismarck'])).toThrow('map');
  expect(() => validateBattleSetup({ ...setup, sea: 'missing' as never }, ['bismarck'])).toThrow('sea');
});

test('the live projectile path ends at land with a coast impact event', async () => {
  const { advanceProjectile } = await import('./projectile');
  const island = mapIslands('pacific-islands', 5000, 1)[0];
  const [x, z] = coastOutline(island)[0];
  const shell = { id: 999, ownerId: 'player', position: [x + 10, 1, z] as [number,number,number], velocity: [-1000, 0, 0] as [number,number,number], age: 0, penetrationMm: 500, damage: 100, caliberM: .38, visited: [] };
  const events: string[] = [];
  const outcome = advanceProjectile(shell, [], .1, e => events.push(e.message), [island]);
  expect(outcome).toBe('stopped');
  expect(events).toEqual(['Shell struck the coast']);
});
