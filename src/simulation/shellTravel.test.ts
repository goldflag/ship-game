import { expect, test } from 'bun:test';
import { shipPreset } from '../ships/presets';
import { CombatSimulation } from './combat';
import { advanceProjectile } from './projectile';
import { resolveShipContact, type Shell } from './damage';
import { length } from './geometry';

const shell = (extra: Partial<Shell> = {}): Shell => ({ id: 900, ownerId: 'player', position: [0, 1, 0], velocity: [500, -40, 0], age: 0, penetrationMm: 500, damage: 70, caliberM: .38, visited: [], ...extra });
test('a grazing plate hit reflects a live projectile, loses energy, and retains an armed fuze', () => {
  const sim = new CombatSimulation(shipPreset('bismarck'));
  const a = sim.target; Object.assign(a.motion, { x: 0, z: 0 });
  a.definition = structuredClone(a.definition);
  a.definition.armor = [{ id: 'plate', name: 'Plate', center: [0, 5, 0], size: [.01, 20, 20], thicknessMm: 300 }];
  const round = shell({ position: [0, 5, 0], velocity: [50, 0, 500], detonateAtAge: .1 });
  const stopped = resolveShipContact(round, { kind: 'armor', index: 0, key: 'enemy:plate', t: 0, point: [0, 5, 0], normal: [-1, 0, 0] }, a, a.definition, () => {});
  expect(stopped).toBe(false);
  expect(round.velocity[0]).toBeLessThan(0);
  expect(round.velocity[2]).toBeGreaterThan(0);
  expect(length(round.velocity)).toBeLessThan(Math.hypot(50, 500));
  expect(round.penetrationMm).toBeGreaterThan(0);
  expect(round.lodged).toBeUndefined();
  expect(round.detonateAtAge).toBe(.1);
});

test('water entry continues underwater, loses penetration, and expires after a short run', () => {
  const round = shell(), events: string[] = [];
  expect(advanceProjectile(round, [], .1, e => events.push(e.kind))).toBeUndefined();
  expect(round.position[1]).toBeLessThan(0);
  expect(round.penetrationMm).toBeLessThan(500);
  expect(events).toEqual(['splash']);
  let end;
  for (let i = 0; i < 300 && !end; i++) end = advanceProjectile(round, [], 1 / 60, () => {});
  expect(end).toBeDefined();
  expect(round.position[0]).toBeLessThan(70);
});

test('air/water transition gives the same result when subdivided into ticks', () => {
  const a = shell(), b = structuredClone(a);
  advanceProjectile(a, [], .1, () => {});
  for (let i = 0; i < 6; i++) advanceProjectile(b, [], 1 / 60, () => {});
  a.position.forEach((v, i) => expect(v).toBeCloseTo(b.position[i], 5));
  a.velocity.forEach((v, i) => expect(v).toBeCloseTo(b.velocity[i], 5));
});

test('a short underwater run can strike the actual hull and open a flooding breach', () => {
  const sim = new CombatSimulation(shipPreset('bismarck'));
  Object.assign(sim.target.motion, { x: 40, z: 0 });
  const round = shell({ penetrationMm: 3000 }), events: string[] = [];
  for (let i = 0; i < 30; i++) {
    const end = advanceProjectile(round, [sim.target], 1 / 60, e => events.push(e.kind));
    if (end) break;
  }
  expect(events).toContain('splash');
  expect(events).toContain('penetration');
  expect(sim.target.damage.compartments.some(c => c.breachAreaM2 > 0)).toBe(true);
});


test('a spent underwater shell retains an armed fuze until it bursts', () => {
  const round = shell({ position: [0, -2, 0], velocity: [10, -2, 0], age: .1, detonateAtAge: .2,
    ap: { explosiveKg: 18, fragmentPenetrationMm: 30, fuzeDelaySeconds: .1, armingResistanceMm: 20, basis: "Synthetic fuze fixture" } });
  const events: string[] = [];
  expect(advanceProjectile(round, [], .15, e => events.push(e.kind))).toBe('burst');
  expect(events).toContain('burst');
  expect(round.age).toBeCloseTo(.2, 9);
});

test('a reflected underwater shell can leave the water without paying a second entry loss', () => {
  const a = shell({ position: [0, -.1, 0], velocity: [100, 30, 0], waterDragPerSecond: 3 }), b = structuredClone(a);
  advanceProjectile(a, [], .03, () => {});
  for (let i = 0; i < 3; i++) advanceProjectile(b, [], .01, () => {});
  expect(a.position[1]).toBeGreaterThan(0);
  a.position.forEach((v, i) => expect(v).toBeCloseTo(b.position[i], 5));
  a.velocity.forEach((v, i) => expect(v).toBeCloseTo(b.velocity[i], 5));
  expect(a.waterDragPerSecond).toBeUndefined();
});
