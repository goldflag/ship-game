import { expect, test } from 'bun:test';
import type { Vec3 } from '../ships/blueprint';
import { shipPreset } from '../ships/presets';
import { weaponGroups } from '../ships/weaponGroups';
import { antiAircraftRange } from './antiAircraft';
import { CombatSimulation } from './combat';
import { FIXED_DT } from './ship';
import { availableAmmunition } from './weapons';

const helm = { throttle: 0, rudder: 0 };

/** A hostile carrier that never moves or shoots, with one aircraft the test positions each tick. */
function airDefenseFixture(playerId: string, seed = 93) {
  const definition = shipPreset(playerId);
  const sim = new CombatSimulation(definition, { friendlyBots: [], enemies: [shipPreset('enterprise-cv6')], seed });
  sim.target.controller = 'idle';
  const plane = sim.target.airWing!.planes[0];
  const hover = (position: Vec3 | undefined) => {
    if (position) Object.assign(plane, { phase: 'outbound', hp: 100, position: [...position], velocity: [0, 0, 0] });
    else Object.assign(plane, { phase: 'ready', hp: 100 });
  };
  return { definition, sim, plane, hover };
}

test('every mount advances its reload and recoil once per tick and spends at most one salvo, under AA and surface control alike', () => {
  const { definition, sim, hover } = airDefenseFixture('bismarck');
  const sight: Vec3 = [sim.ship.x + 1800, .5, sim.ship.z];
  let aaBursts = 0, surfaceSalvos = 0;
  for (let tick = 0; tick < 1500; tick++) {
    hover([sim.ship.x + 700, 250, sim.ship.z]);
    const before = sim.player.mounts.map(m => ({ ...m }));
    sim.step(helm, { aim: sight, fire: true, battery: 'main' });
    sim.player.mounts.forEach((state, i) => {
      const previous = before[i], weapon = definition.mounts[i].weapon, barrels = weapon.barrelCount ?? 2;
      const spent = previous.ammo - state.ammo;
      expect(previous.heAmmo - state.heAmmo).toBe(previous.loaded === 'he' ? spent : 0);
      if (spent) {
        expect(spent).toBe(barrels);
        expect(state.status).toBe('reloading');
        expect(state.recoil).toBe(1);
        expect(state.reload).toBe(weapon.reloadSeconds);
        if (antiAircraftRange(definition.mounts[i])) aaBursts++; else surfaceSalvos++;
      } else {
        expect(state.reload).toBeCloseTo(Math.max(0, previous.reload - FIXED_DT), 9);
        expect(state.recoil).toBeCloseTo(Math.max(0, previous.recoil - FIXED_DT / 1.4), 9);
      }
    });
  }
  expect(aaBursts).toBeGreaterThan(20);
  expect(surfaceSalvos).toBeGreaterThan(0);
  expect(sim.events.filter(e => e.kind === 'aircraft-fire' && e.shipId === 'player').length).toBeGreaterThan(0);
});

test('a dual-purpose gun keeps its queued HE order and reload progress through manual, automatic and manual control', () => {
  const { definition, sim, hover } = airDefenseFixture('baltimore');
  const group = weaponGroups(definition).find(g => g.battery === 'secondary' && g.caliberMm > 100)!;
  const index = definition.mounts.findIndex(m => m.id === 'secondary-53');
  const mount = definition.mounts[index], state = sim.player.mounts[index];
  const sea: Vec3 = [sim.ship.x + 2500, .5, sim.ship.z], sky: Vec3 = [sim.ship.x + 700, 250, sim.ship.z];
  const manual = { aim: sea, fire: true, battery: group.battery, weaponGroupId: group.id, ammunition: 'he' as const };
  const automatic = { aim: sea, fire: false, battery: 'main' as const };
  const initial = { ...state };
  // Manual: the loaded AP salvo fires first while HE waits for the reload.
  for (let tick = 0; tick < 600 && state.ammo === initial.ammo; tick++) { hover(undefined); sim.step(helm, manual); }
  expect(state.ammo).toBe(initial.ammo - 2);
  expect(state.loaded).toBe('ap'); expect(state.queued).toBe('he');
  expect(state.reload).toBe(mount.weapon.reloadSeconds);
  expect(sim.events.filter(e => e.kind === 'shot' && e.message === `${mount.name} fired`).every(e => e.shell?.ammunition === 'ap')).toBe(true);
  // Automatic: an aircraft takes the mount mid-reload; the reload continues without
  // restarting, HE loads when it completes, and the first burst fires that same tick.
  let ticksToLoad = 0;
  while (state.loaded === 'ap') {
    const reload = state.reload;
    hover(sky); sim.step(helm, automatic); ticksToLoad++;
    expect(state.aimCache!.point[1]).toBeGreaterThan(100);
    if (state.loaded === 'ap') {
      expect(state.reload).toBeCloseTo(reload - FIXED_DT, 9);
      expect(state.ammo).toBe(initial.ammo - 2);
    }
  }
  expect(Math.abs(ticksToLoad - mount.weapon.reloadSeconds / FIXED_DT)).toBeLessThanOrEqual(1);
  expect(state.queued).toBeUndefined();
  for (let tick = 0; tick < 300; tick++) { hover(sky); sim.step(helm, automatic); }
  const bursts = sim.events.filter(e => e.kind === 'aircraft-fire' && e.message === `${mount.name} · AA fire`).length;
  expect(bursts).toBeGreaterThan(0);
  expect(state.heAmmo).toBe(initial.heAmmo - 2 * bursts);
  expect(availableAmmunition(state, 'ap')).toBe(availableAmmunition(initial, 'ap') - 2);
  // Manual again: the same HE load returns to the sea target without another load interval.
  const handback = { ammo: state.ammo, reload: state.reload };
  let reload = state.reload, ticksToSalvo = 0;
  while (state.ammo === handback.ammo && ticksToSalvo < 600) {
    hover(sky); sim.step(helm, manual); ticksToSalvo++;
    if (state.ammo === handback.ammo) { expect(state.reload).toBeLessThanOrEqual(reload + 1e-9); reload = state.reload; }
  }
  expect(state.ammo).toBe(handback.ammo - 2);
  expect(state.loaded).toBe('he');
  const shots = sim.events.filter(e => e.kind === 'shot' && e.message === `${mount.name} fired`);
  expect(shots.at(-1)!.shell?.ammunition).toBe('he');
  expect(shots.at(-1)!.position[1]).toBeLessThan(20);
});

test('losing the aircraft during an AA reload hands the mount back to the sight without resetting or double-stepping the reload', () => {
  const { definition, sim, hover } = airDefenseFixture('bismarck');
  const index = definition.mounts.findIndex(m => m.id === 'starboard-aa-105-1');
  const mount = definition.mounts[index], state = sim.player.mounts[index];
  const sight: Vec3 = [sim.ship.x + 3000, .5, sim.ship.z], sky: Vec3 = [sim.ship.x + 700, 250, sim.ship.z];
  const intent = { aim: sight, fire: false, battery: 'main' as const };
  const initial = state.ammo;
  for (let tick = 0; tick < 1200 && state.ammo === initial; tick++) { hover(sky); sim.step(helm, intent); }
  expect(state.ammo).toBe(initial - 2);
  expect(state.reload).toBe(mount.weapon.reloadSeconds);
  expect(state.aimCache!.point[1]).toBeGreaterThan(100);
  let ticks = 0;
  while (state.reload > 0) {
    const reload = state.reload;
    hover(undefined); sim.step(helm, intent); ticks++;
    expect(state.reload).toBeCloseTo(Math.max(0, reload - FIXED_DT), 9);
    expect(state.ammo).toBe(initial - 2);
  }
  expect(Math.abs(ticks - mount.weapon.reloadSeconds / FIXED_DT)).toBeLessThanOrEqual(1);
  // Without a target the unselected dual-purpose gun follows the sight again but never fires.
  expect(state.aimCache!.point).toEqual(sight);
  for (let tick = 0; tick < 120; tick++) { hover(undefined); sim.step(helm, intent); }
  expect(state.status).toBe('ready');
  expect(state.ammo).toBe(initial - 2);
});

test('an AA lane through a friendly hull blocks the burst and conserves stock, reload and recoil', () => {
  const run = (screened: boolean) => {
    const definition = shipPreset('bismarck');
    const sim = new CombatSimulation(definition, { friendlyBots: [{ definition, aiLevel: 'static' }], enemies: [shipPreset('enterprise-cv6')], seed: 93 });
    sim.target.controller = 'idle';
    const friend = sim.actors.find(a => a.team === 'friendly' && a !== sim.player)!;
    Object.assign(friend.motion, { x: screened ? sim.ship.x + 850 : sim.ship.x - 4000, z: sim.ship.z, heading: 0 });
    // Calm crews aim at the aircraft itself; panic fire deliberately points elsewhere.
    for (const state of sim.player.mounts) state.aaDiscipline = { remaining: 1e9, sequence: 0, panic: false, yaw: 0, pitch: 0 };
    const plane = sim.target.airWing!.planes[0];
    for (let tick = 0; tick < 600; tick++) {
      Object.assign(plane, { phase: 'outbound', hp: 100, position: [sim.ship.x + 900, 2, sim.ship.z], velocity: [0, 0, 0] });
      sim.step(helm, { aim: [sim.ship.x, 0, sim.ship.z - 5000], fire: false, battery: 'main' });
    }
    return sim;
  };
  const clear = run(false), screened = run(true);
  expect(clear.events.filter(e => e.kind === 'aircraft-fire' && e.shipId === 'player').length).toBeGreaterThan(0);
  expect(screened.events.filter(e => e.kind === 'aircraft-fire' && e.shipId === 'player')).toHaveLength(0);
  const aaMounts = screened.definition.mounts.map((m, i) => ({ mount: m, state: screened.player.mounts[i] })).filter(({ mount }) => antiAircraftRange(mount) > 0);
  const blocked = aaMounts.filter(({ state }) => state.status === 'blocked' && state.aimCache && state.aimCache.point[0] > screened.ship.x + 800);
  expect(blocked.length).toBeGreaterThan(0);
  for (const { mount, state } of aaMounts) {
    expect(state.ammo).toBe(mount.weapon.ammoPerBarrel * (mount.weapon.barrelCount ?? 2));
    expect(state.reload).toBe(0); expect(state.recoil).toBe(0);
  }
});

test('a flooded magazine disables its mounts mid-reload without spending or advancing, and draining restores them', () => {
  const definition = shipPreset('bismarck'), sim = new CombatSimulation(definition);
  const sight: Vec3 = [sim.ship.x + 1800, .5, sim.ship.z];
  const served = definition.mounts.map((m, i) => ({ mount: m, state: sim.player.mounts[i] })).filter(({ mount }) => mount.magazineId === 'bruno-magazine');
  expect(served.length).toBeGreaterThan(1);
  const bruno = served.find(({ mount }) => mount.id === 'bruno')!;
  for (let tick = 0; tick < 3600 && bruno.state.reload === 0; tick++) sim.step(helm, { aim: sight, fire: true, battery: 'main' });
  expect(bruno.state.reload).toBeGreaterThan(0);
  const room = definition.compartments.findIndex(c => c.id === definition.modules.find(m => m.id === 'bruno-magazine')!.compartmentId);
  const water = sim.player.damage.compartments[room];
  water.waterM3 = definition.compartments[room].capacityM3;
  const frozen = served.map(({ state }) => ({ ...state }));
  const events = sim.events.length;
  for (let tick = 0; tick < 30; tick++) {
    water.waterM3 = definition.compartments[room].capacityM3;
    sim.step(helm, { aim: sight, fire: true, battery: 'main' });
    served.forEach(({ state }, i) => {
      expect(state.status).toBe('disabled');
      expect(state.reload).toBe(frozen[i].reload); expect(state.ammo).toBe(frozen[i].ammo);
    });
  }
  const names = served.map(({ mount }) => `${mount.name} fired`);
  expect(sim.events.slice(events).filter(e => e.kind === 'shot' && names.includes(e.message))).toHaveLength(0);
  water.waterM3 = 0;
  sim.step(helm, { aim: sight, fire: false, battery: 'main' });
  served.forEach(({ state }, i) => {
    expect(state.status).not.toBe('disabled');
    expect(state.reload).toBeCloseTo(Math.max(0, frozen[i].reload - FIXED_DT), 9);
  });
});
