import { expect, test } from 'bun:test';
import { ConstructionClient, type ConstructionWorker } from './constructionClient';
import { createStarterSource } from './constructionStarter';
import catalog from '../../public/models/components/catalog.json';
import type { ConstructionCatalog, ConstructionResult } from './blueprint';

class WorkerDouble implements ConstructionWorker {
  onmessage: ConstructionWorker['onmessage'] = null; onerror: ConstructionWorker['onerror'] = null;
  messages: any[] = []; terminated = false;
  postMessage(message: unknown) { this.messages.push(message); }
  terminate() { this.terminated = true; }
  reply(result: ConstructionResult) { this.onmessage?.({ data: { id: this.messages.at(-1).id, result } } as MessageEvent); }
}
test('switching designs terminates the old compile and its late events cannot stop the replacement', async () => {
  const workers: WorkerDouble[] = [], client = new ConstructionClient(() => { const worker = new WorkerDouble(); workers.push(worker); return worker; });
  const source = createStarterSource(catalog as ConstructionCatalog, 'blank');
  const old = client.compile(source).catch(error => error);
  const nextSource = { ...source, id: 'another-design', revision: 'next' }, next = client.compile(nextSource);
  expect(workers[0].terminated).toBe(true); expect((await old).name).toBe('AbortError');
  workers[0].onerror?.({ message: 'Late failure from old worker' } as ErrorEvent);
  const result: ConstructionResult = { sourceId: nextSource.id, revision: nextSource.revision, contentHash: 'compiled', surfaces: [], diagnostics: [] };
  workers[0].reply({ ...result, revision: source.revision }); workers[1].reply(result);
  expect(await next).toEqual(result); expect(workers[1].terminated).toBe(false); client.dispose();
});

test('rapid edits retain the warm worker and compile only the newest queued revision', async () => {
  const workers: WorkerDouble[] = [], client = new ConstructionClient(() => { const worker = new WorkerDouble(); workers.push(worker); return worker; });
  const source = createStarterSource(catalog as ConstructionCatalog, 'blank');
  const first = client.compile(source).catch(error => error);
  const second = client.compile({ ...source, revision: 'second' }).catch(error => error);
  const latest = { ...source, revision: 'latest' }, next = client.compile(latest);
  expect((await first).name).toBe('AbortError'); expect((await second).name).toBe('AbortError');
  expect(workers).toHaveLength(1); expect(workers[0].terminated).toBe(false); expect(workers[0].messages).toHaveLength(1);
  const result: ConstructionResult = { sourceId: source.id, revision: source.revision, contentHash: 'compiled', surfaces: [], diagnostics: [] };
  workers[0].reply(result);
  expect(workers[0].messages).toHaveLength(2); expect(workers[0].messages[1].source.revision).toBe('latest');
  workers[0].onmessage?.({ data: { id: workers[0].messages[0].id, result } } as MessageEvent);
  workers[0].reply({ ...result, revision: 'latest' });
  expect((await next).revision).toBe('latest'); client.dispose(); expect(workers[0].terminated).toBe(true);
});

test('abort detaches its caller and an aborted queued edit is never dispatched', async () => {
  const worker = new WorkerDouble(), client = new ConstructionClient(() => worker);
  const source = createStarterSource(catalog as ConstructionCatalog, 'blank');
  const abort = new AbortController(), first = client.compile(source, abort.signal).catch(error => error);
  abort.abort(); expect((await first).name).toBe('AbortError'); expect(worker.terminated).toBe(false);
  const queuedAbort = new AbortController(), queued = client.compile({ ...source, revision: 'second' }, queuedAbort.signal).catch(error => error);
  queuedAbort.abort(); expect((await queued).name).toBe('AbortError');
  worker.reply({ sourceId: source.id, revision: source.revision, contentHash: 'compiled', surfaces: [], diagnostics: [] });
  expect(worker.messages).toHaveLength(1); client.dispose();
});

test('a failed obsolete job restarts the latest queued request in a fresh worker', async () => {
  const workers: WorkerDouble[] = [], client = new ConstructionClient(() => { const worker = new WorkerDouble(); workers.push(worker); return worker; });
  const source = createStarterSource(catalog as ConstructionCatalog, 'blank');
  const first = client.compile(source).catch(error => error);
  const next = client.compile({ ...source, revision: 'latest' }); await first;
  workers[0].onerror?.({ message: 'Worker failed' } as ErrorEvent);
  expect(workers[0].terminated).toBe(true); expect(workers).toHaveLength(2);
  workers[1].reply({ sourceId: source.id, revision: 'latest', contentHash: 'compiled', surfaces: [], diagnostics: [] });
  expect((await next).revision).toBe('latest'); client.dispose();
});
test('input is detached and mismatched result identities cannot become previews', async () => {
  const worker = new WorkerDouble(), client = new ConstructionClient(() => worker);
  const source = createStarterSource(catalog as ConstructionCatalog, 'blank');
  const pending = client.compile(source).catch(error => error);
  source.name = 'Changed after submission';
  expect(worker.messages[0].source.name).not.toBe(source.name);
  worker.reply({ sourceId: 'another-source', revision: source.revision, contentHash: 'wrong', surfaces: [], diagnostics: [] });
  expect((await pending).message).toContain('different design revision'); expect(worker.terminated).toBe(true); client.dispose();
});

test('closing rejects both active and queued callers and prevents subsequent requests', async () => {
  const worker = new WorkerDouble(), client = new ConstructionClient(() => worker);
  const source = createStarterSource(catalog as ConstructionCatalog, 'blank');
  const active = client.compile(source).catch(error => error);
  const queued = client.compile({ ...source, revision: 'next' }).catch(error => error);
  client.dispose();
  expect((await active).name).toBe('AbortError'); expect((await queued).name).toBe('AbortError');
  expect(worker.terminated).toBe(true); expect(worker.messages).toHaveLength(1);
  await expect(client.compile(source)).rejects.toThrow('closed');
});

test('an obsolete job cannot hold the newest revision past its deadline', async () => {
  const workers: WorkerDouble[] = [], client = new ConstructionClient(() => { const worker = new WorkerDouble(); workers.push(worker); return worker; }, 20);
  const source = createStarterSource(catalog as ConstructionCatalog, 'blank');
  const active = client.compile(source).catch(error => error);
  const next = client.compile({ ...source, revision: 'next' }); await active;
  await new Promise(resolve => setTimeout(resolve, 25));
  expect(workers[0].terminated).toBe(true); expect(workers).toHaveLength(2);
  workers[1].reply({ sourceId: source.id, revision: 'next', contentHash: 'compiled', surfaces: [], diagnostics: [] });
  expect((await next).revision).toBe('next'); client.dispose();
});
