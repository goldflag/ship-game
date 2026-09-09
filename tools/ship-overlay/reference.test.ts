import { expect, test } from 'bun:test';
import { Matrix4, Vector3 } from 'three';
import { assembleReference, defaultComponents, embeddedJson, vehicleId, type Scheme } from './reference';

test('source identifiers are restricted to GameModels3D WoWS pages', () => {
  expect(vehicleId('pgsb708')).toBe('pgsb708');
  expect(vehicleId('https://gamemodels3d.com/en/games/worldofwarships/vehicles/pgsb708')).toBe('pgsb708');
  for (const input of ['../../secret', 'https://example.com/en/games/worldofwarships/vehicles/pgsb708', 'https://gamemodels3d.com/games/worldoftanks/vehicles/tank', 'http://gamemodels3d.com/en/games/worldofwarships/vehicles/pgsb708']) expect(() => vehicleId(input)).toThrow();
});
test('embedded model JSON is parsed as data, including braces and escaped quotes in strings', () => {
  const data = { name: 'ship } "sample"', visual: { default: { A_Hull: [] } } };
  expect(embeddedJson(`prefix scheme : ${JSON.stringify(data)}, after: runCode()`, /scheme\s*:\s*/)).toEqual(data);
  expect(() => embeddedJson('sign in', /scheme\s*:\s*/)).toThrow();
  expect(() => embeddedJson('scheme : {"a": [', /scheme\s*:\s*/)).toThrow();
});
test('reference assembly preserves nested mount transforms without applying competing hulls', () => {
  const matrix = new Matrix4().makeTranslation(2, 3, 4).elements;
  const rows = Array.from({ length: 4 }, (_, i) => matrix.slice(i * 4, i * 4 + 4));
  const scheme: Scheme = {
    A_Hull: { hull: { visual: 'hull-a', nodes: { mount: { transform: { matrix: rows }, visual: 'unfitted' } } } },
    B_Hull: { hull: { visual: 'hull-b' } },
    A_Artillery: { mount: { visual: 'gun-a', transform: { matrix: [[9, 9, 9, 9]], rotation: [[0, 0, -1, 0], [0, 1, 0, 0], [1, 0, 0, 0], [0, 0, 0, 1]] } } },
    B_Artillery: { mount: { visual: 'gun-b' } },
  };
  const original = structuredClone(scheme);
  expect(defaultComponents(scheme)).toEqual(['A_Artillery']);
  expect(defaultComponents(scheme, 'B_Hull')).toEqual(['B_Artillery']);
  const result = assembleReference(scheme, 'A_Hull', ['A_Artillery', 'B_Hull']);
  const hull = (result.nodes as any).hull, mount = hull.nodes.mount;
  expect(hull.visual).toBe('hull-a'); expect(mount.visual).toBe('gun-a');
  const transformed = new Vector3(1, 0, 0).applyMatrix4(new Matrix4().fromArray(mount.transform.matrix.flat()));
  expect(transformed.toArray()).toEqual([2, 3, 3]);
  expect(scheme).toEqual(original);
  expect(() => assembleReference(scheme, 'unknown', [])).toThrow();
});

test('dated hull variants retain common AB1 equipment and default fittings without a competing hull', () => {
  const scheme: Scheme = {
    A_Hull_1943: { hull: { visual: 'hull-a', nodes: { gun: {}, director: {}, launcher: {} } } },
    B_Hull_1943: { hull: { visual: 'hull-b' } },
    AB1_127_50: { gun: { visual: 'type-c' } },
    AB1_Torpedoes: { launcher: { visual: 'stock-triple' } },
    AB2_Torpedoes: { launcher: { visual: 'upgraded-triple' } },
    DirectorsDefault: { director: { visual: 'director' } },
    A_AirDefense: {}, B_AirDefense: {},
  };
  const selected = defaultComponents(scheme, 'A_Hull_1943');
  expect(selected).toEqual(['AB1_127_50', 'AB1_Torpedoes', 'A_AirDefense', 'DirectorsDefault']);
  const result = assembleReference(scheme, 'A_Hull_1943', [...selected, 'B_Hull_1943']);
  expect((result.nodes as any).hull).toEqual({ visual: 'hull-a', nodes: {
    gun: { visual: 'type-c' }, director: { visual: 'director' }, launcher: { visual: 'stock-triple' },
  } });
});
