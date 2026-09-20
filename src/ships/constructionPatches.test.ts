import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { EQUIPMENT_PATCH_FIELDS, PRIMITIVE_PATCH_FIELDS, patchEquipment, patchPrimitive } from './constructionPatches';
import { UNPATCHABLE } from './constructionCommandSchema';
import { readTypes, type TypeField } from './constructionTypeReader';
import { applyConstructionBatch, type ConstructionCommand } from './constructionCommands';
import { createStarterSource } from './constructionStarter';
import type { ConstructionCatalog, ConstructionEquipment } from './blueprint';

type Table = { [key: string]: true | Table };
/** Declared field paths with no patch entry. Objects merge, so their members need entries too; arrays replace whole. */
function uncovered(declared: Record<string, TypeField>, table: Table, skipped: Record<string, string>, path = ''): string[] {
  return Object.entries(declared).flatMap(([key, field]) => {
    const at = path ? path + '.' + key : key;
    if (!path && Object.hasOwn(skipped, key)) return skipped[key].length ? [] : [at + ' is unpatchable without a reason'];
    const entry = table[key];
    if (entry === undefined) return [at];
    if (field.fields) return entry === true ? [at + ' must merge as an object'] : uncovered(field.fields, entry, skipped, at);
    return entry === true ? [] : [at + ' is not an object in the source type'];
  });
}

test('every declared primitive and equipment field is patchable or listed as unpatchable with a reason', () => {
  const types = readTypes([join(import.meta.dir, 'blueprint/blueprintTypes.ts'), join(import.meta.dir, 'blueprint/constructionTypes.ts')]);
  const primitive = types.fields('ConstructionPrimitive'), equipment = types.fields('ConstructionEquipment');
  expect(Object.keys(primitive).length).toBeGreaterThan(8);
  expect(uncovered(primitive, PRIMITIVE_PATCH_FIELDS, UNPATCHABLE.primitive)).toEqual([]);
  expect(uncovered(equipment, EQUIPMENT_PATCH_FIELDS, UNPATCHABLE.equipment)).toEqual([]);
  expect(PRIMITIVE_PATCH_FIELDS).not.toHaveProperty('id');
  expect(EQUIPMENT_PATCH_FIELDS).not.toHaveProperty('id');
  // The check notices a gap: drop one entry and it is reported by path.
  const { access: _, ...path } = EQUIPMENT_PATCH_FIELDS.path as Table;
  expect(uncovered(equipment, { ...EQUIPMENT_PATCH_FIELDS, path }, UNPATCHABLE.equipment)).toEqual(['path.access']);
});

test('bilge keels, railing overrides and ladder settings merge like every other nested record', () => {
  const hull = createStarterSource({ revision: 'test' } as ConstructionCatalog, 'fletcher-hull').construction.primitives[0];
  const keels = { version: 1 as const, enabled: true, start: .3, end: .7, widthM: .6, thicknessM: .05, placement: .5 };
  const fitted = patchPrimitive(hull, { customHull: { bilgeKeels: keels } });
  expect(fitted.customHull).toEqual({ ...hull.customHull!, bilgeKeels: keels });
  expect(patchPrimitive(fitted, { customHull: { bilgeKeels: { widthM: .8 } } }).customHull!.bilgeKeels).toEqual({ ...keels, widthM: .8 });
  expect(patchPrimitive(fitted, { customHull: { bilgeKeels: null } }).customHull).toEqual({ ...hull.customHull!, bilgeKeels: undefined });
  const rail: ConstructionEquipment = { id: 'rail', partId: 'railing', position: [0, 2, 0], bearingDeg: 0, path: { points: [[0, 0, 0], [0, 0, 4]] } };
  const access = { widthM: .6, standOffM: .2, handrails: 'both' as const, grabHeightM: 1 };
  const next = patchEquipment(rail, { path: { heightM: 1.2, railCount: 2, access } });
  expect(next.path).toEqual({ ...rail.path!, heightM: 1.2, railCount: 2, access });
  expect(patchEquipment(next, { path: { access: { handrails: 'left' }, heightM: null } }).path).toEqual({ ...rail.path!, railCount: 2, access: { ...access, handrails: 'left' } });
  expect(rail.path).toEqual({ points: [[0, 0, 0], [0, 0, 4]] });
});

test('the same patches pass the command door, which type-checks values and refuses null on required fields', () => {
  const s = createStarterSource({ revision: 'test' } as ConstructionCatalog, 'fletcher-hull');
  s.construction.equipment.push({ id: 'rail', partId: 'railing', position: [0, 2, 0], bearingDeg: 0, path: { points: [[0, 0, 0], [0, 0, 4]] } });
  const run = (...commands: unknown[]) => applyConstructionBatch(s, { version: 1, expectedRevision: s.revision, label: 'Patch', commands: commands as ConstructionCommand[] });
  const next = run(
    { op: 'primitive-patch', id: 'hull', changes: { customHull: { bilgeKeels: { version: 1, enabled: true, start: .3, end: .7, widthM: .6, thicknessM: .05, placement: .5 } } } },
    { op: 'equipment-patch', id: 'rail', changes: { path: { heightM: 1.2, railCount: 3, access: { widthM: .6, standOffM: .2, handrails: 'none', grabHeightM: 1 } } } },
  );
  expect(next.construction.primitives[0].customHull!.bilgeKeels!.widthM).toBe(.6);
  expect(next.construction.equipment[0].path).toMatchObject({ heightM: 1.2, railCount: 3, access: { handrails: 'none' } });
  expect(() => run({ op: 'equipment-patch', id: 'rail', changes: { path: { railCount: 4 } } })).toThrow('Command 0 (equipment-patch): changes.path.railCount must be one of 2, 3, got 4');
  expect(() => run({ op: 'equipment-patch', id: 'rail', changes: { path: { points: null } } })).toThrow('changes.path.points must be an array, got null');
  expect(() => run({ op: 'equipment-patch', id: 'rail', changes: { id: 'renamed' } })).toThrow('unknown field changes.id');
  expect(() => run({ op: 'primitive-patch', id: 'hull', changes: { customHull: { bilgeKeels: { widthM: 900 } } } })).toThrow('Command 0 (primitive-patch): result is not a valid source');
});
