import { expect, test } from 'bun:test';
import { shipPresets } from '../ships/presets';
import { compileShip } from '../ships/blueprint';
import catalog from '../../assets/parts/guns.json';
import { maximumRangeM } from '../ships/statistics';
import { createShipState, stepShip } from './ship';
import { CombatSimulation } from './combat';
import { resolveShipCollisions } from './collisions';

test('every authored fleet gun has air resistance and small guns have bounded physical reach', async () => {
  for (const id of Object.keys(shipPresets)) {
    const blueprint = await Bun.file(`assets/ships/${id}/blueprint.json`).json();
    const def = compileShip(blueprint, catalog);
    for (const m of def.mounts) {
      expect(m.weapon.ballistics?.dragPerSecond, `${id}: ${m.weapon.id}`).toBeGreaterThan(0);
      if (m.weapon.caliberM <= .04) expect(maximumRangeM(m.weapon)).toBeLessThan(10000);
    }
    expect(def.damageControl, id).toBeDefined();
    expect(def.stability, id).toBeDefined();
  }
});

test('a sustained hard turn costs speed and a powerless hull coasts down', () => {
  const straight = createShipState(), turn = createShipState();
  for (let i = 0; i < 12000; i++) {
    stepShip(straight, { throttle: 1, rudder: 0 });
    stepShip(turn, { throttle: 1, rudder: 1 });
  }
  expect(turn.speed).toBeLessThan(straight.speed * .95);
  for (let i = 0; i < 600; i++) stepShip(straight, { throttle: 1, rudder: 0 }, undefined, 0);
  expect(straight.speed).toBeLessThan(15);
});

test('a high speed ram damages both hulls and creates positional breaches; resting contact does not repeat damage', () => {
  const sim = new CombatSimulation(shipPresets.bismarck as any);
  const a = sim.player, b = sim.target;
  Object.assign(a.motion, { x: 0, z: 0, heading: 0, speed: 12 });
  Object.assign(b.motion, { x: 0, z: -245, heading: Math.PI, speed: 12 });
  resolveShipCollisions(sim.actors);
  expect(a.damage.integrity).toBeLessThan(a.damage.maxIntegrity);
  expect(b.damage.integrity).toBeLessThan(b.damage.maxIntegrity);
  expect(a.damage.compartments.some(c => c.breachAreaM2 > 0)).toBe(true);
  const hp = a.damage.integrity;
  for (let i = 0; i < 60; i++) resolveShipCollisions(sim.actors);
  expect(a.damage.integrity).toBeCloseTo(hp, 5);
});


test('256 existing shells do not suppress a loaded gun salvo', () => {
  const sim = new CombatSimulation(shipPresets.bismarck as any);
  const aim: [number, number, number] = [0, 0, -1500];
  for (let i = 0; i < 300; i++) sim.step({ throttle: 0, rudder: 0 }, { aim, battery: 'main', fire: false });
  for (let i = 0; i < 256; i++) sim.shells.push({ id: 1000 + i, ownerId: 'player', position: [10000 + i, 100, 0], velocity: [100, 0, 0], age: 0, penetrationMm: 500, damage: 70, caliberM: .38, visited: [] });
  sim.step({ throttle: 0, rudder: 0 }, { aim, battery: 'main', fire: true });
  expect(sim.shells.length).toBeGreaterThan(256);
  expect(sim.events.some(e => e.kind === 'shot')).toBe(true);
});
