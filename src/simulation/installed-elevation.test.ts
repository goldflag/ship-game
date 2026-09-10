import { expect, test } from 'bun:test';
import blueprint from '../../assets/ships/gleaves/blueprint.json';
import catalog from '../../assets/parts/guns.json';
import { compileShip } from '../ships/blueprint';
import { weaponGroups } from '../ships/weaponGroups';
import { weaponGroupId } from '../ships/weaponGroups';
import { createMountState, updateMount } from './weapons';

test('aiming below an installed depression stop holds the barrel and refuses a firing solution', () => {
  const definition = compileShip(blueprint, catalog);
  const mains = weaponGroups(definition).filter(g => g.battery === 'main');
  expect(mains).toHaveLength(1);
  expect(mains[0].mountIds).toEqual(['gun-1', 'gun-2', 'gun-3', 'gun-4']);
  // Isolate aiming limits from the independent hull-obstruction gate.
  definition.obstructions = [];
  const mount = definition.mounts.find(m => m.id === 'gun-2')!;
  definition.mounts = [mount];
  const state = createMountState(mount);
  const pose = { x: 0, y: 0, z: 0, heading: 0, pitch: 0, roll: 0 };
  const aim: [number, number, number] = [0, 0, mount.position[2] - 100];
  expect(updateMount(mount, state, definition, pose, aim, 10)).toBe(false);
  expect(state.elevation).toBeCloseTo(-3 * Math.PI / 180, 10);
  expect(state.status).toBe('out-of-arc');
  // The same catalog gun without the installation stop can reach this point.
  const unrestricted = { ...mount, weapon: { ...mount.weapon, elevationMinDeg: -15 } };
  const freeState = createMountState(unrestricted);
  expect(updateMount(unrestricted, freeState, definition, pose, aim, 10)).toBe(true);
  expect(freeState.elevation).toBeLessThan(state.elevation);
});

test('installed AA ceiling limits aiming without changing the catalog firing group', () => {
  const definition = compileShip(blueprint, catalog);
  const mount = definition.mounts.find(m => m.id === 'oerlikon-7')!;
  const unrestricted = { ...mount, weapon: { ...mount.weapon, elevationMaxDeg: 85 } };
  expect(weaponGroupId('secondary', mount.weapon)).toBe(weaponGroupId('secondary', unrestricted.weapon));
  definition.obstructions = [];
  definition.mounts = [mount];
  const pose = { x: 0, y: 0, z: 0, heading: 0, pitch: 0, roll: 0 };
  const bearing = mount.bearingDeg * Math.PI / 180;
  const aim: [number, number, number] = [mount.position[0] + Math.sin(bearing) * 100, 600, mount.position[2] - Math.cos(bearing) * 100];
  const state = createMountState(mount);
  expect(updateMount(mount, state, definition, pose, aim, 10)).toBe(false);
  expect(state.elevation).toBeCloseTo(78 * Math.PI / 180, 10);
  expect(state.status).toBe('out-of-arc');
  const freeState = createMountState(unrestricted);
  expect(updateMount(unrestricted, freeState, definition, pose, aim, 10)).toBe(true);
});
