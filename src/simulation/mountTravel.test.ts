import { expect, test } from 'bun:test';
import blueprint from '../../assets/ships/cleveland/blueprint.json';
import catalog from '../../assets/parts/guns.json';
import { compileShip, type ShipBlueprint, type Vec3 } from '../ships/blueprint';
import { gunTraverseAtFraction } from '../ships/armament';
import { shipStatistics } from '../ships/statistics';
import { createMountState, updateMount } from './weapons';

const fixture = () => {
  const def = compileShip(blueprint, catalog), mount = def.mounts.find(m => m.id === 'secondary-2')!;
  mount.position = [0, 10, 0];
  def.mounts = [mount]; def.obstructions = [];
  return { def, mount, state: createMountState(mount), pose: { x: 0, y: 0, z: 0, heading: 0, pitch: 0, roll: 0 } };
};
const aimAt = (degrees: number): Vec3 => [1000 * Math.sin(degrees * Math.PI / 180), 12, -1000 * Math.cos(degrees * Math.PI / 180)];

test('asymmetric installed travel retains neutral and rejects limits outside the component capability', () => {
  const b = structuredClone(blueprint) as unknown as ShipBlueprint;
  expect(compileShip(b, catalog).mounts.find(m => m.id === 'secondary-2')!.traverseLimitsDeg).toEqual([-142, 0]);
  for (const limits of [[-181, 0], [1, 90], [-90, -1], [0, 181], [0], [0, NaN]]) {
    b.mounts[4].traverseLimitsDeg = limits as [number, number];
    expect(() => compileShip(b, catalog)).toThrow();
  }
  b.mounts[4].traverseDeg = 40; b.mounts[4].traverseLimitsDeg = [-41, 0];
  expect(() => compileShip(b, catalog)).toThrow();
});

test('a port wing gun tracks outward but stops at neutral for an inboard target', () => {
  const { def, mount, state, pose } = fixture();
  for (let i = 0; i < 300; i++) {
    updateMount(mount, state, def, pose, aimAt(-90), .1);
    expect(state.train).toBeGreaterThanOrEqual(-142 * Math.PI / 180);
    expect(state.train).toBeLessThanOrEqual(0);
  }
  expect(state.train).toBeCloseTo(-Math.PI / 2, 2);
  expect(state.status).toBe('ready');
  for (let i = 0; i < 300; i++) updateMount(mount, state, def, pose, aimAt(45), .1);
  expect(state.train).toBe(0);
  expect(state.status).toBe('out-of-arc');
  expect(gunTraverseAtFraction(mount, -1)).toBe(-142 * Math.PI / 180);
  expect(gunTraverseAtFraction(mount, 1)).toBe(0);
  expect(shipStatistics(def).flatMap(s => s.rows).some(r => r.label === 'Traverse' && r.value.startsWith('-142° to 0°'))).toBe(true);
});

test('opposite target bearings train through the permitted interval instead of crossing the rear stop', () => {
  const { def, mount, state, pose } = fixture();
  mount.traverseLimitsDeg = [-160, 160]; state.train = 150 * Math.PI / 180;
  updateMount(mount, state, def, pose, aimAt(-150), .1);
  expect(state.train).toBeLessThan(150 * Math.PI / 180);
  expect(state.train).toBeGreaterThan(140 * Math.PI / 180);
  for (let i = 0; i < 600; i++) {
    updateMount(mount, state, def, pose, aimAt(-150), .1);
    expect(Math.abs(state.train)).toBeLessThanOrEqual(160 * Math.PI / 180);
  }
  expect(state.train).toBeCloseTo(-150 * Math.PI / 180, 2);
});
