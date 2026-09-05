import { expect, test } from 'bun:test';
import blueprint from '../../assets/ships/bismarck/blueprint.json';
import catalog from '../../assets/parts/guns.json';
import { compileShip } from './blueprint';

test('blueprints round-trip through JSON and compile reusable mounts without mutating the source', () => {
  const before = JSON.stringify(blueprint);
  const definition = compileShip(JSON.parse(before), catalog);
  expect(definition.mounts.length).toBe(10);
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
  bad(b => b.connections.push(b.connections[0]), /duplicate/);
  bad(b => b.hull.halfBreadths[2][0] = 1, /increasing/);
  bad(b => b.hull.keelHeights.pop(), /span/);
  bad(b => b.compartments[0].capacityM3 = 1e8, /capacity/);
  bad(b => b.modelUrl = 'https://example.com/ship.glb', /local/);
});
test('changing a mount in the blueprint changes the compiled ship without ship-specific code', () => {
  const b = structuredClone(blueprint); b.mounts[0].position[2] += 2;
  const d = compileShip(b, catalog);
  expect(d.mounts[0].position[2]).toBe(blueprint.mounts[0].position[2] + 2);
});
