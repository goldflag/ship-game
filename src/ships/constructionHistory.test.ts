import { expect, test } from 'bun:test';
import { createConstructionHistory, editConstruction, undoConstruction, redoConstruction, ConstructionRevisionGate } from './constructionHistory';

test('one bulk edit restores shape and its surface/module references together', () => {
  const initial = { primitives: [{ id: 'hull' }], surfaces: [{ primitiveId: 'hull', thicknessMm: 50 }], modules: [{ id: 'gun', support: 'hull' }] };
  const opened = createConstructionHistory(initial);
  const removed = editConstruction(opened, 'Remove selection', draft => { draft.primitives = []; draft.surfaces = []; draft.modules = []; });
  expect(undoConstruction(removed).source).toEqual(initial);
  expect(redoConstruction(undoConstruction(removed)).source).toEqual(removed.source);
  expect(initial.primitives).toHaveLength(1);
});

test('undo/redo increments revision identity and branching discards future edits', () => {
  const first = editConstruction(createConstructionHistory({ x: 1 }), 'Move', source => { source.x = 2; });
  const undone = undoConstruction(first);
  expect(undone.revision).toBeGreaterThan(first.revision);
  const branch = editConstruction(undone, 'Move another way', source => { source.x = 3; });
  expect(redoConstruction(branch).source.x).toBe(3);
  expect(branch.future).toHaveLength(0);
});

test('late compile results and previous-design results cannot become current', async () => {
  const gate = new ConstructionRevisionGate();
  const slow = gate.issue();
  const current = gate.issue();
  await Promise.resolve();
  expect(gate.accepts(current)).toBe(true);
  expect(gate.accepts(slow)).toBe(false);
  gate.invalidate();
  expect(gate.accepts(current)).toBe(false);
});
