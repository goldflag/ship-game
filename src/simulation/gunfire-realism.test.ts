import { expect, test } from 'bun:test';
import blueprint from '../../assets/ships/bismarck/blueprint.json';
import catalog from '../../assets/parts/guns.json';
import { compileShip, type Vec3 } from '../ships/blueprint';
import { CombatSimulation } from './combat';
import { hitShip, type DamageEvent, type Shell } from './damage';
import { add, normalize, scale, sub } from './geometry';
import { plateHit, protectionTrace, segmentPlate } from './protection';

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
