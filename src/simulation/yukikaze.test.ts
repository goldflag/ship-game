import { expect, test } from 'bun:test';
import { shipPreset } from '../ships/presets';
import { CombatSimulation } from './combat';
import type { Battery, Vec3 } from '../ships/blueprint';
import { tubeLocalPosition } from './torpedoes';

const def = shipPreset('yukikaze');
function step(sim: CombatSimulation, ticks: number, battery: Battery, fire = false, aim: Vec3 = [1500, 0, 0]) {
  for (let i = 0; i < ticks; i++) sim.step({ throttle: 0, rudder: 0 }, { battery, fire, aim });
}
test.each([-1, 1])('Yukikaze quadruple banks train and launch from both broadside sockets (%s)', side => {
  const sim = new CombatSimulation(def), aim: Vec3 = [1500 * side, 0, 0];
  step(sim, 450, 'torpedo', false, aim);
  const muzzle = tubeLocalPosition(sim.player, def.torpedoTubes![0]);
  sim.requestFire(); step(sim, 1, 'torpedo', false, aim);
  expect(sim.events.find(e => e.kind === 'torpedo-launch')?.position).toEqual(muzzle);
  step(sim, 450, 'torpedo', true, aim);
  expect(sim.events.filter(e => e.kind === 'torpedo-launch')).toHaveLength(8);
  expect(sim.torpedoes.every(t => t.velocity[0] * side > 0)).toBe(true);
  expect(sim.player.torpedoTubes!.every(t => t.ammo === 1)).toBe(true);
  sim.reset();
  expect(sim.player.torpedoTubes!.every(t => t.ammo === 2)).toBe(true);
  expect(sim.player.torpedoLaunchers!.every(l => l.train === 0)).toBe(true);
});
test('Yukikaze twin battery fires through authored armor and preserves reset state', () => {
  const sim = new CombatSimulation(def);
  const initial = sim.player.mounts.map(m => m.ammo);
  step(sim, 1000, 'main', true);
  expect(sim.events.some(e => e.kind === 'shot')).toBe(true);
  expect(def.armor.filter(a => a.plate?.mountId === 'main-1').length).toBeGreaterThan(20);
  expect(sim.player.mounts.some((m, i) => def.mounts[i].battery === 'main' && m.ammo < initial[i])).toBe(true);
  sim.reset();
  expect(sim.player.damage.integrity).toBe(sim.player.damage.maxIntegrity);
  expect(sim.player.mounts.slice(0, 3).every(m => m.recoil === 0)).toBe(true);
});
test('Yukikaze stern release pattern consumes charges without spending torpedoes', () => {
  const sim = new CombatSimulation(def);
  step(sim, 160, 'depth-charge', true);
  expect(sim.events.filter(e => e.kind === 'depth-charge-launch')).toHaveLength(7);
  expect(sim.player.depthChargeLaunchers!.reduce((n, l) => n + l.ammo, 0)).toBe(11);
  expect(sim.player.torpedoTubes!.reduce((n, t) => n + t.ammo, 0)).toBe(16);
  sim.reset();
  expect(sim.player.depthChargeLaunchers!.reduce((n, l) => n + l.ammo, 0)).toBe(18);
});

test('Yukikaze launcher stops constrain training and reverse through the clear forward sector', async () => {
  const { trainTorpedoLaunchers } = await import('./torpedoes');
  const sim = new CombatSimulation(def), p = sim.player;
  const l = def.torpedoLaunchers![0], state = p.torpedoLaunchers![0];
  const limit = l.traverseLimitsDeg![1] * Math.PI / 180;
  const aim = (angle: number): Vec3 => [l.position[0] + 1000 * Math.sin(angle), 0, l.position[2] - 1000 * Math.cos(angle)];
  state.train = limit;
  trainTorpedoLaunchers(p, () => aim(-limit), 1 / 60);
  expect(state.train).toBeLessThan(limit);
  let crossedNeutral = false;
  for (let i = 0; i < 1000; i++) {
    trainTorpedoLaunchers(p, () => aim(-limit), 1 / 60);
    expect(Math.abs(state.train)).toBeLessThanOrEqual(limit + 1e-10);
    crossedNeutral ||= Math.abs(state.train) < .01;
  }
  expect(crossedNeutral).toBe(true);
  expect(state.train).toBeCloseTo(-limit, 9);
  for (let i = 0; i < 1000; i++) trainTorpedoLaunchers(p, () => aim(170 * Math.PI / 180), 1 / 60);
  expect(state.train).toBeCloseTo(limit, 9);
});

test('launcher travel validates neutral and reachable firing sectors while remaining optional', async () => {
  const { compileShip } = await import('../ships/blueprint');
  const source = await Bun.file('assets/ships/yukikaze/blueprint.json').json();
  const catalog = await Bun.file('assets/parts/guns.json').json();
  for (const limits of [[10, 100], [-110, -5], [110, -110], [-181, 130], [-90, 90]]) {
    const b = structuredClone(source); b.torpedoLaunchers[0].traverseLimitsDeg = limits;
    expect(() => compileShip(b, catalog)).toThrow();
  }
  delete source.torpedoLaunchers[0].traverseLimitsDeg;
  expect(compileShip(source, catalog).torpedoLaunchers![0].traverseLimitsDeg).toBeUndefined();
});
