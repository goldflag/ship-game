/** One owned, serialized worker. Replies correlate by order: only one operation
 * may be pending, and abandoning a reply permanently retires its worker. */
export class LocalWorkerOperation {
  private pending?: { fail(error: Error): void };
  private closed = false;
  get usable() { return !this.closed; }
  get idle() { return this.usable && !this.pending; }
  constructor(readonly worker: Worker) {}
  request<T>(message: object, receive: (data: any) => T | undefined, timeout: number, timeoutMessage: string, signal?: AbortSignal): Promise<T> {
    if (this.closed || this.pending) return Promise.reject(new Error('Battle worker is unavailable.'));
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer); signal?.removeEventListener('abort', abort);
        this.worker.onmessage = null; this.worker.onerror = null; this.pending = undefined;
      };
      const fail = (error: Error, retire = true) => { cleanup(); if (retire) this.terminate(); reject(error); };
      const abort = () => fail(new Error('Mission preparation cancelled.'));
      const timer = setTimeout(() => fail(new Error(timeoutMessage)), timeout);
      this.pending = { fail };
      this.worker.onerror = event => fail(new Error(event.message));
      this.worker.onmessage = event => {
        if (!this.pending) return;
        if (event.data.type === 'error') { fail(new Error(event.data.message), false); return; }
        try {
          const value = receive(event.data);
          if (value !== undefined) { cleanup(); resolve(value); }
        } catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
      };
      if (signal?.aborted) { abort(); return; }
      signal?.addEventListener('abort', abort, { once: true });
      try { this.worker.postMessage(message); } catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
    });
  }
  /** Only a completed operation can surrender its worker to another owner. */
  transfer(): Worker {
    if (!this.idle) throw new Error('Battle worker is unavailable.');
    this.closed = true;
    return this.worker;
  }
  terminate(): void {
    if (this.closed) return;
    this.closed = true;
    this.worker.terminate();
    this.pending?.fail(new Error('Mission closed.'));
  }
}
