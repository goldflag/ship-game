import { expect, test } from 'bun:test';
import blueprint from '../../assets/ships/bismarck/blueprint.json';
import catalog from '../../assets/parts/guns.json';
import { compileShip, type Vec3 } from '../ships/blueprint';
import { CombatSimulation } from './combat';
import { hitShip, updateFlooding, type Shell } from './damage';
import { length, localToWorld, segmentBox, sub, worldToLocal } from './geometry';
import { GRAVITY, solveBallistic } from './weapons';

const definition = () => compileShip(blueprint, catalog);
const stop = { throttle: 0, rudder: 0 };
const round = (penetrationMm = 1000): Shell => ({ id: 1, ownerId: 'player', position: [-100, .5, -21], velocity: [820, 0, 0], age: 0, penetrationMm, damage: 70, caliberM: .38, visited: [] });

test('pose conversions preserve arbitrary points under heading, list and trim', () => {
  const pose = { x: 134, y: -4, z: -721, heading: 2.3, roll: -.31, pitch: .17 };
  const point: Vec3 = [15, -2, 87];
  expect(length(sub(worldToLocal(localToWorld(point, pose), pose), point))).toBeLessThan(1e-10);
});
test('swept collision catches a thin plate between ticks and rejects a parallel miss', () => {
  const box = { center: [0, 0, 0] as Vec3, size: [10, 10, .02] as Vec3 };
  expect(segmentBox([0, 0, -100], [0, 0, 100], box)?.t).toBeCloseTo(.49995, 6);
  expect(segmentBox([6, 0, -100], [6, 0, 100], box)).toBeNull();
});
test('ballistic aim reaches its target under the flight integrator gravity', () => {
  const from: Vec3 = [0, 9, 0], target: Vec3 = [650, .5, -550];
  const solution = solveBallistic(from, target, 820)!;
  const end = from.map((n, i) => n + solution.direction[i] * 820 * solution.time - (i === 1 ? .5 * GRAVITY * solution.time ** 2 : 0)) as Vec3;
  expect(length(sub(end, target))).toBeLessThan(.00001);
  expect(solveBallistic(from, [1e6, 0, 0], 820)).toBeNull();
});
test('armor resolves before internal damage, and a surface/module is only charged once per shell', () => {
  const def = definition(), sim = new CombatSimulation(def);
  Object.assign(sim.target.motion, { x: 0, z: 0 });
  const from: Vec3 = [-100, def.modules[0].center[1], def.modules[0].center[2]], to: Vec3 = [100, from[1], from[2]];
  const low = round(1);
  expect(hitShip(low, from, to, sim.target, def, () => {})).toBe(true);
  expect(sim.target.damage.modules[0].hp).toBe(def.modules[0].hp);
  const shell = round();
  hitShip(shell, from, to, sim.target, def, () => {});
  const hp = sim.target.damage.modules[0].hp;
  expect(hp).toBeLessThan(def.modules[0].hp);
  hitShip(shell, from, to, sim.target, def, () => {});
  expect(sim.target.damage.modules[0].hp).toBe(hp);
});
test('flood connections conserve water with pumps/leaks disabled and list follows the flooded side', () => {
  const def = definition();
  def.connections = [{ fromId:def.compartments[0].id, toId:def.compartments[2].id, areaM2:.05 }]; // Explicit damaged connection fixture.
  def.compartments.forEach(c => c.pumpM3PerSecond = 0);
  const sim = new CombatSimulation(def);
  sim.target.damage.compartments[0].waterM3 = 500;
  for (let i = 0; i < 600; i++) updateFlooding(sim.target, def, 1 / 60);
  expect(sim.target.damage.compartments.reduce((n, c) => n + c.waterM3, 0)).toBeCloseTo(500, 6);
  expect(sim.target.damage.compartments[2].waterM3).toBeGreaterThan(0);
  expect(sim.target.motion.roll).toBeGreaterThan(0);
  expect(sim.target.motion.y).toBeLessThan(0);
});
test('guns obey arcs, reloads and ammunition while actual salvos damage the target', () => {
  const sim = new CombatSimulation(definition());
  const aim = sim.aimAt('engine-port');
  for (let i = 0; i < 1500; i++) sim.step(stop, { aim, fire: true, battery: 'main' });
  const shots = sim.events.filter(e => e.kind === 'shot');
  expect(shots.length).toBe(8);
  expect(sim.player.mounts.slice(0, 4).every(m => m.ammo === 238)).toBe(true);
  expect(sim.target.damage.modules.find(m => m.id === 'engine-port')!.hp).toBe(140);
  expect(sim.events.some(e => e.kind === 'stopped' && e.message.includes('Turtleback'))).toBe(true);
  expect(sim.target.damage.integrity).toBeLessThan(1000);
  expect(sim.target.damage.compartments.some(c => c.breachAreaM2 > 0)).toBe(true);
  for (let i = 0; i < 200; i++) sim.step(stop, { aim: [NaN, 0, 0], fire: true, battery: 'main' });
  expect(sim.events.filter(e => e.kind === 'shot').length).toBe(8);
});
test('same commands at 30, 60 and 144 fps yield identical combat state', () => {
  const states = [30, 60, 144].map(fps => {
    const sim = new CombatSimulation(definition()), aim = sim.aimAt('engine-port');
    for (let i = 0; i < fps * 25; i++) sim.advance(1 / fps, stop, { aim, fire: true, battery: 'main' });
    return JSON.stringify({ tick: sim.tick, player: sim.player, target: sim.target, shells: sim.shells, events: sim.events });
  });
  expect(states[0]).toBe(states[1]); expect(states[1]).toBe(states[2]);
});
test('reset replaces the trial target state without invalidating renderer bindings', () => {
  const sim = new CombatSimulation(definition()), target = sim.target;
  target.damage.integrity = 0; target.motion.y = -15;
  sim.resetTarget();
  expect(sim.target).toBe(target); expect(target.damage.integrity).toBe(1000); expect(target.motion.y).toBe(0);
});
test('destroyed propulsion prevents target acceleration', () => {
  const def = definition(), sim = new CombatSimulation(def); sim.targetUnderway = true;
  def.modules.forEach((m, i) => { if (m.kind === 'engine') sim.target.damage.modules[i].hp = 0; });
  for (let i = 0; i < 600; i++) sim.step(stop, { aim: sim.aimAt(), fire: false, battery: 'main' });
  expect(sim.target.motion.speed).toBe(0);
});

test('penetrating magazine hits detonate once and disable the connected battery mount', () => {
  const def = definition(), sim = new CombatSimulation(def);
  const index = def.modules.findIndex(m => m.id === 'anton-magazine');
  const magazine = def.modules[index];
  const from: Vec3 = [-100, magazine.center[1], magazine.center[2]], to: Vec3 = [100, magazine.center[1], magazine.center[2]];
  const messages: string[] = [];
  for (let i = 0; i < 3; i++) hitShip({ ...round(), ownerId: 'target', id: i }, from, to, sim.player, def, e => messages.push(e.message));
  expect(sim.player.damage.modules[index].detonated).toBe(true);
  expect(messages.filter(m => m.includes('detonation')).length).toBe(1);
  const mount = sim.player.mounts.find(m => m.id === 'anton')!;
  const ammo = mount.ammo;
  for (let i = 0; i < 1500; i++) sim.step(stop, { aim: sim.aimAt(), fire: true, battery: 'main' });
  expect(mount.status).toBe('disabled');
  expect(mount.ammo).toBe(ammo);
});

test('exhausted reserve buoyancy causes sinking and target reset restores dry compartments', () => {
  const def = definition(), sim = new CombatSimulation(def);
  def.compartments.forEach((c, i) => sim.target.damage.compartments[i].waterM3 = c.capacityM3);
  sim.step(stop, { aim: sim.aimAt(), fire: false, battery: 'main' });
  expect(sim.target.damage.sunk).toBe(true);
  const initialDepth = sim.target.motion.y;
  for (let i = 0; i < 60; i++) sim.step(stop, { aim: sim.aimAt(), fire: false, battery: 'main' });
  expect(sim.target.motion.y).toBeLessThan(initialDepth);
  expect(sim.events.filter(e => e.kind === 'sunk').length).toBe(1);
  sim.resetTarget();
  expect(sim.target.damage.sunk).toBe(false);
  expect(sim.target.damage.compartments.every(c => c.waterM3 === 0)).toBe(true);
});
