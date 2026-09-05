import { expect, test } from 'bun:test';
import blueprint from '../../assets/ships/bismarck/blueprint.json';
import catalog from '../../assets/parts/guns.json';
import { compileShip, type Vec3 } from '../ships/blueprint';
import { CombatSimulation } from './combat';
import { hitShip, updateFlooding, type DamageEvent, type Shell } from './damage';
import { length, localToWorld, segmentBox, sub, worldToLocal } from './geometry';
import { GRAVITY, shotDirection, solveBallistic } from './weapons';
import { FIXED_DT } from './ship';

const definition = () => compileShip(blueprint, catalog);
const stop = { throttle: 0, rudder: 0 };
const round = (penetrationMm = 1000): Shell => ({ id: 1, ownerId: 'player', position: [-100, .5, -21], velocity: [820, 0, 0], age: 0, penetrationMm, damage: 70, caliberM: .38, visited: [] });

for (const aim of [[1800, 0, 0], [0, 0, 1800], [1800, 1000, 0], [40000, 0, 0]] as Vec3[]) {
  test(`loaded guns fire at their current bearing before reaching reticle ${aim}`, () => {
    const def = definition(), sim = new CombatSimulation(def);
    const mount = def.mounts[0], state = sim.player.mounts[0];
    sim.step(stop, { aim, fire: false, battery: 'main' });
    expect(Math.abs(state.train)).toBeLessThan(.01);
    expect(state.status).toBe('ready');
    const telemetry = sim.telemetry('main', aim);
    expect(telemetry.ready).toBeGreaterThan(0);
    expect(telemetry.batteries[0].ready).toBe(telemetry.ready);
    const ammo = state.ammo;
    sim.requestFire();
    sim.step(stop, { aim, fire: false, battery: 'main' });
    expect(state.ammo).toBe(ammo - 2);
    expect(state.reload).toBe(mount.weapon.reloadSeconds);
    expect(state.recoil).toBe(1);
    expect(sim.events.filter(e => e.message === `${mount.name} fired`)).toHaveLength(2);
    const direction = shotDirection(mount, state, sim.ship);
    const shell = sim.shells[0];
    direction.forEach((n, axis) => expect(shell.velocity[axis]).toBeCloseTo(n * mount.weapon.muzzleSpeed - (axis === 1 ? GRAVITY * FIXED_DT : 0), 6));
    expect(shell.velocity[2]).toBeLessThan(-800);
    sim.step(stop, { aim, fire: true, battery: 'main' });
    expect(state.ammo).toBe(ammo - 2);
  });
}

test('firing during traverse still respects obstructions, empty guns and disabled guns', () => {
  const def = definition(), sim = new CombatSimulation(def);
  // A wall across the bow blocks Anton while the reticle is to starboard.
  def.obstructions.push({ id: 'test-bow-wall', center: [0, 10, -120], size: [100, 30, 2] });
  sim.player.mounts[1].ammo = 0;
  sim.player.mounts[2].hp = 0;
  const before = sim.player.mounts.map(m => m.ammo);
  sim.step(stop, { aim: [1800, 0, 0], fire: true, battery: 'main' });
  expect(sim.player.mounts.slice(0, 3).map(m => m.status)).toEqual(['blocked', 'empty', 'disabled']);
  expect(sim.player.mounts.slice(0, 3).map(m => m.ammo)).toEqual(before.slice(0, 3));
});

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
test('aimed salvos obey reloads and ammunition while damaging the target', () => {
  const sim = new CombatSimulation(definition());
  const aim = sim.aimAt('engine-port');
  for (let i = 0; i < 3600; i++) sim.step(stop, { aim, fire: false, battery: 'main' });
  for (let i = 0; i < 600; i++) sim.step(stop, { aim, fire: true, battery: 'main' });
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
test('shot and splash events retain matching caliber and independent velocity snapshots', () => {
  const sim = new CombatSimulation(definition()), aim: Vec3 = [450, .5, 0];
  for (let i = 0; i < 1800; i++) sim.step(stop, { aim, fire: false, battery: 'main' });
  sim.step(stop, { aim, fire: true, battery: 'main' });
  const shots = sim.events.filter(e => e.kind === 'shot');
  expect(shots.length).toBe(8);
  const velocity: Vec3 = [...shots[0].shell!.velocity];
  for (let i = 0; i < 120; i++) sim.step(stop, { aim, fire: false, battery: 'main' });
  const splashes = sim.events.filter(e => e.kind === 'splash');
  expect(splashes.length).toBe(8);
  for (const shot of shots) {
    const splash = splashes.find(e => e.shell?.id === shot.shell?.id)!;
    expect(splash.shell!.caliberM).toBe(shot.shell!.caliberM);
    expect(splash.shell!.velocity[1]).toBeLessThan(shot.shell!.velocity[1]);
    expect(splash.position[1]).toBe(0);
  }
  expect(shots[0].shell!.velocity).toEqual(velocity);
});
test('impact normals are in world coordinates and internal damage has no surface normal', () => {
  const def = definition(), sim = new CombatSimulation(def);
  const localSim = new CombatSimulation(def), localEvents: DamageEvent[] = [];
  Object.assign(localSim.target.motion, { x: 0, y: 0, z: 0, heading: 0, roll: 0, pitch: 0 });
  hitShip(round(), [-100, .5, -21], [100, .5, -21], localSim.target, def, e => localEvents.push(e));
  Object.assign(sim.target.motion, { x: 45, z: 80, heading: .8, roll: .2, pitch: -.1 });
  const pose = sim.target.motion, events: DamageEvent[] = [];
  hitShip(round(), localToWorld([-100, .5, -21], pose), localToWorld([100, .5, -21], pose), sim.target, def, e => events.push(e));
  const plate = events.find(e => e.kind === 'penetration')!;
  expect(length(plate.normal!)).toBeCloseTo(1, 8);
  const localNormal = localEvents.find(e => e.kind === 'penetration')!.normal!;
  const origin = localToWorld([0, 0, 0], pose), expected = sub(localToWorld(localNormal, pose), origin);
  expect(length(sub(plate.normal!, expected))).toBeLessThan(1e-9);
  // Exercise interior metadata without depending on a preset's penetration budget.
  const [x, y, z] = def.modules.find(m => m.kind === 'engine')!.center;
  hitShip(round(), localToWorld([x - .1, y, z], pose), localToWorld([x + .1, y, z], pose), sim.target, def, e => events.push(e));
  expect(events.some(e => e.kind === 'module' && !e.normal)).toBe(true);
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
