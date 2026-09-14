import { expect, test } from 'bun:test';
import { encodeConstructionSource, readConstructionSource, openConstructionStore, type ConstructionRevision } from './constructionStore';

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

test('migration reads a detached source and cannot overwrite its original even on failure', () => {
  const saved = revision();
  const before = saved.sourceJson;
  const migrated = readConstructionSource(saved, { ...reader, schemaVersion: 2, migrate: value => ({ ...value as object, name: 'upgraded' }) });
  expect(migrated.migrated).toBe(true);
  expect(migrated.source).toHaveProperty('name', 'upgraded');
  expect(saved.sourceJson).toBe(before);
  expect(() => readConstructionSource(saved, { ...reader, schemaVersion: 2, migrate: () => { throw new Error('cannot migrate'); } })).toThrow('could not be upgraded');
  expect(saved.sourceJson).toBe(before);
});

test('compiler-invalid drafts remain serializable; non-finite numeric values cannot silently turn into null', () => {
  expect(JSON.parse(encodeConstructionSource({ primitives: [], overlappingEquipment: true }))).toEqual({ primitives: [], overlappingEquipment: true });
  expect(() => encodeConstructionSource({ dimensions: [1, Infinity, 2] })).toThrow('cannot be saved');
});

test('unavailable browser storage reports a recoverable failure', async () => {
  await expect(openConstructionStore()).rejects.toMatchObject({ code: 'unavailable' });
});
