import { openConstructionStore, readConstructionSource, type ConstructionRevision } from '../../src/ships/constructionStore';

/** Run on a blank same-origin Vite page; this exercises the browser's actual IndexedDB transactions. */
export async function checkConstructionStore() {
  const name = `construction-check-${crypto.randomUUID()}`;
  const checks: string[] = [];
  const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); checks.push(message); };
  let store = await openConstructionStore({ name });
  let other: Awaited<ReturnType<typeof openConstructionStore>> | undefined;
  try {
    const source = { id: 'local-check', primitives: Array.from({ length: 12000 }, (_, i) => ({ id: `p-${i}`, position: [i % 200, 0, Math.floor(i / 200)], size: [1, 1, 1], kind: i % 3 ? 'box' : 'wedge' })), surfaces: [{ primitiveId: 'p-1', face: 'port', thicknessMm: 23.5, paint: 'naval-grey', open: true }] };
    const input = { designId: source.id, name: 'Storage trial', source, schemaVersion: 1, catalogRevision: 'test-catalog', expectedRevisionId: null };
    const first = await store.save(input);
    store.close();
    store = await openConstructionStore({ name });
    const loaded = await store.load(source.id);
    assert(loaded.revision.sourceJson === JSON.stringify(source), 'large source survives close/reopen with exact IDs, dimensions and surface assignments');
    other = await openConstructionStore({ name });
    const outcomes = await Promise.allSettled([
      store.save({ ...input, expectedRevisionId: first.id, source: { ...source, name: 'editor-a' } }),
      other.save({ ...input, expectedRevisionId: first.id, source: { ...source, name: 'editor-b' } }),
    ]);
    assert(outcomes.filter(result => result.status === 'fulfilled').length === 1, 'concurrent editors cannot both advance the same head');
    const rejected = outcomes.find(result => result.status === 'rejected') as PromiseRejectedResult;
    assert(rejected.reason.code === 'conflict', 'losing editor receives an actionable conflict');
    let revisions = await store.revisions(source.id);
    assert(revisions.length === 2, 'aborted transaction leaves no orphan revision');
    assert(revisions.some(revision => revision.id === first.id), 'previous recoverable source remains available');
    const head = (await store.load(source.id)).head;
    const draft = await store.save({ ...input, expectedRevisionId: head.revisionId, source: { ...source, primitives: [] } });
    assert(draft.id === (await store.load(source.id)).head.revisionId, 'incomplete draft autosaves without requiring physical validity');
    const recovered = await store.save({ ...input, expectedRevisionId: draft.id, source: JSON.parse(first.sourceJson) });
    assert(recovered.sourceJson === first.sourceJson && recovered.id !== first.id, 'recovery creates a new source revision without mutating the original');
    const unsupported: ConstructionRevision = { ...first, schemaVersion: 99 };
    try { readConstructionSource(unsupported, { schemaVersion: 1, catalogRevision: 'test-catalog', decode: source => source }); throw new Error('accepted future source'); }
    catch (error) { assert((error as { code: string }).code === 'unsupported-version', 'future source reports recoverable version error'); }
    revisions = await store.revisions(source.id);
    assert(revisions.find(revision => revision.id === first.id)?.sourceJson === first.sourceJson, 'failed load and recovery preserve original bytes');
    return { passed: checks.length, checks, sourceBytes: first.sourceJson.length };
  } finally {
    other?.close(); store.close();
    await new Promise<void>((resolve, reject) => { const request = indexedDB.deleteDatabase(name); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); });
  }
}
