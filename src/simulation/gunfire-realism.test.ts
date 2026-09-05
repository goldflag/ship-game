import { expect, test } from 'bun:test';
import blueprint from '../../assets/ships/bismarck/blueprint.json';
import catalog from '../../assets/parts/guns.json';
import { compileShip, type Vec3 } from '../ships/blueprint';
import { CombatSimulation } from './combat';
import { hitShip, type DamageEvent, type Shell } from './damage';
import { add, normalize, scale, sub } from './geometry';
import { plateHit, protectionTrace, segmentPlate } from './protection';
import { solveBallistic } from './weapons';

test('large AP can tear a thin plate at a shallow angle; thick armor deflects and low budgets still stop', () => {
  for (const [thickness, budget, outcome] of [[20, 550, 'penetrated'], [80, 550, 'ricochet'], [20, 100, 'stopped']] as const) {
    const def = compileShip(blueprint, catalog);
    def.armor = [{ id: 'fixture', name: 'Fixture plate', center: [0, 0, 0], size: [.001, 40, 40], thicknessMm: thickness,
      plate: { vertices: [[0, -20, -20], [0, 20, -20], [0, 20, 20], [0, -20, 20]], material: 'steel' } }];
    def.modules = []; def.mounts = []; def.connections = [];
    const actor = new CombatSimulation(def).player, events: DamageEvent[] = [];
    const from: Vec3 = [-1, 0, -10], to: Vec3 = [1, 0, 10];
    const shell: Shell = { id: 1, ownerId: 'target', position: from, velocity: scale(normalize(sub(to, from)), 820), age: 0, penetrationMm: budget, damage: 70, caliberM: .38, visited: [] };
    hitShip(shell, from, to, actor, def, e => events.push(e));
    expect(events[0].impact!.outcome).toBe(outcome);
    const trace = protectionTrace(from, to, def, [], .38)[0];
    expect(trace.resistanceMm).toBeCloseTo(events[0].impact!.resistanceMm!, 9);
    expect(trace.ricochet).toBe(outcome === 'ricochet');
  }
});

test('the same shell penetrates nearby protection but is stopped after losing speed at long range', () => {
  const results = [1000, 20000].map(range => {
    const def = compileShip(blueprint, catalog);
    def.armor = [{ id: 'range-plate', name: 'Range plate', center: [0, 0, 0], size: [.001, 40, 40], thicknessMm: 420,
      plate: { vertices: [[0, -20, -20], [0, 20, -20], [0, 20, 20], [0, -20, 20]], material: 'KC' } }];
    def.modules = []; def.mounts = []; def.connections = []; def.compartments = []; def.propulsion = undefined;
    const sim = new CombatSimulation(def), from: Vec3 = [0, 10, 0], aim: Vec3 = [range, 3, 0];
    Object.assign(sim.target.motion, { x: range, y: 0, z: 0, heading: 0 });
    const solution = solveBallistic(from, aim, 820, .0178)!;
    sim.shells.push({ id: 900, ownerId: 'player', position: from, velocity: scale(solution.direction, 820), age: 0, penetrationMm: 550, damage: 70, caliberM: .38, visited: [], dragPerSecond: .0178 });
    for (let i = 0; i < 10000 && !sim.events.some(e => e.impact); i++) sim.step({ throttle: 0, rudder: 0 }, { aim, fire: false, battery: 'main' });
    return sim.events.find(e => e.impact)!.impact!;
  });
  expect(results[0].outcome).toBe('penetrated'); expect(results[1].outcome).toBe('stopped');
  expect(results[0].impactSpeedMps!).toBeGreaterThan(790); expect(results[1].impactSpeedMps!).toBeLessThan(480);
  expect(results[1].penetrationBeforeMm).toBeLessThan(results[0].penetrationBeforeMm);
});

test('material resistance changes a marginal result while thin-sheet resistance remains bounded', () => {
  for (const [material, budget, outcome] of [['KC', 105, 'stopped'], ['Wh', 105, 'penetrated'], ['Ww', 95, 'penetrated'], ['steel', 95, 'stopped']] as const) {
    const def = compileShip(blueprint, catalog);
    def.armor = [{ id: 'material-plate', name: 'Material fixture', center: [0, 0, 0], size: [.001, 40, 40], thicknessMm: 100,
      plate: { vertices: [[0, -20, -20], [0, 20, -20], [0, 20, 20], [0, -20, 20]], material } }];
    def.modules = []; def.mounts = []; def.connections = [];
    const actor = new CombatSimulation(def).player, events: DamageEvent[] = [];
    hitShip({ id: 1, ownerId: 'target', position: [-10, 2, 0], velocity: [820, 0, 0], age: 0, penetrationMm: budget, damage: 70, caliberM: .38, visited: [] }, [-10, 2, 0], [10, 2, 0], actor, def, e => events.push(e));
    expect(events[0].impact!.outcome).toBe(outcome);
    expect(protectionTrace([-10, 2, 0], [10, 2, 0], def, [], .38)[0].resistanceMm).toBe(events[0].impact!.resistanceMm!);
  }
  const def = compileShip(blueprint, catalog);
  def.armor = [{ id: 'thin', name: 'Thin sheet', center: [0, 0, 0], size: [.001, 40, 40], thicknessMm: 12,
    plate: { vertices: [[0, -20, -20], [0, 20, -20], [0, 20, 20], [0, -20, 20]], material: 'steel' } }];
  const hit = protectionTrace([-1, 0, -19], [1, 0, 19], def, [], .38)[0];
  expect(hit.ricochet).toBe(false); expect(hit.resistanceMm).toBe(120);
});

test('plate broad phase retains exact hull face and edge intersections', () => {
  const def = compileShip(blueprint, catalog);
  for (const a of def.armor.filter(a => a.plate && !a.plate.mountId)) {
    const vertices = a.plate!.vertices;
    const centre = vertices.reduce((n, v) => add(n, scale(v, 1 / vertices.length)), [0, 0, 0] as Vec3);
    const u = sub(vertices[1], vertices[0]), v = sub(vertices[2], vertices[0]);
    const normal = normalize([u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]);
    for (const point of [centre, vertices[0]]) {
      const from = add(point, scale(normal, 3)), to = add(point, scale(normal, -3));
      expect(plateHit(from, to, a, def, [])).toEqual(segmentPlate(from, to, vertices));
    }
  }
});
