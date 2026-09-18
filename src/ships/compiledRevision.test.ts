import { expect, test } from 'bun:test';
import type { ConstructionResult, ConstructionSource } from './blueprint';
import { CompiledRevision, type BuilderCompiler } from './compiledRevision';

const source = (id = 'design', revision = 'r1'): ConstructionSource => ({ schemaVersion: 1, id, revision, name: 'Draft', coordinates: 'meters-y-up-bow-negative-z', construction: { version: 1, catalogRevision: 'catalog', defaultThicknessMm: 12, primitives: [], surfaces: [], equipment: [], boundaries: [], loads: [] } });
const result = (sourceId: string, revision: string): ConstructionResult => ({ sourceId, revision, contentHash: `${sourceId}:${revision}`, surfaces: [], diagnostics: [] });
const tick = () => new Promise(resolve => setTimeout(resolve, 5));

/** A stand-in for the revision owner: the source, adoption and readiness under test control. */
function owner(initial = source()) {
  const listeners = new Set<() => void>();
  let snapshot = { adoption: 0, ready: true }, current = initial;
  const notify = () => { for (const listener of listeners) listener(); };
  return {
    get source() { return current; },
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    edit(revision: string) { current = { ...current, revision }; notify(); },
    adopt(next: ConstructionSource) { current = next; snapshot = { ...snapshot, adoption: snapshot.adoption + 1 }; notify(); },
    ready(ready: boolean) { snapshot = { ...snapshot, ready }; notify(); },
  };
}
/** A compiler whose answers the test hands out, so late and wrong results can be replayed. */
function compiler(answer: (source: ConstructionSource) => Promise<ConstructionResult> = async s => result(s.id, s.revision)) {
  const compiled: string[] = [];
  let disposed = 0;
  const client: BuilderCompiler = { compile: (s) => { compiled.push(s.revision); return answer(s); }, dispose: () => { disposed++; } };
  return { client, compiled, disposed: () => disposed };
}
function deferred<T>() { let resolve!: (value: T) => void, reject!: (cause: unknown) => void; const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; }

test('the current result exists only for the exact revision; an edit hides it while a recompile runs and retains it for display', async () => {
  const design = owner(), { client, compiled } = compiler();
  const revision = new CompiledRevision(design, client, 0);
  expect(revision.getSnapshot()).toMatchObject({ compiling: true, error: '' });
  await tick();
  expect(revision.getSnapshot().current?.revision).toBe('r1');
  expect(revision.getSnapshot().compiling).toBe(false);
  expect(revision.read()).toEqual(result('design', 'r1'));
  expect(revision.read()).not.toBe(revision.getSnapshot().current);
  design.edit('r2');
  expect(revision.getSnapshot().current).toBeUndefined();
  expect(revision.getSnapshot().retained?.revision).toBe('r1');
  expect(revision.getSnapshot().retainedSource?.revision).toBe('r1');
  expect(revision.getSnapshot().compiling).toBe(true);
  await tick();
  expect(revision.getSnapshot().current?.revision).toBe('r2');
  expect(compiled).toEqual(['r1', 'r2']);
  revision.dispose();
});

test('a compile that finishes after a newer edit is dropped and never becomes current', async () => {
  const design = owner(), first = deferred<ConstructionResult>();
  let slow = true;
  const { client } = compiler(async s => slow ? first.promise : result(s.id, s.revision));
  const revision = new CompiledRevision(design, client, 0);
  await tick();
  slow = false; design.edit('r2');
  await tick();
  expect(revision.getSnapshot().current?.revision).toBe('r2');
  first.resolve(result('design', 'r1'));
  await tick();
  expect(revision.getSnapshot().current?.revision).toBe('r2');
  expect(revision.getSnapshot().retained?.revision).toBe('r2');
  revision.dispose();
});

test('a result for the wrong source or a stale revision is rejected even when the gate still accepts it', async () => {
  const design = owner();
  const answers = [result('other-design', 'r1'), result('design', 'r0'), result('design', 'r1')];
  const { client } = compiler(async () => answers.shift()!);
  const revision = new CompiledRevision(design, client, 0);
  await tick();
  expect(revision.getSnapshot().current).toBeUndefined();
  expect(revision.getSnapshot().compiling).toBe(true);
  revision.retry(); await tick();
  expect(revision.getSnapshot().current).toBeUndefined();
  revision.retry(); await tick();
  expect(revision.getSnapshot().current?.revision).toBe('r1');
  revision.dispose();
});

test('adopting another source supersedes an in-flight compile and discards the retained result', async () => {
  const design = owner(), pending = deferred<ConstructionResult>();
  let hold = false;
  const { client } = compiler(async s => hold ? pending.promise : result(s.id, s.revision));
  const revision = new CompiledRevision(design, client, 0);
  await tick();
  expect(revision.getSnapshot().retained?.revision).toBe('r1');
  hold = true; design.edit('r2'); await tick();
  design.adopt(source('recovered', 'x1'));
  expect(revision.getSnapshot().retained).toBeUndefined();
  expect(revision.getSnapshot().current).toBeUndefined();
  pending.resolve(result('design', 'r2'));
  await tick();
  expect(revision.getSnapshot().current).toBeUndefined();
  hold = false; revision.retry(); await tick();
  expect(revision.getSnapshot().current?.sourceId).toBe('recovered');
  revision.dispose();
});

test('compiling waits for the owner to open, reports failures, retries on demand and disposes the compiler once', async () => {
  const design = owner(); design.ready(false);
  let fail = true;
  const { client, compiled, disposed } = compiler(async s => { if (fail) throw new Error('worker lost'); return result(s.id, s.revision); });
  const revision = new CompiledRevision(design, client, 0);
  await tick();
  expect(compiled).toEqual([]);
  expect(revision.getSnapshot().compiling).toBe(true);
  design.ready(true); await tick();
  expect(revision.getSnapshot()).toMatchObject({ compiling: false, error: 'worker lost' });
  fail = false; revision.retry();
  expect(revision.getSnapshot()).toMatchObject({ compiling: true, error: '' });
  await tick();
  expect(revision.getSnapshot().current?.revision).toBe('r1');
  revision.dispose();
  expect(disposed()).toBe(1);
  design.edit('r3'); await tick();
  expect(compiled).toEqual(['r1', 'r1']);
});

test('rapid edits within the debounce compile once, for the last revision', async () => {
  const design = owner(), { client, compiled } = compiler();
  const revision = new CompiledRevision(design, client, 20);
  design.edit('r2'); design.edit('r3');
  await new Promise(resolve => setTimeout(resolve, 60));
  expect(compiled).toEqual(['r3']);
  expect(revision.getSnapshot().current?.revision).toBe('r3');
  revision.dispose();
});

test('normal consecutive placements wait for a full pause and compile only the final revision', async () => {
  const design = owner(), { client, compiled } = compiler();
  const revision = new CompiledRevision(design, client);
  try {
    await new Promise(resolve => setTimeout(resolve, 60));
    expect(compiled).toEqual(['r1']);
    expect(revision.getSnapshot().waiting).toBe(false);
    for (let i = 2; i <= 7; i++) {
      design.edit(`r${i}`);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    expect(compiled).toEqual(['r1']);
    expect(revision.getSnapshot().current).toBeUndefined();
    expect(revision.getSnapshot().waiting).toBe(true);
    expect(revision.getSnapshot().retained?.revision).toBe('r1');
    await new Promise(resolve => setTimeout(resolve, 800));
    expect(compiled).toEqual(['r1']);
    await new Promise(resolve => setTimeout(resolve, 200));
    expect(compiled).toEqual(['r1', 'r7']);
    expect(revision.getSnapshot().current?.revision).toBe('r7');
    expect(revision.getSnapshot().waiting).toBe(false);
  } finally { revision.dispose(); }
});

test('opening another design and explicit retry bypass the edit pause; disposal cancels a pending edit', async () => {
  const design = owner(), { client, compiled } = compiler();
  const revision = new CompiledRevision(design, client, 100);
  await tick();
  expect(compiled).toEqual(['r1']);
  design.edit('r2');
  expect(revision.getSnapshot().waiting).toBe(true);
  revision.retry(); await tick();
  expect(compiled).toEqual(['r1', 'r2']);
  design.edit('r3');
  design.adopt(source('other', 'x1'));
  expect(revision.getSnapshot().retainedSource).toBeUndefined();
  expect(revision.getSnapshot().waiting).toBe(false);
  await tick();
  expect(revision.getSnapshot().current?.sourceId).toBe('other');
  design.edit('x2'); revision.dispose();
  await new Promise(resolve => setTimeout(resolve, 150));
  expect(compiled).toEqual(['r1', 'r2', 'x1']);
});

test('editing during a running compile aborts its caller and waits again before submitting the latest source', async () => {
  const design = owner(), pending = deferred<ConstructionResult>();
  const calls: { revision: string; signal?: AbortSignal }[] = [];
  const revision = new CompiledRevision(design, {
    compile: (s, signal) => { calls.push({ revision: s.revision, signal }); return s.revision === 'r1' ? pending.promise : Promise.resolve(result(s.id, s.revision)); },
    dispose() {},
  }, 100);
  await tick();
  design.edit('r2');
  expect(calls[0].signal?.aborted).toBe(true);
  pending.resolve(result('design', 'r1')); await tick();
  expect(revision.getSnapshot().current).toBeUndefined();
  expect(revision.getSnapshot().waiting).toBe(true);
  design.edit('r3'); await tick();
  expect(calls.map(call => call.revision)).toEqual(['r1']);
  await new Promise(resolve => setTimeout(resolve, 150));
  expect(calls.map(call => call.revision)).toEqual(['r1', 'r3']);
  expect(revision.getSnapshot().current?.revision).toBe('r3');
  revision.dispose();
});

test('opening a prepared revision reuses it through storage adoption, then compiles edits normally', async () => {
  const initial = source(), design = owner(initial), { client, compiled } = compiler();
  design.ready(false);
  const prepared = result(initial.id, initial.revision);
  const revision = new CompiledRevision(design, client, 0, input => JSON.stringify(input) === JSON.stringify(initial) ? prepared : undefined);
  design.adopt(structuredClone(initial)); design.ready(true);
  expect(revision.getSnapshot()).toMatchObject({ current: prepared, retained: prepared, compiling: false });
  await tick(); expect(compiled).toEqual([]);
  design.edit('r2');
  expect(revision.getSnapshot().current).toBeUndefined();
  expect(revision.getSnapshot().retained).toBe(prepared);
  await tick(); expect(compiled).toEqual(['r2']);
  revision.dispose();
});

test('a prepared result with mismatched identity is ignored', async () => {
  const design = owner(), { client, compiled } = compiler();
  const revision = new CompiledRevision(design, client, 0, () => result('other', 'r1'));
  expect(revision.getSnapshot().current).toBeUndefined();
  await tick(); expect(compiled).toEqual(['r1']);
  expect(revision.getSnapshot().current?.sourceId).toBe('design');
  revision.dispose();
});
