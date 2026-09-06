import { expect, test } from 'bun:test';
import blueprint from '../../assets/ships/fletcher/blueprint.json';
import catalog from '../../assets/parts/guns.json';
import { compileShip, type Battery, type Vec3 } from '../ships/blueprint';
import { shipPreset } from '../ships/presets';
import { shipStatistics } from '../ships/statistics';
import { CombatSimulation } from './combat';
import { depthChargeReach, botShouldDropDepthCharge, launchDepthCharge, stepDepthCharge, type DepthCharge } from './depthCharges';
import { FIXED_DT } from './ship';
import { tubeLocalPosition } from './torpedoes';
import { localToWorld } from './geometry';
import { updateCapability } from './stability';

const definition = compileShip(blueprint, catalog), helm = { throttle: 0, rudder: 0 };
const intent = (battery: Battery, fire = false, aim: Vec3 = [1500, 0, 0]) => ({ battery, fire, aim });
const step = (sim: CombatSimulation, ticks: number, battery: Battery, fire = false, aim: Vec3 = [1500, 0, 0]) => {
  for (let i = 0; i < ticks; i++) sim.step(helm, intent(battery, fire, aim));
};
const ammo = (sim: CombatSimulation) => sim.telemetry('depth-charge', [0, 0, 0]).batteries.find(b => b.battery === 'depth-charge')!.ammo;
const readyBlast = (sim: CombatSimulation, position: Vec3, id = 999): DepthCharge => ({ ...launchDepthCharge(sim.player, definition.depthChargeLaunchers![0], id), submerged: true, position, velocity: [0, -2.5, 0] });

test('Fletcher registers five single main guns, two quintuple torpedo mounts and 28 depth charges', () => {
  expect(shipPreset('fletcher').id).toBe('fletcher');
  expect(definition.mounts.filter(m => m.battery === 'main').map(m => m.weapon.barrelCount)).toEqual([1, 1, 1, 1, 1]);
  expect(definition.torpedoLaunchers).toHaveLength(2);
  expect(definition.torpedoTubes).toHaveLength(10);
  expect(definition.torpedoTubes!.every(t => t.ammo === 1)).toBe(true);
  expect(definition.depthChargeLaunchers).toHaveLength(8);
  expect(ammo(new CombatSimulation(definition))).toBe(28);
  const section = shipStatistics(definition).find(s => s.title === 'Depth charges')!;
  expect(section.headline).toBe('28');
  expect(section.rows.find(r => r.label === 'Detonation depth')?.value).toBe('10');
});

test('rejects dangling launcher links, conflicting sockets, invalid release data and charge parts', () => {
  const bad = (edit: (b: any) => void, message: RegExp) => { const b = structuredClone(blueprint); edit(b); expect(() => compileShip(b, catalog)).toThrow(message); };
  bad(b => b.torpedoTubes[0].launcherId = 'missing', /unknown torpedo launcher/);
  bad(b => b.torpedoLaunchers[0].launchArcsDeg = [[90, -90]], /ordered launch arc/);
  bad(b => b.depthChargeLaunchers[0].id = b.mounts[0].id, /duplicate/);
  bad(b => b.depthChargeLaunchers[0].ammo = 1.5, /integer/);
  bad(b => b.depthChargeLaunchers[0].velocity[0] = Infinity, /finite/);
  bad(b => b.depthChargeLaunchers[0].position[1] = -1, /above water/);
  bad(b => b.depthChargeLaunchers[0].magazineId = 'engine-aft', /magazine/);
  bad(b => b.depthChargeLaunchers[0].partId = 'missing', /unknown depth charge/);
  const c = structuredClone(catalog); c.depthCharges[0].sinkSpeed = 0;
  expect(() => compileShip(blueprint, c)).toThrow(/sinkSpeed/);
});

test('trainable tubes preserve ammunition while turning or aiming through the superstructure sectors', () => {
  const sim = new CombatSimulation(definition);
  sim.requestFire(); step(sim, 1, 'torpedo');
  expect(sim.torpedoes).toHaveLength(0);
  expect(sim.player.torpedoTubes![0].status).toBe('turning');
  step(sim, 400, 'torpedo');
  expect(sim.torpedoes).toHaveLength(0); // failed click is consumed
  expect(sim.player.torpedoTubes!.filter(t => t.status === 'ready')).toHaveLength(10);
  step(sim, 1, 'torpedo', true, [0, 0, -1500]);
  expect(sim.player.torpedoTubes![0].status).toBe('out-of-arc');
  expect(sim.telemetry('torpedo', [0, 0, 0]).batteries.find(b => b.battery === 'torpedo')!.ammo).toBe(10);
});

test.each([-1, 1])('both broadsides launch all ten rounds from the rotated sockets (%s)', side => {
  const sim = new CombatSimulation(definition), aim: Vec3 = [side * 1500, 0, 0];
  step(sim, 450, 'torpedo', false, aim);
  const muzzle = tubeLocalPosition(sim.player, definition.torpedoTubes![0]);
  sim.requestFire(); step(sim, 1, 'torpedo', false, aim);
  expect(sim.events.find(e => e.kind === 'torpedo-launch')!.position).toEqual(muzzle);
  expect(sim.torpedoes[0].velocity[0] * side).toBeGreaterThan(0);
  step(sim, 450, 'torpedo', true, aim);
  expect(sim.events.filter(e => e.kind === 'torpedo-launch')).toHaveLength(10);
  expect(sim.torpedoes.every(t => t.position[1] <= 0)).toBe(true);
  expect(sim.player.torpedoTubes!.every(t => t.ammo === 0 && t.status === 'empty')).toBe(true);
  expect(sim.shells).toHaveLength(0);
});

test('depth charge click releases one; held fire spaces a pattern and respects reload/ammo', () => {
  const sim = new CombatSimulation(definition);
  sim.requestFire(); step(sim, 1, 'depth-charge', false, [NaN, 0, NaN]);
  expect(sim.depthCharges).toHaveLength(1); expect(ammo(sim)).toBe(27);
  expect(sim.depthCharges[0].position[2]).toBeGreaterThan(55);
  step(sim, 160, 'depth-charge', true);
  const launches = sim.events.filter(e => e.kind === 'depth-charge-launch');
  expect(launches).toHaveLength(8);
  for (let i = 1; i < launches.length; i++) expect(launches[i].tick - launches[i - 1].tick).toBeGreaterThanOrEqual(21);
  expect(ammo(sim)).toBe(20); expect(sim.shells).toHaveLength(0); expect(sim.torpedoes).toHaveLength(0);
});

test('side throwers arc outward; charges splash then sink and burst at the authored depth', () => {
  const sim = new CombatSimulation(definition), l = definition.depthChargeLaunchers!.find(l => l.velocity[0] > 0)!;
  const charge = launchDepthCharge(sim.player, l, 1); const start = [...charge.position];
  let splashes = 0, ended = false;
  for (let i = 0; i < 600 && !ended; i++) { const r = stepDepthCharge(charge, FIXED_DT); if (r.splash) splashes++; ended = r.detonated; }
  expect(splashes).toBe(1); expect(ended).toBe(true);
  expect(charge.position[0]).toBeGreaterThan(start[0] + 20);
  expect(charge.position[1]).toBe(-l.weapon.detonationDepthM);
  const coarse = launchDepthCharge(sim.player, l, 2); stepDepthCharge(coarse, 10);
  coarse.position.forEach((v, i) => expect(v).toBeCloseTo(charge.position[i], 6));
});

test('nearby blasts damage surfaced submarines, open breaches, credit score and spare distant hulls', () => {
  const sim = new CombatSimulation(definition, { friendlyBots: [], enemies: [shipPreset('type-viic')], spawnDistance: 1000 });
  sim.target.controller = 'idle'; sim.target.motion.x = 200; sim.target.motion.z = 0;
  const engine = sim.target.definition.modules.find(m => m.kind === 'engine')!;
  sim.depthCharges.push(readyBlast(sim, localToWorld([engine.center[0], -10, engine.center[2]], sim.target.motion)));
  const playerHp = sim.player.damage.integrity;
  step(sim, 2, 'depth-charge');
  expect(sim.target.damage.integrity).toBeLessThan(sim.target.damage.maxIntegrity);
  expect(sim.target.damage.compartments.some(c => c.breachAreaM2 > 0 && c.waterM3 > 0)).toBe(true);
  expect(sim.telemetry('depth-charge', [0, 0, 0]).playerDamageDealt).toBeCloseTo(sim.target.damage.maxIntegrity - sim.target.damage.integrity, 6);
  expect(sim.player.damage.integrity).toBe(playerHp);
  expect(sim.depthCharges).toHaveLength(0);
  expect(sim.events.filter(e => e.kind === 'depth-charge-blast')).toHaveLength(1);
});

test('blast falloff uses three-dimensional hull distance; allies and own ship can be damaged without score', () => {
  const sim = new CombatSimulation(definition, { friendlyBots: [definition], enemies: [definition], spawnDistance: 1000 });
  const ally = sim.actors[1]; ally.controller = 'idle'; ally.motion.x = 500;
  sim.target.controller = 'idle';
  const far = depthChargeReach([0, -100, 0], sim.player).distance;
  expect(far).toBeGreaterThan(90);
  sim.depthCharges.push(readyBlast(sim, [0, -10, 0]), readyBlast(sim, [500, -10, 0], 1000));
  step(sim, 1, 'depth-charge');
  expect(sim.player.damage.integrity).toBeLessThan(sim.player.damage.maxIntegrity);
  expect(ally.damage.integrity).toBeLessThan(ally.damage.maxIntegrity);
  expect(sim.telemetry('depth-charge', [0, 0, 0]).playerDamageDealt).toBe(0);
});

test('a depth-charge breach earns a later flooding frag once and reset restores every weapon, pose and score', () => {
  const sim = new CombatSimulation(definition); sim.target.motion.x = 200; sim.target.motion.z = 0;
  sim.depthCharges.push(readyBlast(sim, [200, -10, 0]));
  step(sim, 2, 'depth-charge');
  expect(sim.target.damage.sunk).toBe(false);
  expect(sim.target.damage.compartments.some(c => c.breachAreaM2 > 0)).toBe(true);
  sim.target.damage.compartments.forEach((c, i) => c.waterM3 = sim.target.definition.compartments[i].capacityM3);
  step(sim, 2, 'depth-charge');
  expect(sim.target.damage.sunk).toBe(true);
  expect(sim.telemetry('depth-charge', [0, 0, 0]).playerFrags).toBe(1);
  step(sim, 1, 'depth-charge', true);
  sim.reset();
  expect(sim.depthCharges).toHaveLength(0); expect(ammo(sim)).toBe(28);
  expect(sim.player.torpedoLaunchers!.every(l => l.train === 0)).toBe(true);
  expect(sim.telemetry('depth-charge', [0, 0, 0]).playerFrags).toBe(0);
});

test('surviving depth charges keep a disarmed destroyer in battle until their stock is exhausted', () => {
  const sim = new CombatSimulation(definition);
  sim.player.mounts.forEach(m => { m.ammo = 0; m.heAmmo = 0; });
  sim.player.torpedoTubes!.forEach(t => t.ammo = 0);
  updateCapability(sim.player, definition);
  expect(sim.player.damage.stability.combatLost).toBe(false);
  step(sim, 1, 'depth-charge', true);
  expect(ammo(sim)).toBe(27);
  sim.player.depthChargeLaunchers!.forEach(l => l.ammo = 0);
  updateCapability(sim.player, definition);
  expect(sim.player.damage.stability.combatLost).toBe(true);
  expect(sim.player.damage.defeatCause).toBe('ammunition-exhausted');
});

test.each([12, 70])('depth-charge reach uses the submarine actual depth (%s m)', depth => {
  const sim = new CombatSimulation(definition, { friendlyBots: [], enemies: [shipPreset('type-viic')] });
  sim.target.controller = 'idle';
  Object.assign(sim.target.motion, { x: 200, y: -depth, z: 0, heading: 0 });
  sim.target.submarine!.targetDepthM = depth;
  sim.depthCharges.push(readyBlast(sim, [200, -10, 11.4]));
  step(sim, 1, 'depth-charge');
  expect(sim.target.damage.compartments.some(c => c.breachAreaM2 > 0)).toBe(depth === 12);
  expect(sim.events.filter(e => e.kind === 'depth-charge-hit' && e.shipId === sim.target.motion.id)).toHaveLength(depth === 12 ? 1 : 0);
});

test('destroyed magazine, empty stations, sunk hull and full projectile pool cannot consume ammunition', () => {
  for (const reason of ['magazine', 'empty', 'sunk', 'pool']) {
    const sim = new CombatSimulation(definition);
    if (reason === 'magazine') sim.player.damage.modules.find(m => m.id === 'depth-charge-magazine')!.hp = 0;
    if (reason === 'empty') sim.player.depthChargeLaunchers!.forEach(l => l.ammo = 0);
    if (reason === 'sunk') sim.player.damage.sunk = true;
    if (reason === 'pool') for (let i = 0; i < 128; i++) sim.depthCharges.push(launchDepthCharge(sim.player, definition.depthChargeLaunchers![0], i));
    const before = ammo(sim); step(sim, 1, 'depth-charge', true);
    expect(ammo(sim)).toBe(before);
    expect(sim.events.filter(e => e.kind === 'depth-charge-launch')).toHaveLength(0);
  }
});

test('bots recognize a close depth-charge pass and refuse to blast a friendly hull', () => {
  const sim = new CombatSimulation(definition), l = definition.depthChargeLaunchers![0];
  sim.player.motion.speed = 15;
  const charge = launchDepthCharge(sim.player, l, 1); stepDepthCharge(charge, 10);
  sim.target.motion.x = charge.position[0]; sim.target.motion.z = charge.position[2];
  expect(botShouldDropDepthCharge(sim.player, sim.target, l, sim.actors)).toBe(true);
  const friend = { ...sim.target, team: 'friendly' as const };
  expect(botShouldDropDepthCharge(sim.player, sim.target, l, [...sim.actors, friend])).toBe(false);
});
