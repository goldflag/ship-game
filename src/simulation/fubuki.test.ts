import { expect, test } from 'bun:test';
import { shipPreset } from '../ships/presets';
import { CombatSimulation } from './combat';
import type { Battery, Vec3 } from '../ships/blueprint';
import { tubeLocalPosition } from './torpedoes';

const def = shipPreset('fubuki');
function step(sim: CombatSimulation, ticks: number, battery: Battery, fire = false, aim: Vec3 = [1500, 0, 0]) {
  for (let i = 0; i < ticks; i++) sim.step({ throttle: 0, rudder: 0 }, { battery, fire, aim });
}
test.each([-1, 1])('Fubuki trains and launches all three triple banks on broadside %s, then resets', side => {
  const sim = new CombatSimulation(def), aim: Vec3 = [1500 * side, 0, 0];
  step(sim, 450, 'torpedo', false, aim);
  const muzzle = tubeLocalPosition(sim.player, def.torpedoTubes![0]);
  sim.requestFire(); step(sim, 1, 'torpedo', false, aim);
  expect(sim.events.find(e => e.kind === 'torpedo-launch')?.position).toEqual(muzzle);
  step(sim, 450, 'torpedo', true, aim);
  expect(sim.events.filter(e => e.kind === 'torpedo-launch')).toHaveLength(9);
  expect(sim.torpedoes.every(t => t.velocity[0] * side > 0)).toBe(true);
  expect(sim.player.torpedoTubes!.every(t => t.ammo === 1)).toBe(true);
  sim.reset();
  expect(sim.player.torpedoTubes!.every(t => t.ammo === 2)).toBe(true);
  expect(sim.player.torpedoLaunchers!.every(l => l.train === 0)).toBe(true);
});
test('Fubuki main battery fires through its authored exterior and depth charges spend their own stock', () => {
  const sim = new CombatSimulation(def), initial = sim.player.mounts.map(m => m.ammo);
  step(sim, 1000, 'main', true);
  expect(sim.events.some(e => e.kind === 'shot')).toBe(true);
  expect(sim.player.mounts.filter((m,i) => def.mounts[i].battery === 'main').every((m,i) => m.ammo < initial[i])).toBe(true);
  sim.reset(); step(sim, 160, 'depth-charge', true);
  expect(sim.events.filter(e => e.kind === 'depth-charge-launch')).toHaveLength(5);
  expect(sim.player.depthChargeLaunchers!.reduce((n,l) => n+l.ammo,0)).toBe(15);
  expect(sim.player.torpedoTubes!.reduce((n,t) => n+t.ammo,0)).toBe(18);
  sim.reset();
  expect(sim.player.depthChargeLaunchers!.reduce((n,l) => n+l.ammo,0)).toBe(20);
  expect(sim.player.damage.integrity).toBe(sim.player.damage.maxIntegrity);
});
