import { expect, test } from 'bun:test';
import cleveland from '../../assets/ships/cleveland/blueprint.json';
import yamato from '../../assets/ships/yamato/blueprint.json';
import catalog from '../../assets/parts/guns.json';
// Yamato is authored with box obstructions; her retired closed-body profile is
// kept as a fixture so the encoding stays covered on real authored geometry.
import sweptClearance from '../simulation/fixtures/yamato-swept-clearance.json';
import { compileShip, type ShipBlueprint } from './blueprint';

/** What compileShip refuses in a Blender-recipe blueprint before it reaches either simulation. */
const clevelandBlueprint = () => structuredClone(cleveland) as unknown as ShipBlueprint;

test('closed-body and installation profiles compile independently and reject incomplete or mixed encodings', () => {
  expect('mountClearance' in yamato).toBe(false);
  const swept = { ...structuredClone(yamato), mountClearance: sweptClearance } as unknown as ShipBlueprint;
  const d = compileShip(swept, catalog);
  expect(d.mountClearance!.mountIds).toHaveLength(d.mounts.length);
  const c = clevelandBlueprint(), profile = c.mountClearance!;
  for (const incomplete of [
    { version: 1, marginM: .02, basis: 'test' },
    { version: 1, marginM: .02, basis: 'test', bodies: [] },
    { version: 1, marginM: .02, basis: 'test', mountIds: ['main-1'] },
    { ...profile, mounts: undefined },
    { ...profile, structures: undefined },
    { ...profile, neighbors: undefined },
    { ...profile, mountIds: ['main-1'], bodies: [] },
  ]) {
    c.mountClearance = incomplete as ShipBlueprint['mountClearance'];
    expect(() => compileShip(c, catalog)).toThrow('mountClearance');
  }
});

test('installation interlocks validate references and positive envelope dimensions', () => {
  const b = clevelandBlueprint();
  b.mountClearance!.neighbors![0] = ['main-1', 'missing'];
  expect(() => compileShip(b, catalog)).toThrow('selected mount pairs');
  b.mountClearance!.neighbors![0] = ['main-1', 'main-2'];
  b.mountClearance!.mounts![0].body!.size[1] = 0;
  expect(() => compileShip(b, catalog)).toThrow('clearance body dimension');
});

test('fitting schema rejects invalid joints and radii, and stow poses must fit installed limits', () => {
  const b = clevelandBlueprint();
  b.mounts[0].initialElevationDeg = 20;
  expect(compileShip(b, catalog).mounts[0].initialElevationDeg).toBe(20);
  b.mounts[0].initialElevationDeg = 100;
  expect(() => compileShip(b, catalog)).toThrow('initialElevationDeg');
  delete b.mounts[0].initialElevationDeg;
  const e = b.mountClearance!.mounts![0];
  e.fittings = [{ joint: 'yaw', a: [0, 1, 0], b: [0, 1, 1], radiusM: 0 }];
  expect(() => compileShip(b, catalog)).toThrow('clearance fitting radius');
  e.fittings[0].radiusM = .02;
  e.fittings[0].joint = 'unsupported' as 'yaw';
  expect(() => compileShip(b, catalog)).toThrow('clearance fitting joint');
});

test('asymmetric installed travel retains neutral and rejects limits outside the component capability', () => {
  const b = clevelandBlueprint();
  expect(compileShip(b, catalog).mounts.find(m => m.id === 'secondary-2')!.traverseLimitsDeg).toEqual([-142, 0]);
  for (const limits of [[-181, 0], [1, 90], [-90, -1], [0, 181], [0], [0, NaN]]) {
    b.mounts[4].traverseLimitsDeg = limits as [number, number];
    expect(() => compileShip(b, catalog)).toThrow();
  }
  b.mounts[4].traverseDeg = 40; b.mounts[4].traverseLimitsDeg = [-41, 0];
  expect(() => compileShip(b, catalog)).toThrow();
});

test('unsupported or fractional barrel counts cannot enter a compiled ship', () => {
  for (const count of [0, -1, 2.5, 5]) {
    const modified = structuredClone(catalog);
    Object.assign(modified.parts[0], { barrelCount: count });
    expect(() => compileShip(yamato, modified)).toThrow(/barrelCount/);
  }
});
