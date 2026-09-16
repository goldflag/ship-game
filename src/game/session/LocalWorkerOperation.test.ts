import { expect, test } from 'bun:test';
import { LocalWorkerOperation } from './LocalWorkerOperation';

class WorkerStub {
  onmessage: ((event: { data: any }) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;
  terminated = 0;
  posts = 0;
  postMessage() { this.posts++; }
  terminate() { this.terminated++; }
  reply(data: any) { this.onmessage?.({ data }); }
}
const receive = (data: any) => data.type === 'validated' ? true : undefined;
test('timeout retires worker and ignores delayed reply or error', async () => {
  const worker = new WorkerStub(), operation = new LocalWorkerOperation(worker as unknown as Worker);
  let deadline!: () => void;
  const originalTimer = globalThis.setTimeout;
  globalThis.setTimeout = ((callback: () => void) => { deadline = callback; return originalTimer(() => {}, 60000); }) as typeof setTimeout;
  const request = operation.request({}, receive, 30000, 'Timed out.');
  globalThis.setTimeout = originalTimer;
  const lateReply = worker.onmessage!;
  deadline(); await expect(request).rejects.toThrow('Timed out.');
  lateReply({ data: { type: 'error', message: 'Late error' } });
  lateReply({ data: { type: 'validated' } });
  expect(operation.usable).toBe(false);
  expect(worker.terminated).toBe(1);
  expect(() => operation.transfer()).toThrow('unavailable');
});
test('ordinary rejected placement keeps worker reusable and overlapping requests cannot replace handlers', async () => {
  const worker = new WorkerStub(), operation = new LocalWorkerOperation(worker as unknown as Worker);
  const first = operation.request({}, receive, 30000, 'Timed out.');
  await expect(operation.request({}, receive, 30000, 'Timed out.')).rejects.toThrow('unavailable');
  worker.reply({ type: 'error', message: 'Invalid placement' });
  await expect(first).rejects.toThrow('Invalid placement');
  expect(operation.idle).toBe(true);
  const next = operation.request({}, receive, 30000, 'Timed out.');
  worker.reply({ type: 'validated' }); await next;
  expect(operation.transfer()).toBe(worker as unknown as Worker);
  expect(worker.terminated).toBe(0);
});
test('abort settles once, retires worker, and never posts an already-aborted request', async () => {
  for (const before of [true, false]) {
    const worker = new WorkerStub(), operation = new LocalWorkerOperation(worker as unknown as Worker), controller = new AbortController();
    if (before) controller.abort();
    const request = operation.request({}, receive, 30000, 'Timed out.', controller.signal);
    controller.abort(); await expect(request).rejects.toThrow('cancelled');
    operation.terminate();
    expect(worker.terminated).toBe(1);
    expect(worker.posts).toBe(before ? 0 : 1);
  }
});
