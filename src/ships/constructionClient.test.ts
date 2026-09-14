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
test('a superseded synchronous compile is terminated and its late events cannot stop the replacement', async () => {
  const workers: WorkerDouble[] = [], client = new ConstructionClient(() => { const worker = new WorkerDouble(); workers.push(worker); return worker; });
  const source = createStarterSource(catalog as ConstructionCatalog, 'blank');
  const old = client.compile(source).catch(error => error);
  const nextSource = { ...source, revision: 'next' }, next = client.compile(nextSource);
  expect(workers[0].terminated).toBe(true); expect((await old).name).toBe('AbortError');
  workers[0].onerror?.({ message: 'Late failure from old worker' } as ErrorEvent);
  const result: ConstructionResult = { sourceId: source.id, revision: nextSource.revision, contentHash: 'compiled', surfaces: [], diagnostics: [] };
  workers[0].reply({ ...result, revision: source.revision }); workers[1].reply(result);
  expect(await next).toEqual(result); expect(workers[1].terminated).toBe(false); client.dispose();
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
