import { expect, test } from 'bun:test';
import type { ConstructionCatalog } from './blueprint';
import { createStarterSource } from './constructionStarter';
import { freshConstruction } from '../ui/shipbuilding/useBuilderSource';
import { createConstructionHistory, editConstruction, undoConstruction } from './constructionHistory';
import { removeConstructionSelection } from './constructionEditor';

const catalog = { revision: 'starter-test' } as ConstructionCatalog;
test('new blank designs begin with exactly one centered cube and independent identities', () => {
  const first = createStarterSource(catalog, 'blank'), second = createStarterSource(catalog, 'blank');
  expect(first.construction.primitives).toEqual([{ id: 'hull', kind: 'box', size: [1, 1, 1], position: [0, 0, 0], rotationDeg: 0 }]);
  expect(first.construction.equipment).toEqual([]);
  expect(first.id).not.toBe(second.id);
  const fresh = freshConstruction(first, true);
  expect(fresh.construction.primitives).toEqual(first.construction.primitives);
  expect(fresh.id).not.toBe(first.id);
  fresh.construction.primitives[0].size[0] = 5;
  expect(first.construction.primitives[0].size[0]).toBe(1);
});
test('undoing the first placement returns to the protected starting block', () => {
  const source = createStarterSource(catalog, 'blank');
  const history = editConstruction(createConstructionHistory(source), 'Place block', draft => {
    draft.construction.primitives.push({ ...draft.construction.primitives[0], id: 'new-block', position: [1, 0, 0] });
  });
  const restored = undoConstruction(history);
  expect(restored.source.construction.primitives).toEqual(source.construction.primitives);
  const afterDelete = editConstruction(restored, 'Remove block', draft => removeConstructionSelection(draft, new Set(['hull'])));
  expect(afterDelete).toBe(restored);
});
