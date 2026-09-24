import { expect, test } from 'bun:test';
import source from '../../assets/ships/yamato/blueprint.json';
import catalog from '../../assets/parts/guns.json';
import { compileShip } from '../ships/blueprint';
import { CombatSimulation } from './combat';
import { muzzleLocal, createMountState } from './weapons';

const definition = compileShip(source, catalog);
test('Yamato has nine main guns at the reference model\'s 3.05 metre adjacent bore spacing', () => {
  const main = definition.mounts.filter(m => m.battery === 'main');
  expect(main).toHaveLength(3);
  for (const m of main) {
    expect(m.weapon.barrelCount).toBe(3);
    expect(createMountState(m).ammo).toBe(300);
    const points = [0, 1, 2].map(i => muzzleLocal(m, { train: 0, elevation: 0 }, i));
    expect(Math.abs(points[0][0] - points[1][0])).toBeCloseTo(3.05, 6);
    expect(Math.abs(points[2][0] - points[1][0])).toBeCloseTo(3.05, 6);
    expect(points[1][0]).toBeCloseTo(0, 6);
  }
});
test('unsupported or fractional barrel counts cannot enter a compiled ship', () => {
  for (const count of [0, -1, 2.5, 5]) {
    const modified = structuredClone(catalog);
    Object.assign(modified.parts[0], { barrelCount: count });
    expect(() => compileShip(source, modified)).toThrow(/barrelCount/);
  }
});
