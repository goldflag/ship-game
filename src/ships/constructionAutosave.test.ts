import { expect, test } from 'bun:test';
import { ConstructionAutosave, type ConstructionSaveDraft } from './constructionAutosave';
import type { ConstructionRevision, SaveConstructionSource } from './constructionStore';

const draft = (x: number): ConstructionSaveDraft => ({ designId: 'ship', name: 'Trial', source: { x }, schemaVersion: 1, catalogRevision: 'c1' });
const revision = (id: string): ConstructionRevision => ({ formatVersion: 1, id, designId: 'ship', parentId: null, createdAt: 1, schemaVersion: 1, catalogRevision: 'c1', sourceJson: '{}' });

test('edits during an in-flight save coalesce and use the committed head', async () => {
  const calls: SaveConstructionSource[] = [];
  let finish!: (result: ConstructionRevision) => void;
  const saver = new ConstructionAutosave({ save: async input => {
    calls.push(input);
    return calls.length === 1 ? new Promise(resolve => { finish = resolve; }) : revision('r2');
  } }, null);
  saver.enqueue(draft(1)); saver.enqueue(draft(2)); saver.enqueue(draft(3));
  expect(calls).toHaveLength(1);
  finish(revision('r1'));
  await saver.flush();
  expect(calls).toHaveLength(2);
  expect(calls[1]).toMatchObject({ source: { x: 3 }, expectedRevisionId: 'r1' });
  expect(saver.unsaved).toBe(false);
});

test('quota failure retains newest unsaved draft and retry does not invent a committed revision', async () => {
  let fail = true;
  const calls: SaveConstructionSource[] = [];
  const saver = new ConstructionAutosave({ save: async input => {
    calls.push(input);
    if (fail) throw new DOMException('Full', 'QuotaExceededError');
    return revision('r3');
  } }, 'r2');
  saver.enqueue(draft(1));
  await expect(saver.flush()).rejects.toThrow('Full');
  saver.enqueue(draft(4));
  expect(saver.unsaved).toBe(true);
  expect(calls).toHaveLength(1);
  fail = false;
  await saver.retry();
  expect(calls[1]).toMatchObject({ source: { x: 4 }, expectedRevisionId: 'r2' });
  expect(saver.headRevisionId).toBe('r3');
  expect(saver.unsaved).toBe(false);
});
