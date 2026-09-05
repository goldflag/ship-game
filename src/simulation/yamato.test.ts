import { expect, test } from 'bun:test';
import source from '../../assets/ships/yamato/blueprint.json';
import catalog from '../../assets/parts/guns.json';
import { compileShip } from '../ships/blueprint';
import { CombatSimulation } from './combat';
import { muzzleLocal, createMountState } from './weapons';

const definition = compileShip(source, catalog);
test('Yamato has nine main guns with documented 3.50 metre adjacent bore spacing', () => {
  const main = definition.mounts.filter(m => m.battery === 'main');
  expect(main).toHaveLength(3);
  for (const m of main) {
    expect(m.weapon.barrelCount).toBe(3);
    expect(createMountState(m).ammo).toBe(300);
    const points = [0, 1, 2].map(i => muzzleLocal(m, { train: 0, elevation: 0 }, i));
    expect(Math.abs(points[0][0] - points[1][0])).toBeCloseTo(3.5, 6);
    expect(Math.abs(points[2][0] - points[1][0])).toBeCloseTo(3.5, 6);
    expect(points[1][0]).toBeCloseTo(0, 6);
  }
});
test('a trained Yamato broadside fires nine distinct shells and debits three rounds per turret', () => {
  const sim = new CombatSimulation(definition);
  const helm = { throttle: 0, rudder: 0 };
  const intent = { aim: [1800, 0, 0] as [number, number, number], fire: false, battery: 'main' as const };
  for (let i = 0; i < 7200 && sim.player.mounts.slice(0, 3).some(m => m.status !== 'ready'); i++) sim.step(helm, intent);
  expect(sim.player.mounts.slice(0, 3).map(m => m.status)).toEqual(['ready', 'ready', 'ready']);
  sim.step(helm, { ...intent, fire: true });
  const shots = sim.events.filter(e => e.kind === 'shot');
  expect(shots).toHaveLength(9);
  expect(new Set(shots.map(e => JSON.stringify(e.position))).size).toBe(9);
  expect(sim.player.mounts.slice(0, 3).map(m => m.ammo)).toEqual([297, 297, 297]);
  sim.step(helm, { ...intent, fire: true });
  expect(sim.events.filter(e => e.kind === 'shot')).toHaveLength(9);
});
test('unsupported or fractional barrel counts cannot enter a compiled ship', () => {
  for (const count of [0, -1, 2.5, 5]) {
    const modified = structuredClone(catalog);
    Object.assign(modified.parts[0], { barrelCount: count });
    expect(() => compileShip(source, modified)).toThrow(/barrelCount/);
  }
});
test('both Yamato secondary triples clear the hull on a broadside and reload together', () => {
  const sim = new CombatSimulation(definition);
  const helm = { throttle: 0, rudder: 0 };
  const intent = { aim: [1800, 0, 0] as [number, number, number], fire: false, battery: 'secondary' as const };
  const indices = definition.mounts.flatMap((m, i) => m.battery === 'secondary' ? [i] : []);
  for (let i = 0; i < 7200 && indices.some(n => sim.player.mounts[n].status !== 'ready'); i++) sim.step(helm, intent);
  expect(indices.map(n => sim.player.mounts[n].status)).toEqual(['ready', 'ready']);
  sim.step(helm, { ...intent, fire: true });
  expect(sim.events.filter(e => e.kind === 'shot')).toHaveLength(6);
  expect(indices.map(n => sim.player.mounts[n].ammo)).toEqual([447, 447]);
  expect(sim.player.mounts.slice(0, 3).map(m => m.ammo)).toEqual([300, 300, 300]);
  sim.step(helm, { ...intent, fire: true });
  expect(sim.events.filter(e => e.kind === 'shot')).toHaveLength(6);
});
