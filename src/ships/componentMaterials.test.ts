import { expect, test } from 'bun:test';
import definition from '../../assets/parts/materials.json';
import { componentMaterial, followsComponentPaint, validateComponentMaterials } from './componentMaterials';

test('published material roles are explicit, and unsupported metadata fails closed', () => {
  const materials = Object.keys(definition.roles).map(role => ({ name: role, extras: componentMaterial(role as keyof typeof definition.roles).userData }));
  expect(() => validateComponentMaterials(materials)).not.toThrow();
  expect(() => validateComponentMaterials([{ name: 'naval' }])).toThrow('material role');
  expect(() => validateComponentMaterials([{ name: 'glass', extras: { ...componentMaterial('glass').userData, componentPaint: 'component' } }])).toThrow('material role');
  expect(followsComponentPaint('naval', { componentMaterialVersion: 99, componentPaint: 'component', componentMaterialRole: 'naval' })).toBe(false);
  expect(followsComponentPaint('naval', { componentPaint: 'fixed' })).toBe(false);
  expect(followsComponentPaint('naval', { ...componentMaterial('glass').userData, componentPaint: 'component' })).toBe(false);
  expect(followsComponentPaint('naval-custom', {})).toBe(false);
  expect(followsComponentPaint('constructor', {})).toBe(false);
});
