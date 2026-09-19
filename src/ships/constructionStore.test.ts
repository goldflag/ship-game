import { expect, test } from 'bun:test';
import { cloneConstructionDesign, cloneDesignName, ConstructionStoreError, encodeConstructionSource, readConstructionSource, openConstructionStore, type ConstructionRevision, type ConstructionStore } from './constructionStore';

const original = { primitives: [{ id: 'bow-1', kind: 'wedge', dimensions: [4, 2, 7] }], surfaces: [{ id: 'bow-1/port', paint: 'naval-grey', thicknessMm: 23.5 }], modules: [{ id: 'engine-1', partId: 'fixed-variant', position: [1.25, 2, -4] }] };
const revision = (over: Partial<ConstructionRevision> = {}): ConstructionRevision => ({ formatVersion: 1, id: 'r1', designId: 'd1', parentId: null, createdAt: 1, schemaVersion: 1, catalogRevision: 'catalog-1', sourceJson: encodeConstructionSource(original), ...over });
const reader = { schemaVersion: 1, catalogRevision: 'catalog-1', decode: (value: unknown) => value as typeof original };

test('source roundtrip preserves dimensions, stable references and fractional armor without aliasing', () => {
  const saved = revision();
  const loaded = readConstructionSource(saved, reader).source;
  expect(loaded).toEqual(original);
  loaded.primitives[0].id = 'changed';
  expect(readConstructionSource(saved, reader).source.primitives[0].id).toBe('bow-1');
});

test('unsupported versions, missing catalog and corrupt data leave the original intact', () => {
  for (const [saved, code] of [[revision({ schemaVersion: 9 }), 'unsupported-version'], [revision({ catalogRevision: 'missing' }), 'catalog'], [revision({ sourceJson: '{bad' }), 'corrupt']] as const) {
    const before = structuredClone(saved);
    try { readConstructionSource(saved, reader); throw new Error('Unexpected success'); }
    catch (error) { expect(error).toMatchObject({ code }); }
    expect(saved).toEqual(before);
  }
});

test('compiler-invalid drafts remain serializable; non-finite numeric values cannot silently turn into null', () => {
  expect(JSON.parse(encodeConstructionSource({ primitives: [], overlappingEquipment: true }))).toEqual({ primitives: [], overlappingEquipment: true });
  expect(() => encodeConstructionSource({ dimensions: [1, Infinity, 2] })).toThrow('cannot be saved');
});

test('unavailable browser storage reports a recoverable failure', async () => {
  await expect(openConstructionStore()).rejects.toMatchObject({ code: 'unavailable' });
});

test('cloning saves the latest revision as a new design with its own identity, name and history', async () => {
  const revision = (designId: string, source: unknown, parentId: string | null = null): ConstructionRevision => ({ formatVersion: 1, id: `stored-${designId}`, designId, parentId, createdAt: 1, schemaVersion: 1, catalogRevision: 'catalog-7', sourceJson: encodeConstructionSource(source) });
  const original = { id: 'design-a', revision: 'revision-a', name: 'Valiant', construction: { catalogRevision: 'catalog-7', primitives: [{ id: 'hull', armorMm: 12.5 }] } };
  const designs = new Map([['design-a', { name: 'Valiant', revision: revision('design-a', original) }], ['design-b', { name: 'Valiant copy', revision: revision('design-b', { ...original, id: 'design-b' }) }]]);
  const head = (id: string) => { const design = designs.get(id)!; return { id, name: design.name, revisionId: design.revision.id, updatedAt: 1, schemaVersion: 1, catalogRevision: 'catalog-7' }; };
  const store: ConstructionStore = {
    list: async () => [...designs.keys()].map(head),
    load: async id => { if (!designs.has(id)) throw new ConstructionStoreError('not-found', 'missing'); return { head: head(id), revision: designs.get(id)!.revision }; },
    revisions: async id => [designs.get(id)!.revision],
    save: async input => { expect(input.expectedRevisionId).toBeNull(); expect(designs.has(input.designId)).toBe(false); const saved = revision(input.designId, input.source); designs.set(input.designId, { name: input.name, revision: saved }); return saved; },
    remove: async () => {}, close() {},
  };
  let n = 0;
  const clone = await cloneConstructionDesign(store, 'design-a', prefix => `${prefix}-clone-${++n}`);
  expect(clone).toMatchObject({ sourceId: 'design-clone-1', name: 'Valiant copy 2' });
  expect(JSON.parse(clone.revision.sourceJson)).toEqual({ ...original, id: 'design-clone-1', revision: 'revision-clone-2', name: 'Valiant copy 2' });
  expect(clone.revision).toMatchObject({ designId: 'design-clone-1', parentId: null, schemaVersion: 1, catalogRevision: 'catalog-7' });
  expect(JSON.parse(designs.get('design-a')!.revision.sourceJson)).toEqual(original);
  // A clone of a clone counts on rather than stacking suffixes.
  expect(cloneDesignName('Valiant copy 2', ['Valiant', 'Valiant copy', 'Valiant copy 2'])).toBe('Valiant copy 3');
  expect(cloneDesignName('x'.repeat(160), []).length).toBeLessThanOrEqual(160);
  designs.get('design-a')!.revision.sourceJson = '{';
  await expect(cloneConstructionDesign(store, 'design-a')).rejects.toMatchObject({ code: 'corrupt' });
  expect(designs.size).toBe(3);
});
