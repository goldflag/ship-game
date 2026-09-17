import { expect, test } from 'bun:test';
import type { ConstructionCatalog, ConstructionSource, ConstructionSurface } from './blueprint';
import type { ConstructionStore } from './constructionStore';
import { assignConstructionSurfaces, copyConstructionSelection, decodeConstructionSource, decodeSavedConstruction, editableConstructionSurfaces, loadSavedConstructionWithCatalog, mirroredFace, mirroredPrimitive, projectConstructionSurfaces, removeConstructionSelection, surfaceKey } from './constructionEditor';

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

test('derived fitting supports never become editable hull faces and colon-bearing IDs remain intact', () => {
  const draft = source(); draft.construction.primitives[0].id = 'hull:port';
  const face = { id: 'native-face', primitiveId: 'hull:port', face: 'port', vertices: [], normal: [-1, 0, 0], areaM2: 1,
    thicknessMm: 16, material: 'steel', paint: 'naval-gray', open: false } as ConstructionSurface;
  const surfaces = [face, { ...face, primitiveId: 'equipment:gun-forward', face: 'installation-outer' },
    { ...face, primitiveId: 'equipment:gun-forward' }, { ...face, face: 'installation-top' }];
  const editable = editableConstructionSurfaces(draft, surfaces);
  expect(editable).toEqual([face]);
  assignConstructionSurfaces(draft, new Set(editable.map(surface => surfaceKey(surface.primitiveId, surface.face))), { paint: 'sea-blue' });
  expect(draft.construction.surfaces.at(-1)).toMatchObject({ primitiveId: 'hull:port', face: 'port', paint: 'sea-blue' });
  expect(draft.construction.surfaces.some(surface => surface.primitiveId.startsWith('equipment:'))).toBe(false);
  expect(surfaces).toHaveLength(4);
});

test('removing envelope clears owned surface assignments but keeps equipment as editable fit errors', () => {
  const draft = source(); draft.construction.primitives.push({ ...draft.construction.primitives[0], id: 'other-hull' });
  removeConstructionSelection(draft, new Set(['hull']));
  expect(draft.construction.primitives).toHaveLength(1); expect(draft.construction.surfaces).toHaveLength(0);
  expect(draft.construction.equipment).toHaveLength(2);
});

test('source decoder admits incomplete drafts and unresolved variants without substituting equipment', () => {
  const draft = source(); draft.construction.primitives = [];
  expect(decodeConstructionSource(draft)).toEqual(draft);
  expect(() => decodeConstructionSource({ ...draft, coordinates: 'blender-z-up' })).toThrow();
  expect(() => decodeConstructionSource({ ...draft, construction: { ...draft.construction, primitives: [{ position: [0, null, 0] }] } })).toThrow();
});

test('saved design loads its retained catalog revision rather than requiring the latest catalog', async () => {
  const draft = source(), raw = JSON.stringify(draft);
  const saved = { head: { id: 'draft', name: 'Draft', revisionId: 'saved-1', updatedAt: 1, schemaVersion: 1, catalogRevision: 'c1' },
    revision: { formatVersion: 1 as const, id: 'saved-1', designId: 'draft', parentId: null, createdAt: 1, schemaVersion: 1, catalogRevision: 'c1', sourceJson: raw } };
  const store = { load: async () => saved } as unknown as ConstructionStore;
  const requested: (string | undefined)[] = [];
  const catalog = { schemaVersion: 1, revision: 'c1', equipment: [], weapons: { schemaVersion: 1, parts: [] } } as ConstructionCatalog;
  const result = await loadSavedConstructionWithCatalog(store, 'draft', async revision => { requested.push(revision); return catalog; });
  expect(requested).toEqual(['c1']); expect(result.source).toEqual(draft); expect(result.catalog).toBe(catalog);
  await expect(loadSavedConstructionWithCatalog(store, 'draft', async () => { throw new Error('revision missing'); })).rejects.toMatchObject({ code: 'catalog' });
  expect(saved.revision.sourceJson).toBe(raw);
  expect(() => decodeSavedConstruction({ ...saved.revision, designId: 'different-design' })).toThrow('identities disagree');
});


test('deleting the last block preserves its shape, paint, armor and openings exactly', () => {
  const draft = source(), before = structuredClone(draft);
  removeConstructionSelection(draft, new Set(['hull']));
  expect(draft).toEqual(before);
});

test('delete-all keeps one block and its surfaces while removing other selected pieces and fittings', () => {
  const draft = source(), first = structuredClone(draft.construction.primitives[0]), skin = structuredClone(draft.construction.surfaces);
  const copied = copyConstructionSelection(draft, new Set(['hull', 'gun', 'magazine']));
  removeConstructionSelection(draft, new Set(['hull', 'gun', 'magazine', ...copied]));
  expect(draft.construction.primitives).toEqual([first]);
  expect(draft.construction.surfaces).toEqual(skin);
  expect(draft.construction.equipment).toEqual([]);
});

test('projecting the source over compiled faces applies its assignments, panels inheriting their whole face, and keeps untouched faces by identity', () => {
  const face = (id: string, over: Partial<ConstructionSurface>): ConstructionSurface => ({ id, primitiveId: 'hull', face: 'top', vertices: [], normal: [0, 1, 0], areaM2: 1, thicknessMm: 12, material: 'steel', paint: 'naval-gray', open: false, ...over });
  const compiled = [face('a', { face: 'port' }), face('b', { face: 'port', panelId: 'p1' }), face('c', {})];
  const projected = projectConstructionSurfaces(source(), compiled);
  expect(projected[0]).toMatchObject({ face: 'port', thicknessMm: 200, material: 'armor-steel', open: true });
  expect(projected[1]).toMatchObject({ face: 'port', panelId: 'p1', thicknessMm: 200, material: 'armor-steel', open: true });
  expect(projected[2]).toBe(compiled[2]);
});
