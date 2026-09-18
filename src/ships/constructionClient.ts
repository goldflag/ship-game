import type { ConstructionResult, ConstructionSource, ConstructionSuggestion } from './blueprint';

export interface ConstructionWorker {
  postMessage(message: unknown): void;
  terminate(): void;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}
interface Pending {
  id: number; source: ConstructionSource; type: 'compile' | 'suggest'; partIds: string[];
  settled: boolean;
  resolve(result: ConstructionResult | ConstructionSuggestion): void; reject(error: Error): void;
  cleanup(): void;
}
const cancelled = () => new DOMException('Design compilation cancelled.', 'AbortError');

/** One warm compiler, one active job and at most one queued revision. Superseding
 * an edit rejects its caller but lets native work finish and populate the cache.
 * Only the latest queued edit runs next. Closing/switching designs still stops work. */
export class ConstructionClient {
  private worker?: ConstructionWorker;
  private active?: Pending;
  private queued?: Pending;
  private timer?: ReturnType<typeof setTimeout>;
  private nextId = 0;
  private disposed = false;
  constructor(private readonly createWorker: () => ConstructionWorker = () => new Worker(new URL('./construction.worker.ts', import.meta.url), { type: 'module' }), private readonly timeoutMs = 180_000) {}

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
    if (this.active && (this.active.source.id !== source.id || this.active.source.construction.catalogRevision !== source.construction.catalogRevision)) this.stop(cancelled());
    const input = structuredClone(source), id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const abort = () => {
        if (this.active?.id === id) this.reject(this.active, cancelled());
        if (this.queued?.id === id) { this.reject(this.queued, cancelled()); this.queued = undefined; }
      };
      const pending: Pending = { id, source: input, type, partIds: [...partIds], settled: false, resolve, reject,
        cleanup: () => signal?.removeEventListener('abort', abort) };
      signal?.addEventListener('abort', abort, { once: true });
      if (this.active) this.queued = pending;
      else this.start(pending);
    });
  }
  private start(pending: Pending) {
    this.active = pending;
    this.timer = setTimeout(() => this.fail(new Error('Compilation took too long. Reduce the selected hull section and try again. Your source design is preserved.')), this.timeoutMs);
    try {
      if (!this.worker) {
        const worker = this.worker = this.createWorker();
        worker.onmessage = event => { if (this.worker === worker) this.receive(event.data); };
        worker.onerror = event => { if (this.worker === worker) this.fail(new Error(event.message || 'The design compiler could not start. Reload the builder to retry.')); };
      }
      this.worker.postMessage({ type: pending.type, id: pending.id, source: pending.source, partIds: pending.partIds });
    } catch (error) { this.fail(error instanceof Error ? error : new Error(String(error))); }
  }
  private receive(message: { id: number; result?: ConstructionResult; suggestion?: ConstructionSuggestion; sourceId?: string; revision?: string; error?: string }) {
    const pending = this.active;
    if (!pending || message.id !== pending.id) return;
    const result = pending.type === 'compile' ? message.result : message.suggestion;
    if (message.error || !result) { this.fail(new Error(message.error || 'The compiler returned no design.')); return; }
    if ((message.result?.sourceId ?? message.sourceId) !== pending.source.id || (message.result?.revision ?? message.revision) !== pending.source.revision) {
      this.fail(new Error('The compiler returned a different design revision. Reopen the design to retry.')); return;
    }
    this.active = undefined; clearTimeout(this.timer); pending.cleanup();
    if (!pending.settled) { pending.settled = true; pending.resolve(result); }
    this.advance();
  }
  private reject(pending: Pending | undefined, error: Error) {
    if (pending && !pending.settled) { pending.settled = true; pending.cleanup(); pending.reject(error); }
  }
  private advance() {
    const next = this.queued; this.queued = undefined;
    if (next) this.start(next);
  }
  private fail(error: Error) {
    this.reject(this.active, error); this.active = undefined; clearTimeout(this.timer);
    this.worker?.terminate(); this.worker = undefined;
    this.advance();
  }
  private stop(error: Error) {
    this.reject(this.queued, error); this.queued = undefined;
    this.fail(error);
  }
  cancel() {
    this.reject(this.active, cancelled());
    this.reject(this.queued, cancelled()); this.queued = undefined;
  }
  dispose() { this.disposed = true; this.stop(cancelled()); }
}
