import { expect, test } from 'bun:test';
import type { ConstructionSource } from './blueprint';
import { assignConstructionSurfaces, copyConstructionSelection, decodeConstructionSource, mirroredFace, mirroredPrimitive, removeConstructionSelection, surfaceKey } from './constructionEditor';

const source = (): ConstructionSource => ({ schemaVersion: 1, id: 'draft', revision: 'r1', name: 'Draft', coordinates: 'meters-y-up-bow-negative-z', construction: {
  version: 1, catalogRevision: 'c1', defaultThicknessMm: 12,
  primitives: [{ id: 'hull', kind: 'corner', size: [2, 3, 7], position: [-6, 1, -3], rotationDeg: 90 }],
  surfaces: [{ primitiveId: 'hull', face: 'port', material: 'armor-steel', thicknessMm: 200, paint: 'naval-gray', open: true }],
  equipment: [{ id: 'gun', partId: 'gun-variant', position: [0, 3, -1], bearingDeg: 45, magazineId: 'magazine' }, { id: 'magazine', partId: 'magazine-variant', position: [0, 0, -1], bearingDeg: 0 }],
  boundaries: [], loads: [],
} });

test('copy preserves exact variants and remaps selected links and face assignments', () => {
  const draft = source();
  const ids = copyConstructionSelection(draft, new Set(['hull', 'gun', 'magazine']));
  expect(ids).toHaveLength(3);
  expect(new Set(ids).size).toBe(3);
  expect(draft.construction.surfaces[1]).toEqual({ ...draft.construction.surfaces[0], primitiveId: ids[0] });
  expect(draft.construction.equipment[2].partId).toBe('gun-variant');
  expect(draft.construction.equipment[2].magazineId).toBe(draft.construction.equipment[3].id);
  expect(draft.construction.primitives[1].size).toEqual([2, 3, 7]);
});

test('corner mirror swaps axes and face identity and is an involution', () => {
  const primitive = source().construction.primitives[0];
  const mirrored = mirroredPrimitive(primitive);
  expect(mirrored.position).toEqual([6, 1, -3]);
  expect(mirrored.size).toEqual([7, 3, 2]);
  expect(mirroredPrimitive(mirrored)).toEqual(primitive);
  expect(mirroredFace('port', 'corner')).toBe('bow');
  expect(mirroredFace('bow', 'corner')).toBe('port');
  expect(mirroredFace('port', 'wedge')).toBe('starboard');
});

test('surface painting touches the selected source face only and does not close its opening', () => {
  const draft = source();
  assignConstructionSurfaces(draft, new Set([surfaceKey('hull', 'port')]), { thicknessMm: 30, paint: 'sea-blue' });
  expect(draft.construction.surfaces).toHaveLength(1);
  expect(draft.construction.surfaces[0]).toMatchObject({ thicknessMm: 30, paint: 'sea-blue', open: true });
  assignConstructionSurfaces(draft, new Set([surfaceKey('hull', 'top')]), { open: false });
  expect(draft.construction.surfaces[1]).toMatchObject({ face: 'top', thicknessMm: 12, material: 'steel' });
});

test('removing envelope clears owned surface assignments but keeps equipment as editable fit errors', () => {
  const draft = source(); removeConstructionSelection(draft, new Set(['hull']));
  expect(draft.construction.primitives).toHaveLength(0); expect(draft.construction.surfaces).toHaveLength(0);
  expect(draft.construction.equipment).toHaveLength(2);
});

test('source decoder admits incomplete drafts and unresolved variants without substituting equipment', () => {
  const draft = source(); draft.construction.primitives = [];
  expect(decodeConstructionSource(draft)).toEqual(draft);
  expect(() => decodeConstructionSource({ ...draft, coordinates: 'blender-z-up' })).toThrow();
  expect(() => decodeConstructionSource({ ...draft, construction: { ...draft.construction, primitives: [{ position: [0, null, 0] }] } })).toThrow();
});
