import type { ConstructionResult, ConstructionSource, ConstructionSuggestion } from './blueprint';

export interface ConstructionWorker {
  postMessage(message: unknown): void;
  terminate(): void;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}
interface Pending {
  id: number; sourceId: string; revision: string;
  resolve(result: ConstructionResult | ConstructionSuggestion): void; reject(error: Error): void;
  cleanup(): void;
}
const cancelled = () => new DOMException('Design compilation cancelled.', 'AbortError');

/** One bounded compiler per editor. Replacing an in-flight revision terminates
 * its worker, including synchronous WASM work, before starting the new revision. */
export class ConstructionClient {
  private worker?: ConstructionWorker;
  private pending?: Pending;
  private nextId = 0;
  private disposed = false;
  constructor(private readonly createWorker: () => ConstructionWorker = () => new Worker(new URL('./construction.worker.ts', import.meta.url), { type: 'module' })) {}

  compile(source: ConstructionSource, signal?: AbortSignal): Promise<ConstructionResult> {
    return this.request(source, 'compile', [], signal) as Promise<ConstructionResult>;
  }
  suggest(source: ConstructionSource, partIds: string[], signal?: AbortSignal): Promise<ConstructionSuggestion> {
    return this.request(source, 'suggest', partIds, signal) as Promise<ConstructionSuggestion>;
  }
  private request(source: ConstructionSource, type: 'compile' | 'suggest', partIds: string[], signal?: AbortSignal): Promise<ConstructionResult | ConstructionSuggestion> {
    if (this.disposed) return Promise.reject(new Error('The shipbuilder has closed.'));
    this.cancel();
    if (signal?.aborted) return Promise.reject(cancelled());
    const input = structuredClone(source);
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const abort = () => { if (this.pending?.id === id) this.cancel(); };
      const timer = setTimeout(() => this.stop(new Error('Compilation took too long. Reduce the selected hull section and try again. Your source design is preserved.')), 45_000);
      this.pending = { id, sourceId: input.id, revision: input.revision, resolve, reject,
        cleanup: () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); } };
      signal?.addEventListener('abort', abort, { once: true });
      try {
        if (!this.worker) {
          const worker = this.worker = this.createWorker();
          worker.onmessage = event => { if (this.worker === worker) this.receive(event.data); };
          worker.onerror = event => { if (this.worker === worker) this.stop(new Error(event.message || 'The design compiler could not start. Reload the builder to retry.')); };
        }
        this.worker.postMessage({ type, id, source: input, partIds });
      } catch (error) { this.stop(error instanceof Error ? error : new Error(String(error))); }
    });
  }
  private receive(message: { id: number; result?: ConstructionResult; suggestion?: ConstructionSuggestion; sourceId?: string; revision?: string; error?: string }) {
    const pending = this.pending;
    if (!pending || message.id !== pending.id) return;
    const result = message.result ?? message.suggestion;
    if (message.error || !result) { this.stop(new Error(message.error || 'The compiler returned no design.')); return; }
    if ((message.result?.sourceId ?? message.sourceId) !== pending.sourceId || (message.result?.revision ?? message.revision) !== pending.revision) {
      this.stop(new Error('The compiler returned a different design revision. Reopen the design to retry.')); return;
    }
    this.pending = undefined; pending.cleanup(); pending.resolve(result);
  }
  private stop(error: Error) {
    const pending = this.pending; this.pending = undefined;
    this.worker?.terminate(); this.worker = undefined;
    if (pending) { pending.cleanup(); pending.reject(error); }
  }
  cancel() { if (this.pending) this.stop(cancelled()); }
  dispose() { this.disposed = true; this.stop(cancelled()); }
}
