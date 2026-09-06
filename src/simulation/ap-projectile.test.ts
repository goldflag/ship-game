import { expect, test } from 'bun:test';
import blueprint from '../../assets/ships/bismarck/blueprint.json';
import yamato from '../../assets/ships/yamato/blueprint.json';
import baltimore from '../../assets/ships/baltimore/blueprint.json';
import enterprise from '../../assets/ships/enterprise-cv6/blueprint.json';
import catalog from '../../assets/parts/guns.json';
import { compileShip, type Armor, type Vec3 } from '../ships/blueprint';
import { CombatSimulation } from './combat';
import { burstShell } from './burst';
import { hitShip, nearbyContacts, shipContacts, type DamageEvent, type Shell } from './damage';
import { localToWorld } from './geometry';
import { advanceProjectile } from './projectile';

const plate = (id: string, x: number, thicknessMm: number): Armor => ({ id, name: id, center: [x, 5, 0], size: [.001, 10, 40], thicknessMm,
  plate: { vertices: [[x, 0, -20], [x, 10, -20], [x, 10, 20], [x, 0, 20]], material: 'steel' } });
const round = (overrides: Partial<Shell> = {}): Shell => ({ id: 999, ownerId: 'player', position: [-1, 5, 0], velocity: [1000, 0, 0], age: 0,
  penetrationMm: 1000, damage: 100, caliberM: .38, visited: [],
  ap: { armingResistanceMm: 60, fuzeDelaySeconds: .035, explosiveKg: 20, fragmentPenetrationMm: 30, basis: 'Controlled test' }, ...overrides });
function fixture(armor: Armor[], moduleX?: number) {
  const def = compileShip(blueprint, catalog);
  def.armor = armor; def.mounts = []; def.connections = []; delete def.propulsion; delete def.structuralPlating; delete def.stability;
  def.modules = moduleX === undefined ? [] : [{ ...def.modules[0], id: 'fixture-engine', kind: 'engine', hp: 100,
    center: [moduleX, 5, 0], size: [1, 1, 1] }];
  const sim = new CombatSimulation(def); Object.assign(sim.target.motion, { x: 0, z: 0 });
  sim.player.motion.x = -1000;
  return { def, sim, actor: sim.target };
}
test('thin-plating through-shots slow down without arming AP', () => {
  const { actor } = fixture([plate('entry', 0, 5), plate('exit', 2, 5)]), shell = round(), events: DamageEvent[] = [];
  advanceProjectile(shell, [actor], 1 / 60, e => { if (e.kind !== 'splash') events.push(e); });
  expect(events).toHaveLength(2);
  expect(shell.detonateAtAge).toBeUndefined(); expect(shell.velocity[0]).toBeLessThan(1000);
  expect(events.every(e => e.impact?.fuze === 'unarmed')).toBe(true);
  expect(shell.position[0]).toBeGreaterThan(2);
});
test('armor speed loss changes the remaining travel in the same tick', () => {
  const { actor } = fixture([plate('plate', 0, 500)]), shell = round({ ap: undefined });
  advanceProjectile(shell, [actor], 1 / 60, () => {});
  const speed = 1000 * .5 ** (1 / 1.4);
  expect(shell.velocity[0]).toBeCloseTo(speed, 4);
  expect(shell.position[0]).toBeCloseTo(speed * (1 / 60 - .001), 4);
  expect(shell.age).toBeCloseTo(1 / 60, 10);
});
test('a delay can expire inside the ship after contact and damage local equipment', () => {
  const { actor } = fixture([plate('arming', 0, 100)], 3), shell = round();
  shell.ap!.fuzeDelaySeconds = .005;
  const events: DamageEvent[] = [];
  expect(advanceProjectile(shell, [actor], 1 / 60, e => { if (e.kind !== 'splash') events.push(e); })).toBe('burst');
  expect(shell.age).toBeCloseTo(.006, 6);
  expect(shell.position[0]).toBeGreaterThan(3); expect(shell.position[0]).toBeLessThan(5);
  expect(events.some(e => e.kind === 'burst' && e.impact?.targetId === 'fixture-engine')).toBe(true);
  expect(actor.damage.modules[0].hp).toBeLessThan(25); // burst adds to contact's 75 damage
  // Entry, equipment and delayed burst share one hull-damage ceiling.
  expect(actor.damage.maxIntegrity - actor.damage.integrity).toBe(85);
  expect(events.reduce((n, e) => n + (e.impact?.hullDamage ?? 0), 0)).toBe(85);
  expect(events.at(-1)!.impact?.terminal).toBe(true);
});
test('an armed stop remains attached to the moving hull until its fuze expires', () => {
  const { actor } = fixture([plate('stop', 0, 150)]), shell = round({ penetrationMm: 100 });
  expect(advanceProjectile(shell, [actor], 1 / 60, () => {})).toBeUndefined();
  expect(shell.lodged?.shipId).toBe('target'); expect(shell.velocity).toEqual([0, 0, 0]);
  actor.motion.x = 10;
  expect(advanceProjectile(shell, [actor], 1 / 60, () => {})).toBeUndefined();
  expect(shell.position[0]).toBeCloseTo(10, 3);
  expect(advanceProjectile(shell, [actor], 1 / 60, () => {})).toBe('burst');
  expect(shell.age).toBeCloseTo(.036, 6);
});
test('a long delay can carry an armed shell outside the hull before it bursts', () => {
  const { sim, actor } = fixture([plate('arming', 0, 100)]), shell = round();
  sim.shells.push(shell);
  const quiet = { aim: [0, 0, -5000] as Vec3, fire: false, battery: 'main' as const };
  for (let i = 0; i < 3; i++) sim.step({ throttle: 0, rudder: 0 }, quiet);
  expect(shell.position[0]).toBeGreaterThan(actor.definition.hull.beam / 2);
  expect(sim.shells).toHaveLength(0);
  const history = sim.telemetry('main', quiet.aim).shellHistory[0];
  expect(history.outcome).toBe('burst'); expect(history.impacts.at(-1)!.kind).toBe('burst');
});
test('turret entry and exit both resist a shell, while equipment is damaged only once', () => {
  const { def } = fixture([], 5);
  const original = compileShip(blueprint, catalog).mounts[0];
  def.mounts = [{ ...original, id: 'fixture-mount', position: [0, 4, 0], bearingDeg: 0,
    weapon: { ...original.weapon, armorMm: 100, gunhouseSize: [2, 2, 2] } }];
  const sim = new CombatSimulation(def), actor = sim.player, shell = round({ ownerId: 'target', position: [-3, 5, 0] });
  const before = actor.mounts[0].hp, events: DamageEvent[] = [];
  hitShip(shell, shell.position, [8, 5, 0], actor, def, e => events.push(e));
  expect(events.filter(e => e.impact?.kind === 'mount')).toHaveLength(2);
  expect(actor.mounts[0].hp).toBe(before - 75); expect(actor.damage.modules[0].hp).toBe(100);
  expect(shell.penetrationMm).toBe(750);
});
test('intervening armor blocks blast and fragments; thin steel permits reduced fragment damage', () => {
  const damage = [0, 5, 100].map(thickness => {
    const { actor } = fixture(thickness ? [plate('shield', 0, thickness)] : [], 2);
    burstShell(round(), [actor], () => {});
    return 100 - actor.damage.modules[0].hp;
  });
  expect(damage[0]).toBeGreaterThan(damage[1]); expect(damage[1]).toBeGreaterThan(0); expect(damage[2]).toBe(0);
});
test('a stopped shell bursts against armor without transmitting damage through that armor', () => {
  const { actor } = fixture([plate('stop', 0, 200)], 2), shell = round({ penetrationMm: 100 });
  for (let i = 0; i < 3; i++) advanceProjectile(shell, [actor], 1 / 60, () => {});
  expect(actor.damage.modules[0].hp).toBe(100);
  expect(actor.damage.integrity).toBe(actor.damage.maxIntegrity);
});
test('a stopped AP burst damages equipment on the incoming side of its stopping plate', () => {
  const { actor } = fixture([plate('stop', 0, 200)], -2), shell = round({ penetrationMm: 100 });
  const events: DamageEvent[] = [];
  for (let i = 0; i < 3; i++) advanceProjectile(shell, [actor], 1 / 60, e => { if (e.kind !== 'splash') events.push(e); });
  expect(events.some(e => e.kind === 'module')).toBe(false); // The shell starts beyond the equipment.
  expect(events.some(e => e.kind === 'burst' && e.impact?.targetId === 'fixture-engine')).toBe(true);
  expect(actor.damage.modules[0].hp).toBeLessThan(50);
});
test('another ship can shield nearby equipment from a burst', () => {
  const { actor } = fixture([], 2), { actor: shield } = fixture([plate('neighbor-armor', 0, 100)]);
  shield.motion.id = 'neighbor';
  burstShell(round(), [shield, actor], () => {});
  expect(actor.damage.modules[0].hp).toBe(100);
});
test('AP catalog profiles are validated and legacy inert parts remain supported', () => {
  const modified = structuredClone(catalog);
  const gun = modified.parts[0];
  gun.ap!.fuzeDelaySeconds = 0;
  expect(() => compileShip(blueprint, modified)).toThrow();
  delete (gun as { ap?: unknown }).ap;
  expect(() => compileShip(blueprint, modified)).not.toThrow();
});
test('burst candidate filtering preserves complete ray contacts across all presets and articulated poses', () => {
  for (const source of [blueprint, yamato, baltimore, enterprise]) {
    const def = compileShip(source, catalog), actor = new CombatSimulation(def).target;
    Object.assign(actor.motion, { x: 73, z: -91, heading: .7, roll: .13, pitch: -.04 });
    actor.mounts.forEach(m => m.train = .63);
    const origins = [...def.modules.map(m => m.center), ...def.mounts.map(m => [m.position[0], m.position[1] + 2, m.position[2]] as Vec3)];
    for (let i = 0; i < 80; i++) {
      const p = origins[i % origins.length], from = localToWorld(p, actor.motion);
      const to = localToWorld([p[0] + Math.sin(i * .73) * 4, p[1] + Math.cos(i * 1.1) * 4, p[2] + Math.sin(i * .29) * 4], actor.motion);
      const candidates = nearbyContacts(from, 7, actor, def), shell = round();
      expect(shipContacts(shell, from, to, actor, def, candidates)).toEqual(shipContacts(shell, from, to, actor, def));
    }
  }
});
