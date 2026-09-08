import { expect, test } from 'bun:test';
import blueprint from '../../assets/ships/bismarck/blueprint.json';
import catalog from '../../assets/parts/guns.json';
import { compileShip } from '../ships/blueprint';
import { shipPreset, shipPresets } from '../ships/presets';
import { antiAircraftRange } from './antiAircraft';
import { CombatSimulation } from './combat';
import { ballisticStep } from './ballistics';
import { add, scale } from './geometry';

function fixture() {
  const sim = new CombatSimulation(compileShip(blueprint, catalog), { friendlyBots: [], enemies: [shipPreset('enterprise-cv6')], seed: 93 });
  sim.target.controller = 'idle';
  const plane = sim.target.airWing!.planes[0];
  const run = (seconds = 10) => {
    for (let tick = 0; tick < seconds * 60; tick++) {
      if (plane.hp <= 0) break;
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
  const heavyShots = shots.filter(e => e.aircraft?.airburst);
  expect(heavyShots.length).toBeGreaterThan(0);
  expect(shots.some(e => !e.aircraft?.airburst)).toBe(true);
  for (const event of heavyShots) {
    const data = event.aircraft!, burst = data.airburst!;
    expect(burst.caliberM).toBeGreaterThan(.08);
    expect(burst.flightTime).toBeGreaterThan(0);
    expect(ballisticStep(event.position, add(scale(data.direction!, data.tracerSpeed!), data.velocity!), burst.flightTime, data.dragPerSecond).position).toEqual(data.target!);
  }
  expect(sim.player.mounts.reduce((sum, m) => sum + m.ammo, 0)).toBeLessThan(ammo);
  expect(plane.hp).toBeLessThan(100);
  expect(sim.player.mounts.filter(m => m.id.includes('-aa-')).some(m => m.elevation > .1)).toBe(true);
  expect(sim.player.mounts.slice(0, 4).every(m => m.ammo === 240)).toBe(true);
});

test('AA admits 5.25-inch dual-purpose guns but excludes low-angle and larger guns', () => {
  const mount = shipPreset('king-george-v').mounts.find(m => m.battery === 'secondary')!;
  expect(antiAircraftRange(mount)).toBe(3200);
  expect(antiAircraftRange({ ...mount, weapon: { ...mount.weapon, elevationMaxDeg: 69 } })).toBe(0);
  expect(antiAircraftRange({ ...mount, weapon: { ...mount.weapon, caliberM: .15 } })).toBe(0);
});

for (const id of Object.keys(shipPresets)) test(`${id}: every registered AA mount fires in a fleet engagement`, () => {
  const def = shipPreset(id), mounts = def.mounts.filter(m => antiAircraftRange(m) > 0);
  expect(mounts.length).toBeGreaterThan(0);
  const fired = new Set<string>();
  for (const bearing of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const sim = new CombatSimulation(def, { friendlyBots: [], enemies: [shipPreset('enterprise-cv6')], seed: 93 });
    sim.target.controller = 'idle';
    const plane = sim.target.airWing!.planes[0];
    const ammo = sim.player.mounts.reduce((sum, mount) => sum + mount.ammo, 0);
    let shots = 0;
    for (let tick = 0; tick < 600; tick++) {
      // Hold a fresh target in each cardinal sector so one kill cannot mask
      // an inoperative mount elsewhere on the hull. Use real combat ticks.
      Object.assign(plane, { phase: 'outbound', hp: 100,
        position: [700 * Math.sin(bearing), 250, -700 * Math.cos(bearing)], velocity: [0, 0, 0] });
      sim.step({ throttle: 0, rudder: 0 }, { aim: [0, 0, -5000], fire: false, battery: 'main' });
      for (const event of sim.events) if (event.tick === sim.tick - 1 && event.kind === 'aircraft-fire' && event.shipId === 'player') {
        fired.add(event.message.replace(' · AA fire', '')); shots++;
        expect(event.aircraft?.target).toBeDefined();
        expect(event.aircraft?.tracerSpeed).toBeGreaterThan(0);
        const firedMount = mounts.find(mount => event.message === `${mount.name} · AA fire`)!;
        expect(event.aircraft?.caliberM).toBe(firedMount.weapon.caliberM);
        expect(event.position[1]).toBeGreaterThan(0);
      }
    }
    if (shots) {
      expect(sim.player.mounts.reduce((sum, mount) => sum + mount.ammo, 0)).toBeLessThan(ammo);
    }
  }
  expect(mounts.filter(mount => !fired.has(mount.name)).map(mount => mount.id)).toEqual([]);
}, 30000);

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
