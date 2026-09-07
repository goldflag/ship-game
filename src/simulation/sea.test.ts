import { expect, test } from 'bun:test';
import { shipPreset } from '../ships/presets';
import { CombatSimulation } from './combat';
import { createSeaState, seaHeight, seaResponse } from './sea';
import { resolveBattleFleet } from './battle';
const def = shipPreset('bismarck');
const helm = { throttle: 1, rudder: 0 }, intent = { aim: [0, 0, -5000] as [number, number, number], battery: 'main' as const, fire: false };

test('battle weather reaches CPU seas, while port remains calm', () => {
  const fleet = resolveBattleFleet({ playerShipId: 'bismarck', friendlyBots: [], enemies: [{ shipId: 'bismarck', aiLevel: 'static' }], weather: 'storm-clouds', spawnDistance: 5000 }, shipPreset);
  expect(new CombatSimulation(def, fleet).sea.amplitudeM).toBeGreaterThan(1);
  expect(new CombatSimulation(def).sea.amplitudeM).toBe(0);
});
test('storm seas move the authoritative hull, add leeway and cost speed without capsizing an intact battleship', () => {
  const runs = [undefined, 'storm-clouds' as const].map(weather => {
    const sim = new CombatSimulation(def, { friendlyBots: [], enemies: [{ definition: def, aiLevel: 'static' }], weather, seed: 7 });
    let motion = 0;
    for (let i = 0; i < 7200; i++) { sim.step(helm, intent); motion += Math.abs(sim.ship.y) + Math.abs(sim.ship.roll); }
    return { sim, motion };
  });
  expect(runs[1].motion).toBeGreaterThan(runs[0].motion + 50);
  expect(runs[1].sim.ship.speed).toBeLessThan(runs[0].sim.ship.speed);
  expect(Math.abs(runs[1].sim.ship.driftX ?? 0)).toBeGreaterThan(.01);
  expect(runs[1].sim.player.damage.sunk).toBe(false);
  expect(Math.abs(runs[1].sim.ship.roll)).toBeLessThan(.25);
});
test('sea forcing is deterministic, survives resets and decays with submarine depth', () => {
  const sea = createSeaState('north-atlantic', 'storm-clouds', 123);
  expect(seaHeight(sea, 1, 2, 3)).toBe(seaHeight(structuredClone(sea), 1, 2, 3));
  const sub = new CombatSimulation(shipPreset('type-viic')).player;
  const surface = seaResponse(sub, sea, 10);
  sub.motion.y = -50;
  expect(Math.abs(seaResponse(sub, sea, 10).heave)).toBeLessThan(Math.abs(surface.heave) * .01);
  const sim = new CombatSimulation(def, { friendlyBots: [], enemies: [{ definition: def, aiLevel: 'static' }], weather: 'storm-clouds', seed: 9 });
  for (let i = 0; i < 120; i++) sim.step(helm, intent);
  const before = structuredClone(sim.ship); sim.reset();
  for (let i = 0; i < 120; i++) sim.step(helm, intent);
  expect(sim.ship).toEqual(before);
});


test('a surfaced submarine heaves without changing its ballast order', () => {
  const sub = shipPreset('type-viic');
  const sim = new CombatSimulation(sub, { friendlyBots: [], enemies: [{ definition: def, aiLevel: 'static' }], weather: 'storm-clouds', seed: 9 });
  let maxHeave = 0;
  for (let i = 0; i < 1800; i++) {
    sim.step({ throttle: 0, rudder: 0 }, intent);
    maxHeave = Math.max(maxHeave, Math.abs(sim.ship.y));
  }
  expect(maxHeave).toBeGreaterThan(.1);
  expect(sim.player.submarine!.targetDepthM).toBe(0);
  expect(sim.player.submarine!.ballastM3).toBe(0);
  expect(sim.player.damage.sunk).toBe(false);
});


test('steady turning heel points outward in both directions', () => {
  const sim = new CombatSimulation(def);
  const calm = createSeaState('north-atlantic', undefined, 1);
  sim.ship.speed = 12;
  sim.ship.yawRate = .01;
  expect(seaResponse(sim.player, calm, 0).roll).toBeGreaterThan(0); // Port down, starboard up.
  sim.ship.yawRate = -.01;
  expect(seaResponse(sim.player, calm, 0).roll).toBeLessThan(0);
});
