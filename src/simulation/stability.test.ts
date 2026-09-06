import { expect, test } from 'bun:test';
import { compileShip, type Hull, type Vec3 } from '../ships/blueprint';
import catalog from '../../assets/parts/guns.json';
import bismarck from '../../assets/ships/bismarck/blueprint.json';
import yamato from '../../assets/ships/yamato/blueprint.json';
import baltimore from '../../assets/ships/baltimore/blueprint.json';
import enterprise from '../../assets/ships/enterprise-cv6/blueprint.json';
import { hydrostatics, flotation, initialMetacenter, rightingArms } from './hydrostatics';
import { waterBody } from './floodwater';
import { CombatSimulation } from './combat';
import { hitShip, updateFlooding, type Shell } from './damage';
import { updateCapability, updateStability, waterLevel } from './stability';
import { hullContacts } from './hullContact';
const presets = [bismarck, yamato, baltimore, enterprise];
const fixture = (b: unknown = bismarck) => { const def = compileShip(b, catalog); def.compartments.forEach(c => c.pumpM3PerSecond = 0); const sim = new CombatSimulation(def); return { def, sim, a: sim.player }; };
const box: Hull = { kind: 'authored-stations-v1', length: 100, beam: 20, draft: 5, depth: 10, massKg: 10e6, waterplaneAreaM2: 2000, reserveBuoyancyM3: 10000, halfBreadths: [[0, 10], [100, 10]], keelHeights: [[0, -5], [100, -5]], deckHeights: [[0, 5], [100, 5]] };

test('station integration matches analytic rectangular displacement, centroid and metacenter', () => {
  const h = hydrostatics(box); expect(h.volume).toBeCloseTo(10000, 6); expect(h.center[1]).toBeCloseTo(-2.5, 6);
  expect(initialMetacenter(box)).toBeCloseTo(-2.5 + 100 * 20 ** 3 / 12 / 10000, 3);
  expect(flotation(box, 14000).y).toBeCloseTo(-2, 4);
  expect(flotation(box, 20001).afloat).toBe(false);
});

test('free water stays horizontal and shifts toward the low side; full spaces lose free surface', () => {
  const room = { id: 'room', name: 'Room', center: [0, 0, 0] as Vec3, size: [12, 4, 8] as Vec3, capacityM3: 384, pumpM3PerSecond: 0 };
  const port = waterBody(room, 192, .15, 0), starboard = waterBody(room, 192, -.15, 0), full = waterBody(room, 384, .15, 0);
  expect(port.center[0]).toBeLessThan(0); expect(starboard.center[0]).toBeCloseTo(-port.center[0], 6);
  expect(port.level).toBeCloseTo(0, 5); expect(full.center[0]).toBeCloseTo(0, 5);
  const bow = waterBody(room, 192, 0, -.15), stern = waterBody(room, 192, 0, .15);
  expect(bow.center[2]).toBeLessThan(0); expect(stern.center[2]).toBeCloseTo(-bow.center[2], 6);
});

for (const b of presets) test(`${b.id}: dry equilibrium, hull-derived flooding loss, and global HP cannot sink the hull`, () => {
  const { a, def } = fixture(b); a.damage.integrity = 0;
  updateFlooding(a, def, 1 / 60); expect(a.damage.sunk).toBe(false); expect(a.motion.y).toBe(0);
  expect(a.motion.roll).toBe(0); expect(a.motion.pitch).toBe(0);
  const base = hydrostatics(def.hull), f = flotation(def.hull, base.volume, .05);
  expect(rightingArms(f.center, def.stability!.dryCenterOfGravity, .05, 0).roll).toBeLessThan(0);
  def.compartments.forEach((c, i) => a.damage.compartments[i].waterM3 = c.capacityM3);
  for (let i = 0; i < 60; i++) updateFlooding(a, def, 1 / 60);
  expect(a.damage.sunk).toBe(true); expect(a.damage.defeatCause).toBe('flooding');
});

for (const b of presets) test(`${b.id}: shell and flooding coverage include both sides, deck, bottom, bow and stern`, () => {
  for (const direction of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as Vec3[]) {
    const { a, def } = fixture(b), from = direction.map(n => n * (def.hull.length + 20)) as Vec3, to: Vec3 = [0, 0, 0];
    expect(hullContacts(def.hull, from, to).length).toBeGreaterThan(0);
    const shell: Shell = { id: 1, ownerId: 'other', position: from, velocity: direction.map(n => -n * 800) as Vec3, age: 0, penetrationMm: 100000, damage: 1, caliberM: .38, visited: [] };
    hitShip(shell, from, to, a, def, () => {});
    expect(a.damage.compartments.reduce((n, c) => n + c.breachAreaM2, 0)).toBeGreaterThan(0);
  }
});

test('asymmetric water produces mirrored list; symmetric loading sinks deeper without list', () => {
  const left = fixture(), right = fixture(), symmetric = fixture();
  const li = left.def.compartments.findIndex(c => c.id === 'reserve-cell-1-0-1'), ri = right.def.compartments.findIndex(c => c.id === 'reserve-cell-1-1-1');
  const amount = Math.min(left.def.compartments[li].capacityM3, right.def.compartments[ri].capacityM3) * .8;
  left.a.damage.compartments[li].waterM3 = amount; right.a.damage.compartments[ri].waterM3 = amount;
  symmetric.a.damage.compartments[li].waterM3 = amount; symmetric.a.damage.compartments[ri].waterM3 = amount;
  for (let i = 0; i < 120; i++) for (const { a, def } of [left, right, symmetric]) updateStability(a, def, .5);
  expect(left.a.motion.roll).toBeGreaterThan(0); expect(right.a.motion.roll).toBeLessThan(0);
  expect(left.a.motion.roll).toBeCloseTo(-right.a.motion.roll, 2);
  expect(Math.abs(symmetric.a.motion.roll)).toBeLessThan(.005); expect(symmetric.a.motion.y).toBeLessThan(left.a.motion.y);
  left.a.damage.compartments[li].waterM3 = 0;
  for (let i = 0; i < 240; i++) updateStability(left.a, left.def, .5);
  expect(Math.abs(left.a.motion.roll)).toBeLessThan(.005); expect(Math.abs(left.a.motion.y)).toBeLessThan(.01);
});

test('portal levels use a common horizontal waterplane under heel and conserve water', () => {
  const { a, def } = fixture(), link = a.damage.connections[0];
  a.motion.roll = .2; a.motion.pitch = .03;
  a.damage.compartments[link.fromIndex].waterM3 = def.compartments[link.fromIndex].capacityM3 * .5;
  link.state = 'open'; updateStability(a, def, .5);
  const level = waterLevel(a, def, link.fromIndex); expect(Number.isFinite(level)).toBe(true);
  const total = a.damage.compartments.reduce((n, c) => n + c.waterM3, 0);
  for (let i = 0; i < 600; i++) updateFlooding(a, def, 1 / 60);
  expect(a.damage.compartments.reduce((n, c) => n + c.waterM3, 0)).toBeCloseTo(total, 6);
  expect(a.damage.compartments[link.toIndex].waterM3).toBeGreaterThan(0);
});

test('finite-angle capsize is separate from negative initial GM and from sinking by weight', () => {
  const { a, def } = fixture(); def.stability!.dryCenterOfGravity[1] = 30;
  a.motion.roll = .01; updateStability(a, def, .5); expect(a.damage.sunk).toBe(false);
  a.motion.roll = 2; a.damage.stability.rollRate = 0;
  for (let i = 0; i < 60; i++) updateStability(a, def, .5);
  expect(a.damage.sunk).toBe(true); expect(a.damage.defeatCause).toBe('capsize');
  expect(a.damage.stability.status).toBe('capsized');
});

test('afloat ships retain useful guns after propulsion loss; permanent gun/ammunition loss decides a battle', () => {
  const def = compileShip(bismarck, catalog), sim = new CombatSimulation(def, { friendlyBots: [], enemies: [def] }), a = sim.target;
  def.modules.forEach((m, i) => { if (m.kind === 'engine') a.damage.modules[i].hp = 0; });
  updateCapability(a, def); expect(a.damage.stability.status).toBe('immobile'); expect(a.damage.stability.combatLost).toBe(false);
  a.mounts.forEach(m => m.hp = 0);
  sim.step({ throttle: 0, rudder: 0 }, { aim: sim.aimAt(), fire: false, battery: 'main' });
  expect(a.damage.sunk).toBe(false); expect(a.damage.stability.status).toBe('disabled'); expect(sim.result).toBe('victory');
  sim.reset(); expect(sim.target.damage.stability.status).toBe('operational'); expect(sim.result).toBe('active');
});

test('compound flood spaces validate finite non-overlapping capacity', () => {
  const b = structuredClone(bismarck), room = b.compartments.find(c => 'cells' in c)!;
  const cells = (room as unknown as { cells: { center: number[]; size: number[] }[] }).cells;
  cells.push(structuredClone(cells[0]));
  expect(() => compileShip(b, catalog)).toThrow('overlap');
});
