import { expect, test } from 'bun:test';
import blueprint from '../../assets/ships/bismarck/blueprint.json';
import catalog from '../../assets/parts/guns.json';
import { compileShip, type Vec3 } from '../ships/blueprint';
import { CombatSimulation } from './combat';
import { addBreach, hitShip, updateFlooding, type DamageEvent, type Shell } from './damage';
import { hullContains } from './hull';
import { localToWorld } from './geometry';

const quiet = { aim: [0, 0, -5000] as Vec3, fire: false, battery: 'main' as const };
const shell = (position: Vec3, velocity: Vec3): Shell => ({ id: 900, ownerId: 'player', position, velocity, age: 0, penetrationMm: 10000, damage: 70, caliberM: .38, visited: [] });
const fixture = () => {
  const def = compileShip(blueprint, catalog), sim = new CombatSimulation(def);
  Object.assign(sim.target.motion, { x: 0, z: 0 });
  sim.player.motion.x = -1000;
  def.compartments.forEach(c => c.pumpM3PerSecond = 0);
  return { def, sim, actor: sim.target };
};
test('sea crossing inside an unarmored hull volume continues; open sea splashes', () => {
  for (const x of [0, 40]) {
    const { sim } = fixture();
    sim.shells.push(shell([x, .01, -21], [0, -3, 0]));
    sim.step({ throttle: 0, rudder: 0 }, quiet);
    expect(sim.events.some(e => e.kind === 'splash')).toBe(x === 40);
    expect(sim.shells.length).toBe(x === 40 ? 0 : 1);
  }
});
test('fully above-water penetrations stay dry until their actual opening is submerged', () => {
  const { def, actor } = fixture();
  hitShip(shell([-30, .5, -21], [820, 0, 0]), [-30, .5, -21], [-12, .5, -21], actor, def, () => {});
  expect(actor.damage.compartments.some(c => c.breachAreaM2 > 0)).toBe(true);
  updateFlooding(actor, def, 1);
  expect(actor.damage.compartments.reduce((n, c) => n + c.waterM3, 0)).toBe(0);
  actor.motion.y = -3;
  updateFlooding(actor, def, 1);
  expect(actor.damage.compartments.reduce((n, c) => n + c.waterM3, 0)).toBeGreaterThan(0);
});
test('an opening centered on a room boundary splits its area and floods only the submerged half', () => {
  const { def, actor } = fixture(), events: DamageEvent[] = [];
  hitShip(shell([-30, 0, -21], [820, 0, 0]), [-30, 0, -21], [-12, 0, -21], actor, def, e => events.push(e));
  const split = events.find(e => e.impact?.breachAssignments?.length === 2)!.impact!.breachAssignments!;
  expect(split.reduce((n, b) => n + b.areaM2, 0)).toBeCloseTo(.38 ** 2, 9);
  updateFlooding(actor, def, 1);
  for (const opening of split) {
    const water = actor.damage.compartments.find(c => c.id === opening.compartmentId)!.waterM3;
    if (opening.position[1] < 0) expect(water).toBeGreaterThan(0); else expect(water).toBe(0);
  }
});
test('shells already underwater outside a hull cannot enter a submerged module on the next tick', () => {
  const { sim, actor } = fixture(), before = structuredClone(actor.damage);
  sim.shells.push(shell([-20, -1, -21], [1000, 0, 0]));
  sim.step({ throttle: 0, rudder: 0 }, quiet);
  expect(sim.shells).toHaveLength(0);
  expect(actor.damage.modules).toEqual(before.modules); expect(actor.damage.compartments).toEqual(before.compartments);
});
test('below-water penetrations admit water and preserve the port breach location under list', () => {
  const { def, actor } = fixture();
  hitShip(shell([-30, -2, -21], [820, 0, 0]), [-30, -2, -21], [-12, -2, -21], actor, def, () => {});
  updateFlooding(actor, def, 1);
  expect(actor.damage.compartments.reduce((n, c) => n + c.waterM3, 0)).toBeGreaterThan(0);
  expect(actor.damage.compartments.flatMap(c => c.breaches).every(b => b.position[0] < -12 && b.position[1] === -2)).toBe(true);
});
test('list uses each opening location; a high opening does not borrow a low opening depth', () => {
  const volumes = [false, true].map(addHigh => {
    const { def, actor } = fixture(), c = actor.damage.compartments[0];
    addBreach(c, [-17, .5, -21], .01, 1);
    if (addHigh) addBreach(c, [-17, 8, -21], .01, 2);
    actor.motion.roll = .1;
    expect(localToWorld(c.breaches[0].position, actor.motion)[1]).toBeLessThan(0);
    updateFlooding(actor, def, 1);
    return c.waterM3;
  });
  expect(volumes[0]).toBeGreaterThan(0);
  expect(volumes[1]).toBeCloseTo(volumes[0], 9);
});
test('hull query excludes points outside the keel, deck, ends and tapered bow', () => {
  const { def } = fixture();
  for (const point of [[0, 0, -21], [-8, -3, -21]] as Vec3[]) expect(hullContains(def.hull, point)).toBe(true);
  for (const point of [[0, -20, 0], [0, 40, 0], [0, 0, -300], [17, 0, -120]] as Vec3[]) expect(hullContains(def.hull, point)).toBe(false);
});
test('ordered hit evidence records resistance, damage, breach assignment and terminal outcome', () => {
  const { def, actor } = fixture(), events: DamageEvent[] = [];
  hitShip({ ...shell([-30, .5, -21], [820, 0, 0]), penetrationMm: 550 }, [-30, .5, -21], [30, .5, -21], actor, def, e => events.push(e));
  const impacts = events.map(e => e.impact!);
  expect(impacts[0].outcome).toBe('penetrated');
  expect(impacts[0].breachAreaM2).toBeGreaterThan(0);
  expect(impacts[0].compartmentId).toBeDefined();
  expect(impacts.at(-1)!.terminal).toBe(true);
  expect(impacts.at(-1)!.outcome).toBe('stopped');
  for (const impact of impacts) {
    expect(impact.shellId).toBe(900);
    expect(impact.shipId).toBe('target');
    expect(impact.penetrationAfterMm).toBeLessThanOrEqual(impact.penetrationBeforeMm);
    expect(impact.resistanceMm).toBeGreaterThanOrEqual(0);
  }
});
test('flooding has a stable cause and equipment loss alone does not sink a dry hull', () => {
  const { def, actor } = fixture();
  actor.damage.modules.forEach(m => m.hp = 0); actor.mounts.forEach(m => m.hp = 0);
  updateFlooding(actor, def, 1 / 60); expect(actor.damage.sunk).toBe(false);
  def.compartments.forEach((c, i) => actor.damage.compartments[i].waterM3 = c.capacityM3);
  for (let i=0;i<60;i++) updateFlooding(actor, def, 1/60);
  expect(actor.damage.sunk).toBe(true); expect(actor.damage.defeatCause).toBe('flooding');
  updateFlooding(actor, def, 1/60); expect(actor.damage.defeatCause).toBe('flooding');
});
test('small-caliber breach clusters have bounded cost and conserve opening area', () => {
  const { def, actor } = fixture(), c = actor.damage.compartments[0];
  for (let i = 0; i < 1000; i++) addBreach(c, [-17 + i % 2, .5, i % 100 - 50], .0004, i);
  expect(c.breaches.length).toBeLessThanOrEqual(64);
  expect(c.breaches.reduce((n, b) => n + b.areaM2, 0)).toBeCloseTo(.4, 9);
  expect(c.breachAreaM2).toBeCloseTo(.4, 9);
  updateFlooding(actor, def, 1);
  expect(c.waterM3).toBe(0); // A cluster of small high holes is not a huge submerged hole.
});
test('rapid fire from another owner cannot evict an in-flight player hit history', () => {
  const { sim } = fixture();
  sim.shells.push(shell([-25, .5, -21], [600, 0, 0]));
  sim.step({ throttle: 0, rudder: 0 }, quiet);
  const first = sim.shellHistory.find(h => h.shellId === 900)!;
  expect(first.impacts.length).toBeGreaterThan(0);
  for (let i = 0; i < 100; i++) sim.shells.push({ ...shell([1000, .01, i], [0, -3, 0]), id: 1000 + i, ownerId: 'enemy-1' });
  sim.step({ throttle: 0, rudder: 0 }, quiet);
  expect(sim.shellHistory.find(h => h.shellId === 900)).toBe(first);
  expect(sim.shellHistory.filter(h => h.ownerId === 'enemy-1').length).toBe(16);
  expect(first.impacts[0].targetName).toContain('Belt');
});
test('backing is diagnosed without an impact flash; a keel exit is recorded as a pass-through', () => {
  const { def, actor, sim } = fixture(), events: DamageEvent[] = [];
  hitShip(shell([-30, .5, -21], [820, 0, 0]), [-30, .5, -21], [-12, .5, -21], actor, def, e => events.push(e));
  const backing = events.find(e => e.impact?.outcome === 'backing')!;
  expect(backing).toBeDefined(); expect(backing.normal).toBeUndefined();
  sim.shells.push(shell([0, 20, -21], [0, -820, 0]));
  for (let i = 0; i < 4; i++) sim.step({ throttle: 0, rudder: 0 }, quiet);
  expect(sim.shellHistory.find(h => h.shellId === 900)?.outcome).toBe('passed-through');
  expect(sim.events.some(e => e.kind === 'splash')).toBe(false);
});
