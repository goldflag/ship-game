import { updateStability } from './stability';
import { meanHullY } from './ship';
import { submarinePropulsion } from './submarine';
import { expect, test } from 'bun:test';
import { shipPreset, shipPresets } from '../ships/presets';
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


test('each intact hull settles after a small disturbance with the sea solver enabled', () => {
  for (const id of Object.keys(shipPresets)) {
    const def = shipPreset(id);
    const actor = new CombatSimulation(def).player;
    actor.motion.pitch = .005; actor.motion.roll = .01;
    for (let i = 0; i < 3600; i++) updateStability(actor, def, 1 / 60, { heave: 0, roll: 0, pitch: 0 });
    expect(Math.abs(meanHullY(actor.motion)), def.id).toBeLessThan(.05);
    expect(Math.abs(actor.motion.pitch), def.id).toBeLessThan(.005);
    expect(Math.abs(actor.motion.roll), def.id).toBeLessThan(.005);
  }
});

test('storm troughs do not dive a surfaced submarine or switch its engines and weapons', () => {
  const sub = shipPreset('type-viic');
  const sim = new CombatSimulation(sub, { friendlyBots: [], enemies: [{ definition: def, aiLevel: 'static' }], weather: 'storm-clouds', seed: 7 });
  let troughs = 0;
  for (let i = 0; i < 3600; i++) {
    sim.step(helm, intent);
    if (sim.ship.y >= -.5) continue;
    troughs++;
    expect(submarinePropulsion(sim.player, sub)!.handling).toBe(sub.handling);
    expect(sim.player.mounts.some(m => m.status === 'submerged')).toBe(false);
    const info = sim.telemetry('main', intent.aim);
    expect(info.submarine!.propulsion).toBe('Diesel');
    expect(info.submarine!.depthM).toBeCloseTo(0, 8);
    expect(info.playerDraftChange).toBeCloseTo(0, 8);
  }
  expect(troughs).toBeGreaterThan(100);
});

test('explicit wind reaches CPU sea through battle fleet resolution', () => {
  for (const windSpeed of [0, 9, 30]) {
    const fleet = resolveBattleFleet({ playerShipId: 'bismarck', friendlyBots: [], enemies: ['bismarck'], spawnDistance: 5000, cloudCover: 0, windSpeed }, shipPreset);
    const sim = new CombatSimulation(def, fleet);
    expect(sim.sea.windMps).toBe(windSpeed);
    if (windSpeed === 0) expect(sim.sea.amplitudeM).toBe(0);
    else expect(sim.sea.amplitudeM).toBeGreaterThan(0);
  }
});
