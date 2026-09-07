import { expect, test } from 'bun:test';
import blueprint from '../../assets/ships/bismarck/blueprint.json';
import catalog from '../../assets/parts/guns.json';
import { compileShip } from '../ships/blueprint';
import { shipPreset } from '../ships/presets';
import { CombatSimulation } from './combat';

function fixture() {
  const sim = new CombatSimulation(compileShip(blueprint, catalog), { friendlyBots: [], enemies: [shipPreset('enterprise-cv6')], seed: 93 });
  sim.target.controller = 'idle';
  const plane = sim.target.airWing!.planes[0];
  const run = (seconds = 10) => {
    for (let tick = 0; tick < seconds * 60; tick++) {
      Object.assign(plane, { phase: 'outbound', position: [700, 250, 0], velocity: [0, 0, 0] });
      sim.step({ throttle: 0, rudder: 0 }, { aim: [0, 0, -5000], fire: false, battery: 'main' });
    }
  };
  return { sim, plane, run };
}

test('Bismarck automatically tracks and fires visible AA bursts with finite ammunition', () => {
  const { sim, plane, run } = fixture();
  const ammo = sim.player.mounts.reduce((sum, m) => sum + m.ammo, 0);
  run();
  const shots = sim.events.filter(e => e.kind === 'aircraft-fire' && e.shipId === 'player');
  expect(shots.length).toBeGreaterThan(0);
  expect(shots.every(e => !!e.aircraft?.target && e.position[1] > 0)).toBe(true);
  expect(sim.player.mounts.reduce((sum, m) => sum + m.ammo, 0)).toBeLessThan(ammo);
  expect(plane.hp).toBeLessThan(100);
  expect(sim.player.mounts.filter(m => m.id.includes('-aa-')).some(m => m.elevation > .1)).toBe(true);
  expect(sim.player.mounts.slice(0, 4).every(m => m.ammo === 240)).toBe(true);
});

for (const condition of ['disabled', 'empty', 'magazine', 'sunk', 'friendly', 'hangar', 'distant'] as const) test(`AA respects ${condition} targets or equipment`, () => {
  const { sim, plane } = fixture();
  if (condition === 'disabled') sim.player.mounts.forEach(m => { m.hp = 0; });
  if (condition === 'empty') sim.player.mounts.forEach(m => { m.ammo = 0; });
  if (condition === 'magazine') sim.player.damage.modules.forEach(m => { m.hp = 0; });
  if (condition === 'sunk') sim.player.damage.sunk = true;
  if (condition === 'friendly') plane.team = 'friendly';
  for (let tick = 0; tick < 6 * 60; tick++) {
    Object.assign(plane, { phase: condition === 'hangar' ? 'ready' : 'outbound', position: [condition === 'distant' ? 9000 : 700, 250, 0], velocity: [0, 0, 0] });
    sim.step({ throttle: 0, rudder: 0 }, { aim: [0, 0, -5000], fire: false, battery: 'main' });
  }
  expect(sim.events.filter(e => e.kind === 'aircraft-fire' && e.shipId === 'player')).toHaveLength(0);
});
