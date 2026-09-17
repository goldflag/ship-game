import { expect, test } from 'bun:test';
import type { ConstructionSource } from './blueprint';
import { ConstructionRevisionOwner } from './constructionRevisionOwner';
import type { ConstructionRevision, ConstructionStore, SaveConstructionSource } from './constructionStore';

const source = (revision = 's1', name = 'Draft'): ConstructionSource => ({ schemaVersion: 1, id: 'design', revision, name, coordinates: 'meters-y-up-bow-negative-z', construction: { version: 1, catalogRevision: 'exact-catalog', defaultThicknessMm: 12, primitives: [], surfaces: [], equipment: [], boundaries: [], loads: [] } });
const revision = (input: SaveConstructionSource, id: string): ConstructionRevision => ({ formatVersion: 1, id, designId: input.designId, parentId: input.expectedRevisionId, createdAt: 1, schemaVersion: input.schemaVersion, catalogRevision: input.catalogRevision, sourceJson: JSON.stringify(input.source) });
const loaded = (value = source(), id = 'head1') => ({ source: value, revision: revision({ designId: value.id, name: value.name, source: value, expectedRevisionId: null, schemaVersion: 1, catalogRevision: value.construction.catalogRevision }, id), head: { id: value.id, name: value.name, revisionId: id, updatedAt: 1, schemaVersion: 1, catalogRevision: value.construction.catalogRevision } });
function setup() {
  const writes: SaveConstructionSource[] = [], retained: SaveConstructionSource[] = [], removed: string[] = [];
  let external = loaded();
  const store: ConstructionStore = { list: async () => [], load: async () => external, revisions: async () => [], close() {}, remove: async (id, head) => { removed.push(`${id}:${head}`); }, save: async input => { writes.push(input); return revision(input, `head${writes.length + 1}`); } };
  const owner = new ConstructionRevisionOwner(source(), { retainRecovery: async input => { retained.push(input); }, load: async () => external });
  return { owner, store, writes, retained, removed, external: (value: ReturnType<typeof loaded>) => { external = value; } };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

test('synchronous edits and undo/redo enqueue exact revisions before an immediate flush', async () => {
  const { owner, store, writes, retained } = setup();
  await owner.connect(store, 'design');
  owner.submit('Rename', [{ op: 'name', name: 'First' }]);
  owner.submit('Rename again', [{ op: 'name', name: 'Second' }]);
  await owner.flush();
  expect(JSON.parse(JSON.stringify(writes.at(-1)?.source))).toEqual(owner.source);
  expect(retained.at(-1)?.source).toEqual(owner.source);
  expect(writes.at(-1)?.catalogRevision).toBe('exact-catalog');
  const edited = owner.source.revision;
  owner.undo(); await owner.flush();
  expect(owner.source.name).toBe('First'); expect(owner.source.revision).not.toBe(edited);
  owner.redo(); await owner.flush(); expect(owner.source.name).toBe('Second');
  expect(writes.map(item => item.expectedRevisionId)).toEqual(['head1', 'head2', 'head3', 'head4']);
});

test('returned trial source has explicit rejected head and never overwrites a newer save', async () => {
  const { store, writes, retained } = setup();
  const owner = new ConstructionRevisionOwner(source('trial', 'Returned'), { retainRecovery: async input => { retained.push(input); }, load: async () => loaded() });
  await owner.connect(store, undefined, true);
  await expect(owner.flush()).rejects.toThrow('differs');
  expect(owner.getSnapshot().head).toEqual({ kind: 'rejected', revisionId: 'head1' });
  await owner.replace({ ...source('copy'), id: 'copy' }, null, false, true);
  await owner.flush();
  expect(writes).toHaveLength(1); expect(writes[0].designId).toBe('copy');
  expect(retained[0].source).toMatchObject({ name: 'Returned' });
});

test('failed saves retain newest draft, block replacement, and retry from acknowledged head', async () => {
  const { owner, store, retained } = setup();
  await owner.connect(store, 'design');
  const save = store.save; store.save = async () => { throw new Error('quota'); };
  owner.submit('One', [{ op: 'name', name: 'One' }]);
  await expect(owner.flush()).rejects.toThrow('quota');
  owner.submit('Two', [{ op: 'name', name: 'Two' }]);
  await expect(owner.replace(source('other'), null, false)).rejects.toThrow('quota');
  expect(owner.source.name).toBe('Two');
  store.save = save; await owner.retrySave(); await owner.flush();
  expect(retained.at(-1)?.source).toMatchObject({ name: 'Two' });
  expect(owner.getSnapshot().head).toEqual({ kind: 'saved', revisionId: 'head2' });
});

test('poll adopts clean external changes with undo, but leaves a conflicted draft editable', async () => {
  const { owner, store, external } = setup();
  await owner.connect(store, 'design');
  external(loaded(source('external', 'External'), 'external-head'));
  await owner.pollRepository('design');
  expect(owner.source.name).toBe('External'); expect(owner.getSnapshot().history.past).toHaveLength(1);
  store.save = async () => { throw new Error('conflict'); };
  owner.submit('Local', [{ op: 'name', name: 'Local' }]);
  await expect(owner.flush()).rejects.toThrow('conflict');
  external(loaded(source('newer', 'Newer'), 'newer-head'));
  await owner.pollRepository('design');
  expect(owner.source.name).toBe('Local'); expect(owner.getSnapshot().error).toContain('draft was being edited');
  await owner.reloadRepository('design');
  expect(owner.source.name).toBe('Newer');
  expect(owner.getSnapshot().history.past.at(-1)?.source.name).toBe('Local');
  store.save = async input => revision(input, 'after-reload');
  owner.undo(); await owner.flush(); expect(owner.source.name).toBe('Local');
});

test('a late poll cannot replace an edit', async () => {
  const { store } = setup();
  const reply = deferred<ReturnType<typeof loaded>>();
  let loading = false;
  const owner = new ConstructionRevisionOwner(source(), { retainRecovery: async () => {}, load: async () => loading ? reply.promise : loaded() });
  await owner.connect(store, 'design'); loading = true;
  const poll = owner.pollRepository('design');
  owner.submit('Local', [{ op: 'name', name: 'Local' }]);
  reply.resolve(loaded(source('late', 'Late'), 'late-head')); await poll;
  expect(owner.source.name).toBe('Local');
});

test('same-design recovery replaces the writer head; deletion drains it before opening replacement', async () => {
  const { owner, store, writes, removed } = setup();
  await owner.connect(store, 'design');
  await owner.replace(source('recovered', 'Recovered'), 'recovery-head', false);
  await owner.flush(); expect(writes[0].expectedRevisionId).toBe('recovery-head');
  owner.submit('Final', [{ op: 'name', name: 'Final' }]);
  await owner.removeDesign('design', 'stale-list-head', { ...source('new'), id: 'new-design' });
  await owner.flush();
  expect(removed).toEqual(['design:head3']);
  expect(writes.at(-1)).toMatchObject({ designId: 'new-design', expectedRevisionId: null });
});

test('recovery retention is ordered even when its first write is delayed', async () => {
  const { store } = setup(), first = deferred<void>(), retained: string[] = [];
  const owner = new ConstructionRevisionOwner(source(), { load: async () => loaded(), retainRecovery: async input => { if (!retained.length) await first.promise; retained.push(input.name); } });
  await owner.connect(store, 'design');
  owner.submit('One', [{ op: 'name', name: 'One' }]); owner.submit('Two', [{ op: 'name', name: 'Two' }]);
  const flush = owner.flush(); first.resolve(); await flush;
  expect(retained).toEqual(['One', 'Two']);
});

test('batch apply then flush in the same turn saves the batch and rejects stale follow-up commands', async () => {
  const { owner, store, writes } = setup();
  await owner.connect(store, 'design');
  const expectedRevision = owner.source.revision;
  const applied = owner.applyBatch({ version: 1, expectedRevision, label: 'Agent rename', commands: [{ op: 'name', name: 'Agent' }] });
  const flushing = owner.flush();
  expect(owner.source).toEqual(applied);
  expect(() => owner.applyBatch({ version: 1, expectedRevision, label: 'Stale', commands: [{ op: 'name', name: 'Stale' }] })).toThrow('revision changed');
  await flushing;
  expect(writes.at(-1)?.source).toEqual(applied);
});

test('a poll pending across adoption and a disposed writer cannot publish stale state', async () => {
  const { store } = setup(), save = deferred<ConstructionRevision>(), read = deferred<ReturnType<typeof loaded>>();
  let poll = false, input!: SaveConstructionSource;
  const owner = new ConstructionRevisionOwner(source(), { retainRecovery: async () => {}, load: async () => poll ? read.promise : loaded() });
  await owner.connect(store, 'design');
  poll = true; const checking = owner.pollRepository('design');
  store.save = async value => { input = value; return save.promise; };
  owner.submit('Old', [{ op: 'name', name: 'Old' }]);
  await owner.replace({ ...source('replacement'), id: 'replacement' }, 'replacement-head', true, true);
  save.resolve(revision(input, 'obsolete-head'));
  read.resolve(loaded(source('obsolete', 'Obsolete'), 'obsolete-external-head'));
  await checking; await Promise.resolve();
  expect(owner.source.id).toBe('replacement');
  expect(owner.getSnapshot().head).toEqual({ kind: 'saved', revisionId: 'replacement-head' });
});

test('catalog load failure during polling preserves the source and acknowledged head', async () => {
  const { store } = setup();
  let missing = false;
  const owner = new ConstructionRevisionOwner(source(), { retainRecovery: async () => {}, load: async () => { if (missing) throw new Error('Retained catalog unavailable'); return loaded(); } });
  await owner.connect(store, 'design'); missing = true;
  await owner.pollRepository('design');
  expect(owner.source).toEqual(source());
  expect(owner.getSnapshot().head).toEqual({ kind: 'saved', revisionId: 'head1' });
  expect(owner.getSnapshot().error).toContain('Retained catalog unavailable');
});

test('recovery failure is visible without losing the save or newest editable source', async () => {
  const { store } = setup();
  const owner = new ConstructionRevisionOwner(source(), { retainRecovery: async () => { throw new Error('IndexedDB denied'); }, load: async () => loaded() });
  await owner.connect(store, 'design');
  owner.submit('Rename', [{ op: 'name', name: 'Saved without recovery' }]); await owner.flush();
  expect(owner.getSnapshot().saveState.status).toBe('saved');
  expect(owner.getSnapshot().error).toContain('Draft recovery unavailable: IndexedDB denied');
  expect(owner.source.name).toBe('Saved without recovery');
});


test('a late explicit reload cannot replace a subsequently adopted design', async () => {
  const { store } = setup(), reply = deferred<ReturnType<typeof loaded>>();
  let reloading = false;
  const owner = new ConstructionRevisionOwner(source(), { retainRecovery: async () => {}, load: async () => reloading ? reply.promise : loaded() });
  await owner.connect(store, 'design'); reloading = true;
  const reload = owner.reloadRepository('design');
  await owner.replace({ ...source('copy'), id: 'copy' }, null, false);
  reply.resolve(loaded(source('late', 'Late'), 'late-head'));
  await reload; expect(owner.source.id).toBe('copy');
});

for (const retainDraft of [false, true]) test(`replacement preserves a batch submitted during delayed recovery (retainDraft=${retainDraft})`, async () => {
  const { store } = setup(), recovery = deferred<void>();
  const owner = new ConstructionRevisionOwner(source(), { load: async () => loaded(), retainRecovery: async () => recovery.promise });
  await owner.connect(store, 'design');
  owner.submit('First', [{ op: 'name', name: 'First' }]);
  const replacing = owner.replace({ ...source('replacement'), id: 'replacement' }, null, false, retainDraft);
  const rejected = replacing.catch(error => error);
  const latest = owner.applyBatch({ version: 1, expectedRevision: owner.source.revision, label: 'Newest', commands: [{ op: 'name', name: 'Newest' }] });
  recovery.resolve(); expect((await rejected).message).toContain('active design changed'); await owner.flush();
  expect(owner.source).toEqual(latest);
  expect(owner.getSnapshot().saveState.status).toBe('saved');
});

for (const openAnother of [false, true]) test(`delayed deletion does not replace a subsequently ${openAnother ? 'opened design' : 'edited draft'}`, async () => {
  const { owner, store } = setup(), removed = deferred<void>(), entered = deferred<void>();
  await owner.connect(store, 'design');
  store.remove = async () => { entered.resolve(); await removed.promise; };
  const deleting = owner.removeDesign('design', 'head1', { ...source('replacement'), id: 'replacement' });
  const rejected = deleting.catch(error => error);
  await entered.promise;
  if (openAnother) await owner.replace({ ...source('other'), id: 'other' }, null, false);
  else owner.submit('New edit', [{ op: 'name', name: 'New edit' }]);
  const latest = structuredClone(owner.source);
  removed.resolve(); expect((await rejected).message).toContain('active design changed'); await owner.flush();
  expect(owner.source).toEqual(latest);
  expect(owner.getSnapshot().saveState.status).toBe('saved');
});

test('cloud acknowledgement cannot finish before retention and recreate a saved recovery draft', async () => {
  const { store } = setup(), retention = deferred<void>();
  let retained: unknown, saves = 0;
  store.save = async input => {
    saves++;
    if (JSON.stringify(retained) === JSON.stringify(input.source)) retained = undefined;
    return revision(input, 'acknowledged');
  };
  const owner = new ConstructionRevisionOwner(source(), { load: async () => loaded(), retainRecovery: async input => { await retention.promise; retained = input.source; } });
  await owner.connect(store, 'design'); owner.submit('Rename', [{ op: 'name', name: 'Renamed' }]);
  const flushed = owner.flush();
  await Promise.resolve(); expect(saves).toBe(0);
  retention.resolve(); await flushed;
  expect(saves).toBe(1); expect(retained).toBeUndefined();
});

test('a disconnected writer waiting for recovery never starts a late store write', async () => {
  const { store, writes } = setup(), retention = deferred<void>();
  const owner = new ConstructionRevisionOwner(source(), { load: async () => loaded(), retainRecovery: async () => retention.promise });
  await owner.connect(store, 'design'); owner.submit('Rename', [{ op: 'name', name: 'Renamed' }]);
  const flushing = owner.flush();
  const rejected = flushing.catch(error => error);
  owner.disconnect(); retention.resolve(); expect((await rejected).message).toContain('active design changed');
  expect(writes).toHaveLength(0);
});

test('the door refuses edits before the store settles and while an operation holds the design, without dropping them silently', async () => {
  const { owner, store } = setup();
  expect(owner.locked).toBe(true);
  const early = owner.submit('Early', [{ op: 'name', name: 'Early' }]);
  expect(early).toEqual({ accepted: false, reason: 'not-ready', message: expect.stringContaining('still opening') });
  expect(() => owner.applyBatch({ version: 1, expectedRevision: owner.source.revision, label: 'Early', commands: [{ op: 'name', name: 'Early' }] })).toThrow('still opening');
  expect(owner.source.name).toBe('Draft');
  await owner.connect(store, 'design');
  expect(owner.getSnapshot().ready).toBe(true); expect(owner.locked).toBe(false);
  owner.setBusy('Launching');
  const held = owner.submit('Held', [{ op: 'name', name: 'Held' }]);
  expect(held).toEqual({ accepted: false, reason: 'busy', message: 'Launching is in progress. Retry when it finishes.' });
  owner.setBusy('');
  const accepted = owner.submit('Rename', [{ op: 'name', name: 'Renamed' }]);
  expect(accepted).toMatchObject({ accepted: true, changed: true });
  expect(owner.source.name).toBe('Renamed');
  const same = owner.submit('Rename', [{ op: 'name', name: 'Renamed' }]);
  expect(same).toMatchObject({ accepted: true, changed: false });
  expect(owner.getSnapshot().history.past).toHaveLength(1);
});

test('a store that cannot open still opens the door so the draft stays editable and downloadable', () => {
  const { owner } = setup();
  owner.unavailable(new Error('IndexedDB blocked'));
  expect(owner.getSnapshot().ready).toBe(true);
  expect(owner.getSnapshot().error).toContain('IndexedDB blocked');
  expect(owner.submit('Rename', [{ op: 'name', name: 'Offline' }])).toMatchObject({ accepted: true });
});

test('invalid and stale batches are reported with their reason; only invalid ones surface as the design error', async () => {
  const { owner, store } = setup();
  await owner.connect(store, 'design');
  const invalid = owner.submit('Bad move', [{ op: 'move', ids: ['missing'], delta: [1, 0, 0] }]);
  expect(invalid).toEqual({ accepted: false, reason: 'invalid', message: expect.stringContaining('unknown source ID') });
  expect(owner.getSnapshot().error).toContain('unknown source ID');
  const stale = owner.submit('Stale', [{ op: 'name', name: 'Stale' }], 'old-revision');
  expect(stale).toEqual({ accepted: false, reason: 'stale', message: expect.stringContaining('revision changed') });
  owner.submit('Rename', [{ op: 'name', name: 'Fine' }]);
  expect(owner.getSnapshot().error).toBe('');
});

test('adopting the latest parts catalog saves once, reaches every undo state and is not itself undoable', async () => {
  const { owner, store, writes } = setup();
  expect(owner.adoptCatalog('latest-catalog')).toBe(false); // still opening: the door is shut
  await owner.connect(store, 'design');
  owner.submit('Rename', [{ op: 'name', name: 'First' }]);
  expect(owner.adoptCatalog('latest-catalog')).toBe(true);
  expect(owner.adoptCatalog('latest-catalog')).toBe(false);
  await owner.flush();
  expect(writes.at(-1)?.catalogRevision).toBe('latest-catalog');
  owner.undo(); await owner.flush();
  expect(owner.source.name).toBe('Draft'); expect(owner.source.construction.catalogRevision).toBe('latest-catalog');
  owner.redo(); expect(owner.source.construction.catalogRevision).toBe('latest-catalog');
});
