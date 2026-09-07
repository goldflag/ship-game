import { HULL_HP_SCALE } from './durability';
import { expect, test } from 'bun:test';
import blueprint from '../../assets/ships/bismarck/blueprint.json';
import catalog from '../../assets/parts/guns.json';
import { compileShip, type Ammunition, type Vec3 } from '../ships/blueprint';
import { CombatSimulation } from './combat';
import { advanceProjectile } from './projectile';
import { type DamageEvent, type Shell } from './damage';
import { availableAmmunition, createMountState, queueAmmunition, selectAmmunition, updateMount } from './weapons';

test('AP and HE stocks are finite, share capacity, and switching never creates rounds or skips loading', () => {
  const def = compileShip(blueprint, catalog), m = def.mounts[0], state = createMountState(m), initial = state.ammo;
  expect(availableAmmunition(state, 'he')).toBe(96); expect(availableAmmunition(state, 'ap')).toBe(144);
  const pose = new CombatSimulation(def).ship;
  selectAmmunition(m, state, 'he'); expect(state.reload).toBe(m.weapon.reloadSeconds);
  updateMount(m, state, def, pose, undefined, 10);
  selectAmmunition(m, state, 'ap'); expect(state.reload).toBe(m.weapon.reloadSeconds);
  selectAmmunition(m, state, 'he'); expect(state.reload).toBe(m.weapon.reloadSeconds);
  expect(state.ammo).toBe(initial); expect(availableAmmunition(state, 'ap') + availableAmmunition(state, 'he')).toBe(initial);
});

test('HUD ammunition counts follow the loaded type and each battery retains its shell selection', () => {
  const def = compileShip(blueprint, catalog), sim = new CombatSimulation(def);
  const aim: Vec3 = [2000, 10, 0], helm = { throttle: 0, rudder: 0 };
  const initial = sim.telemetry('main', aim);
  expect(initial.batteries[0].ammo).toBe(initial.ammunitionStock.ap);
  sim.step(helm, { aim, fire: false, battery: 'main', ammunition: 'he' });
  sim.step(helm, { aim, fire: false, battery: 'secondary', ammunition: 'ap' });
  const main = sim.telemetry('main', aim), secondary = sim.telemetry('secondary', aim);
  expect(main.ammunition).toBe('he'); expect(secondary.ammunition).toBe('ap');
  expect(main.ammunitionStock).toEqual(initial.ammunitionStock);
  expect(main.batteries[0].ammo).toBe(main.ammunitionStock.ap);
  expect(main.mounts.every(m => m.loaded === 'ap' && m.reload === 0)).toBe(true);
  // Finish a load while another battery is selected: the order remains in effect.
  for (const state of sim.player.mounts) state.reload = .001;
  sim.step(helm, { aim, fire: false, battery: 'secondary', ammunition: 'ap' });
  const loaded = sim.telemetry('main', aim);
  expect(loaded.mounts.every(m => m.loaded === 'he' && m.reload === 0 && m.ammo === 96)).toBe(true);
  expect(main.ready).toBe(0);
  for (const state of sim.player.mounts) if (state.loaded === 'he') { state.ammo -= state.heAmmo; state.heAmmo = 0; }
  sim.step(helm, { aim, fire: false, battery: 'main', ammunition: 'he' });
  const empty = sim.telemetry('main', aim);
  expect(empty.batteries[0].ammo).toBe(0); expect(empty.mounts.every(m => m.status === 'empty')).toBe(true);
  expect(empty.ammunitionStock.ap).toBe(initial.ammunitionStock.ap);
  sim.reset(); expect(sim.telemetry('main', aim).ammunition).toBe('ap');
});

test('an AP-only mount remains usable when its battery is ordered to load HE', () => {
  const def = compileShip(blueprint, catalog), m = { ...def.mounts[0], weapon: { ...def.mounts[0].weapon, he: undefined } };
  const state = createMountState(m);
  selectAmmunition(m, state, 'he');
  expect(state.loaded).toBe('ap');
  expect(state.reload).toBe(0);
  expect(availableAmmunition(state)).toBe(state.ammo);
});

test('the real fire loop waits for HE loading, consumes only HE, records type, and resets both stocks', () => {
  const def = compileShip(blueprint, catalog);
  def.mounts = [{ ...def.mounts[0], position: [0, 10, 0], bearingDeg: 90 }]; def.obstructions = [];
  const sim = new CombatSimulation(def), state = sim.player.mounts[0], before = structuredClone(state);
  const intent = { aim: [2000, 10, 0] as Vec3, fire: true, battery: 'main' as const, ammunition: 'he' as const };
  selectAmmunition(def.mounts[0], state, 'he');
  for (let i = 0; i < 1190; i++) sim.step({ throttle: 0, rudder: 0 }, intent);
  expect(sim.events.some(e => e.kind === 'shot')).toBe(false);
  for (let i = 0; i < 20; i++) sim.step({ throttle: 0, rudder: 0 }, intent);
  const shots = sim.events.filter(e => e.kind === 'shot');
  expect(shots).toHaveLength(2); expect(shots.every(e => e.shell?.ammunition === 'he')).toBe(true);
  expect(state.ammo).toBe(before.ammo - 2); expect(state.heAmmo).toBe(before.heAmmo - 2);
  expect(availableAmmunition(state, 'ap')).toBe(availableAmmunition(before, 'ap'));
  expect(sim.shellHistory.every(h => h.ammunition === 'he')).toBe(true);
  sim.reset(); expect(sim.player.mounts[0]).toEqual(before);
});

test('HE bursts at its first physical contact and cannot transmit damage through heavy armor', () => {
  const damages = [0, 5, 320].map(thickness => {
    const def = compileShip(blueprint, catalog);
    def.mounts = []; def.connections = []; delete def.propulsion;
    def.armor = thickness ? [{ id: 'shield', name: 'Shield', thicknessMm: thickness, center: [0, 5, 0], size: [.001, 8, 8],
      plate: { vertices: [[0, 1, -4], [0, 9, -4], [0, 9, 4], [0, 1, 4]], material: 'steel' } }] : [];
    def.modules = [{ ...def.modules[0], id: 'equipment', hp: 100, center: [2, 5, 0], size: [1, 1, 1] }];
    const sim = new CombatSimulation(def); Object.assign(sim.target.motion, { x: 0, z: 0 });
    const shell: Shell = { id: 99, ownerId: 'player', position: [-1, 5, 0], velocity: [800, 0, 0], age: 0, penetrationMm: 0,
      damage: 70, caliberM: .38, visited: [], ammunition: 'he', he: catalog.parts[0].he };
    const events: DamageEvent[] = [];
    expect(advanceProjectile(shell, [sim.target], 1 / 60, e => { if (e.kind !== 'splash') events.push(e); })).toBe('burst');
    expect(events.filter(e => e.kind === 'contact')).toHaveLength(1);
    expect(events.some(e => e.kind === 'penetration')).toBe(false);
    expect(shell.position[0]).toBe(thickness ? 0 : 1.5);
    const hullDamage = sim.target.damage.maxIntegrity - sim.target.damage.integrity;
    if (thickness === 320) expect(hullDamage).toBe(0);
    else { expect(hullDamage).toBeGreaterThan(0); expect(hullDamage).toBeLessThanOrEqual(Math.ceil(shell.he!.damage * .5 * HULL_HP_SCALE)); }
    return 100 - sim.target.damage.modules[0].hp;
  });
  expect(damages[0]).toBe(100); expect(damages[1]).toBeGreaterThan(0); expect(damages[1]).toBeLessThan(damages[0]); expect(damages[2]).toBe(0);
});

test('HE gives useful local damage where a thin target does not arm AP', () => {
  const damage = (type: Ammunition) => {
    const def = compileShip(blueprint, catalog); def.armor = []; def.mounts = []; def.connections = []; delete def.propulsion;
    def.modules = [{ ...def.modules[0], id: 'equipment', hp: 100, center: [0, 5, 0], size: [1, 1, 1] }];
    const sim = new CombatSimulation(def); Object.assign(sim.target.motion, { x: 0, z: 0 });
    const shell: Shell = { id: 99, ownerId: 'player', position: [-1, 5, 0], velocity: [800, 0, 0], age: 0, penetrationMm: 600,
      damage: 70, caliberM: .38, visited: [], ammunition: type, ap: type === 'ap' ? catalog.parts[0].ap : undefined, he: type === 'he' ? catalog.parts[0].he : undefined };
    advanceProjectile(shell, [sim.target], 1 / 60, () => {});
    if (type === 'ap') expect(shell.detonateAtAge).toBeUndefined();
    return 100 - sim.target.damage.modules[0].hp;
  };
  expect(damage('he')).toBeGreaterThan(damage('ap'));
});

test('HE profiles reject invalid mass and stock allocations; old parts stay AP-only', () => {
  const copy = structuredClone(catalog);
  copy.parts[0].he!.stockFraction = 1.1; expect(() => compileShip(blueprint, copy)).toThrow();
  copy.parts[0].he!.stockFraction = .4; copy.parts[0].he!.explosiveKg = copy.parts[0].projectileMassKg;
  expect(() => compileShip(blueprint, copy)).toThrow();
  delete (copy.parts[0] as { he?: unknown }).he;
  const def = compileShip(blueprint, copy), state = createMountState(def.mounts[0]);
  expect(state.heAmmo).toBe(0); expect(availableAmmunition(state, 'ap')).toBe(state.ammo);
});
test('a contact HE burst can open thin exterior plating but cannot breach a heavy belt', () => {
  const openings = [19, 320].map(thickness => {
    const def = compileShip(blueprint, catalog); def.mounts = []; def.modules = []; def.connections = []; delete def.propulsion; delete def.floodRegions;
    def.armor = [{ id: 'shell', name: 'Shell plate', center: [0, 5, 0], size: [.001, 8, 8], thicknessMm: thickness,
      plate: { vertices: [[0, 1, -4], [0, 9, -4], [0, 9, 4], [0, 1, 4]], material: 'steel', exterior: true } }];
    const sim = new CombatSimulation(def); Object.assign(sim.target.motion, { x: 0, z: 0 });
    advanceProjectile({ id: 99, ownerId: 'player', position: [-1, 5, 0], velocity: [800, 0, 0], age: 0, penetrationMm: 0,
      damage: 70, caliberM: .38, visited: [], he: catalog.parts[0].he }, [sim.target], 1 / 60, () => {});
    return sim.target.damage.compartments.reduce((n, c) => n + c.breachAreaM2, 0);
  });
  expect(openings[0]).toBeCloseTo(.38 ** 2, 9); expect(openings[1]).toBe(0);
});
test('a contact burst on a thin watertight boundary can perforate it at zero ray distance', () => {
  const def = compileShip(blueprint, catalog); def.armor = []; def.mounts = []; def.modules = []; delete def.propulsion;
  def.connections = [{ id: 'partition', fromId: def.compartments[0].id, toId: def.compartments[1].id, areaM2: .5, state: 'closed', thicknessMm: 5,
    bounds: { center: [0, 5, 0], size: [.01, 4, 4] } }];
  const sim = new CombatSimulation(def); Object.assign(sim.target.motion, { x: 0, z: 0 });
  advanceProjectile({ id: 99, ownerId: 'player', position: [-1, 5, 0], velocity: [800, 0, 0], age: 0, penetrationMm: 0,
    damage: 70, caliberM: .38, visited: [], he: catalog.parts[0].he }, [sim.target], 1 / 60, () => {});
  expect(sim.target.damage.connections[0].state).toBe('damaged');
  expect(sim.target.damage.connections[0].damageAreaM2).toBeGreaterThan(0);
});
test('a contact burst pays legacy gunhouse armor even when its ray starts exactly on the box face', () => {
  const damage = [25, 320].map(armorMm => {
    const def = compileShip(blueprint, catalog); def.armor = []; def.modules = []; def.connections = []; delete def.propulsion;
    def.mounts = [{ ...def.mounts[0], position: [0, 4, 0], bearingDeg: 0, weapon: { ...def.mounts[0].weapon, gunhouseSize: [2, 2, 2], armorMm } }];
    const sim = new CombatSimulation(def); Object.assign(sim.target.motion, { x: 0, z: 0 });
    advanceProjectile({ id: 99, ownerId: 'player', position: [-2, 5, 0], velocity: [800, 0, 0], age: 0, penetrationMm: 0,
      damage: 70, caliberM: .38, visited: [], he: catalog.parts[0].he }, [sim.target], 1 / 60, () => {});
    return 100 - sim.target.mounts[0].hp;
  });
  expect(damage[0]).toBeGreaterThan(0); expect(damage[0]).toBeLessThan(50); expect(damage[1]).toBe(0);
});

test('queued ammunition preserves loaded rounds and reload progress, and can be cancelled or forced', () => {
  const def = compileShip(blueprint, catalog), mount = def.mounts[0], state = createMountState(mount);
  const pose = new CombatSimulation(def).ship, stock = state.ammo;
  queueAmmunition(mount, state, 'he');
  updateMount(mount, state, def, pose, undefined, 1);
  expect(state.loaded).toBe('ap'); expect(state.reload).toBe(0);
  queueAmmunition(mount, state, 'ap'); expect(state.queued).toBeUndefined();
  state.reload = 5;
  queueAmmunition(mount, state, 'he');
  updateMount(mount, state, def, pose, undefined, 2);
  expect(state.reload).toBe(3); expect(state.loaded).toBe('ap');
  updateMount(mount, state, def, pose, undefined, 3);
  expect(state.loaded).toBe('he'); expect(state.reload).toBe(0);
  queueAmmunition(mount, state, 'ap'); selectAmmunition(mount, state, 'ap');
  expect(state.queued).toBeUndefined(); expect(state.reload).toBe(mount.weapon.reloadSeconds);
  expect(state.ammo).toBe(stock);
});

test('queued HE fires the already loaded AP salvo first and HE after the normal reload', () => {
  const def = compileShip(blueprint, catalog);
  def.mounts = [{ ...def.mounts[0], position: [0, 10, 0], bearingDeg: 90 }]; def.obstructions = [];
  const sim = new CombatSimulation(def), state = sim.player.mounts[0], before = structuredClone(state);
  const intent = { aim: [2000, 10, 0] as Vec3, fire: true, battery: 'main' as const, ammunition: 'he' as const };
  for (let i = 0; i < 200 && state.ammo === before.ammo; i++) sim.step({ throttle: 0, rudder: 0 }, intent);
  expect(state.ammo).toBe(before.ammo - 2); expect(state.heAmmo).toBe(before.heAmmo);
  expect(sim.shellHistory.every(h => h.ammunition === 'ap')).toBe(true);
  for (let i = 0; i < 1210 && state.ammo === before.ammo - 2; i++) sim.step({ throttle: 0, rudder: 0 }, intent);
  expect(state.ammo).toBe(before.ammo - 4); expect(state.heAmmo).toBe(before.heAmmo - 2);
  expect(sim.shellHistory.filter(h => h.ammunition === 'he')).toHaveLength(2);
});
