import { expect, test } from 'bun:test';
import blueprint from '../../assets/ships/bismarck/blueprint.json';
import catalog from '../../assets/parts/guns.json';
import { compileShip, type ShipBlueprint } from './blueprint';

test('blueprints round-trip through JSON and compile reusable mounts without mutating the source', () => {
  const before = JSON.stringify(blueprint);
  const definition = compileShip(JSON.parse(before), catalog);
  expect(definition.mounts.length).toBe(38);
  expect(definition.mounts[0].weapon.id).toBe(definition.mounts[1].weapon.id);
  definition.mounts[0].weapon.reloadSeconds = 1;
  expect(definition.mounts[1].weapon.reloadSeconds).toBe(20);
  expect(JSON.stringify(blueprint)).toBe(before);
});
test('rejects invalid IDs, missing parts, unsupported versions, invalid numbers and disconnected modules', () => {
  const bad = (edit: (b: any) => void, message: RegExp) => {
    const b = structuredClone(blueprint); edit(b); expect(() => compileShip(b, catalog)).toThrow(message);
  };
  bad(b => b.schemaVersion = 2, /schemaVersion/);
  bad(b => b.mounts[1].id = b.mounts[0].id, /duplicate/);
  bad(b => b.mounts[0].partId = 'missing', /unknown part/);
  bad(b => b.mounts[0].position[0] = NaN, /finite/);
  bad(b => b.mounts[0].position[2] = 300, /outside/);
  bad(b => b.modules[0].compartmentId = 'missing', /compartment/);
  bad(b => b.modules[0].size[0] = 100, /fit/);
  bad(b => b.connections = [0,1].map(() => ({fromId:b.compartments[0].id,toId:b.compartments[1].id,areaM2:.1})), /duplicate/);
  bad(b => b.hull.halfBreadths[2][0] = b.hull.halfBreadths[1][0], /increasing/);
  bad(b => b.hull.keelHeights.pop(), /span/);
  bad(b => b.compartments[0].capacityM3 = 1e8, /capacity/);
  bad(b => b.modelUrl = 'https://example.com/ship.glb', /local/);
});
test('changing a mount in the blueprint changes the compiled ship without ship-specific code', () => {
  const b = structuredClone(blueprint); b.mounts[0].position[2] += 2;
  const d = compileShip(b, catalog);
  expect(d.mounts[0].position[2]).toBe(blueprint.mounts[0].position[2] + 2);
});

test('supports dense wartime gun fits while bounding mount counts', () => {
  const b = structuredClone(blueprint);
  b.mounts.push(...Array.from({ length: 128 - b.mounts.length }, (_, i) => ({ ...structuredClone(blueprint.mounts.at(-1)!), id: `mount-${i}` })));
  expect(compileShip(b, catalog).mounts).toHaveLength(128);
  b.mounts.push({ ...structuredClone(blueprint.mounts[0]), id: 'mount-overflow' });
  expect(() => compileShip(b, catalog)).toThrow(/at most 128/);
});

test('catalog supports fixed barrels and near-vertical elevation while rejecting impossible values', () => {
  const parts = structuredClone(catalog);
  const weapon = parts.parts.find(p => p.id === blueprint.mounts[0].partId)!;
  weapon.recoilM = 0;
  weapon.elevationMaxDeg = 87;
  const compiled = compileShip(blueprint, parts).mounts[0].weapon;
  expect(compiled.recoilM).toBe(0);
  expect(compiled.elevationMaxDeg).toBe(87);
  weapon.recoilM = -.001;
  expect(() => compileShip(blueprint, parts)).toThrow(/recoilM/);
  weapon.recoilM = 0;
  weapon.elevationMaxDeg = 90.01;
  expect(() => compileShip(blueprint, parts)).toThrow(/elevationMaxDeg/);
});

test('installed depression stops narrow one mount without changing its neighbors or catalog', () => {
  const b = structuredClone(blueprint) as ShipBlueprint;
  const part = catalog.parts.find(p => p.id === b.mounts[0].partId)!;
  const originalMin = part.elevationMinDeg;
  const installedMin = originalMin / 2;
  b.mounts[0].elevationMinDeg = installedMin;
  const d = compileShip(b, catalog);
  expect(d.mounts[0].weapon.elevationMinDeg).toBe(installedMin);
  expect(d.mounts[1].weapon.elevationMinDeg).toBe(originalMin);
  expect(part.elevationMinDeg).toBe(originalMin);
  for (const invalid of [originalMin - .01, .01, NaN]) {
    b.mounts[0].elevationMinDeg = invalid;
    expect(() => compileShip(b, catalog)).toThrow(/elevationMinDeg/);
  }
});

test('installed elevation ceilings preserve catalog capability and reject widening', () => {
  const b = structuredClone(blueprint) as ShipBlueprint;
  const part = catalog.parts.find(p => p.id === b.mounts[0].partId)!;
  b.mounts[0].elevationMaxDeg = 20;
  const d = compileShip(b, catalog);
  expect(d.mounts[0].weapon.elevationMaxDeg).toBe(20);
  expect(d.mounts[0].weapon.catalogElevationMaxDeg).toBe(part.elevationMaxDeg);
  expect(d.mounts[1].weapon.elevationMaxDeg).toBe(part.elevationMaxDeg);
  for (const invalid of [-.01, part.elevationMaxDeg + .01, NaN]) {
    b.mounts[0].elevationMaxDeg = invalid;
    expect(() => compileShip(b, catalog)).toThrow(/elevationMaxDeg/);
  }
});
