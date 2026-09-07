import { expect, test } from 'bun:test';
import blueprint from '../../assets/ships/bismarck/blueprint.json';
import catalog from '../../assets/parts/guns.json';
import { compileShip } from '../ships/blueprint';
import { shipPreset, shipPresets } from '../ships/presets';
import { CombatSimulation } from './combat';
import { antiAircraftRange, antiAircraftTargets, shipAntiAircraftTargets, updateAntiAircraft } from './antiAircraft';
import type { AirContext, Aircraft } from './aircraft';
import { muzzleWorld } from './weapons';

test('shared AA candidates preserve exhaustive targeting, ties, deck exclusion and immediate losses', () => {
  const { sim, plane } = fixture();
  const planes: Aircraft[] = Array.from({ length: 48 }, (_, i) => ({ ...structuredClone(plane), id: `probe-${i}`,
    team: i % 7 === 0 ? 'friendly' as const : 'enemy' as const,
    phase: i % 9 === 0 ? 'ready' as const : 'outbound' as const,
    position: [i % 3 === 0 ? 700 : 700 + i * 200, 250, 0] as [number, number, number], velocity: [0, 0, 0] as [number, number, number] }));
  const targets = shipAntiAircraftTargets(sim.player, antiAircraftTargets(planes).enemy);
  // A gun earlier in this same tick can kill a candidate; the next must skip it.
  planes[1].hp = 0;
  for (const m of sim.definition.mounts) {
    const initial = sim.player.mounts.find(s => s.id === m.id)!;
    const run = (indexed: boolean) => {
      const state = structuredClone(initial), actors = structuredClone(sim.actors), copied = structuredClone(planes);
      const events: unknown[] = []; let id = 0;
      const ctx: AirContext = { actors, planes: copied, shells: [], torpedoes: [], releases: [], nextId: () => ++id, emit: event => events.push(event) };
      const reserved = updateAntiAircraft(actors[0], m, state, ctx, 1 / 60,
        indexed ? targets.map(p => copied[planes.indexOf(p)]) : undefined);
      return { reserved, state, planes: copied, events };
    };
    expect(run(true)).toEqual(run(false));
  }
});

test('ship AA bounds retain targets at each muzzle range through hull and gun rotation', () => {
  const { sim, plane } = fixture(), actor = sim.player;
  for (const roll of [0, .8, 2.5]) for (const pitch of [-.5, .4]) {
    Object.assign(actor.motion, { x: 500, y: -20, z: -200, heading: 1.3, roll, pitch });
    actor.definition.mounts.forEach((m, i) => {
      const range = antiAircraftRange(m);
      if (!range) return;
      for (const train of [-2, 0, 2]) for (const elevation of [0, 1.4]) {
        const state = { ...actor.mounts[i], train, elevation };
        const muzzle = muzzleWorld(m, state, 0, actor.motion);
        for (const axis of [0, 1, 2]) for (const sign of [-1, 1]) {
          const position = [...muzzle] as [number, number, number];
          position[axis] += sign * range;
          const target = { ...plane, position };
          expect(shipAntiAircraftTargets(actor, [target])).toEqual([target]);
        }
      }
    });
  }
});

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
    let shots = 0, damage = 0;
    for (let tick = 0; tick < 600; tick++) {
      // Hold a fresh target in each cardinal sector so one kill cannot mask
      // an inoperative mount elsewhere on the hull. Use real combat ticks.
      Object.assign(plane, { phase: 'outbound', hp: 100,
        position: [700 * Math.sin(bearing), 250, -700 * Math.cos(bearing)], velocity: [0, 0, 0] });
      sim.step({ throttle: 0, rudder: 0 }, { aim: [0, 0, -5000], fire: false, battery: 'main' });
      damage += 100 - plane.hp;
      for (const event of sim.events) if (event.tick === sim.tick - 1 && event.kind === 'aircraft-fire' && event.shipId === 'player') {
        fired.add(event.message.replace(' · AA fire', '')); shots++;
        expect(event.aircraft?.target).toBeDefined();
        expect(event.aircraft?.tracerSpeed).toBeGreaterThan(0);
        expect(event.position[1]).toBeGreaterThan(0);
      }
    }
    if (shots) {
      expect(sim.player.mounts.reduce((sum, mount) => sum + mount.ammo, 0)).toBeLessThan(ammo);
      expect(damage).toBeGreaterThan(0);
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
