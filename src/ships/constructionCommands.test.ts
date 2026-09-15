import { expect, test } from 'bun:test';
import { applyConstructionBatch, type ConstructionBatch } from './constructionCommands';
import type { ConstructionSource } from './blueprint';
const source = (): ConstructionSource => ({ schemaVersion: 1, id: 'test', name: 'Test', revision: 'one', coordinates: 'meters-y-up-bow-negative-z', construction: { version: 1, catalogRevision: 'test', defaultThicknessMm: 10, primitives: [{ id: 'hull', kind: 'box', size: [10, 4, 20], position: [0, 0, 0], rotationDeg: 0 }], surfaces: [], equipment: [], boundaries: [], loads: [] } });
test('agent batch is atomic and rejects stale revisions and syntax failures', () => {
  const original = source(), before = JSON.stringify(original);
  const batch: ConstructionBatch = { version: 1, expectedRevision: 'one', label: 'Refit', commands: [{ op: 'name', name: 'Changed' }, { op: 'move', ids: ['absent'], delta: [1, 0, 0] }] };
  expect(() => applyConstructionBatch(original, batch)).toThrow('unknown');
  expect(JSON.stringify(original)).toBe(before);
  expect(() => applyConstructionBatch(original, { ...batch, expectedRevision: 'old' })).toThrow('revision');
});
test('batch preserves stable IDs, face assignments and equipment links through one source revision', () => {
  const s = source();
  const next = applyConstructionBatch(s, { version: 1, expectedRevision: s.revision, label: 'Fit gun', commands: [
    { op: 'equipment', value: { id: 'gun', partId: 'exact-variant', position: [0, 2, 0], bearingDeg: 0, magazineId: 'mag' } },
    { op: 'surface', value: { primitiveId: 'hull', face: 'top', thicknessMm: 20, material: 'steel', paint: 'deck-gray' } },
    { op: 'vertices', id: 'hull', selection: { mode: 'face', index: 5 }, delta: [0, 1, 0] },
  ] }, 'two');
  expect(next.revision).toBe('two');
  expect(next.construction.primitives[0].id).toBe('hull');
  expect(next.construction.primitives[0].vertices).toHaveLength(8);
  expect(next.construction.equipment[0].magazineId).toBe('mag');
  expect(next.construction.surfaces[0].primitiveId).toBe('hull');
  expect(s.construction.equipment).toHaveLength(0);
});
