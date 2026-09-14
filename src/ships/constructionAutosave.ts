import type { ConstructionRevision, ConstructionStore, SaveConstructionSource } from './constructionStore';

export type ConstructionSaveDraft = Omit<SaveConstructionSource, 'expectedRevisionId'>;
export type ConstructionSaveState = { status: 'saving' | 'saved' | 'error'; token: number; revision?: ConstructionRevision; error?: Error };

/** Serializes writes, coalesces pending edits and never advances the head after a failed transaction. */
export class ConstructionAutosave {
  private pending?: { draft: ConstructionSaveDraft; token: number };
  private running?: Promise<void>;
  private error?: Error;
  private token = 0;
  private disposed = false;

  constructor(
    private readonly store: Pick<ConstructionStore, 'save'>,
    private revisionId: string | null,
    private readonly onState: (state: ConstructionSaveState) => void = () => {},
  ) {}

  get unsaved(): boolean { return !!this.pending || !!this.running || !!this.error; }
  get headRevisionId(): string | null { return this.revisionId; }

  enqueue(draft: ConstructionSaveDraft): void {
    if (this.disposed) return;
    this.pending = { draft: structuredClone(draft), token: ++this.token };
    this.onState({ status: 'saving', token: this.token });
    if (!this.error) this.start();
  }

  async flush(): Promise<void> {
    if (this.disposed) return;
    this.start();
    while (this.running) await this.running;
    if (this.error) throw this.error;
  }

  async retry(): Promise<void> { this.error = undefined; await this.flush(); }

  /** Call only after flush or after the user has retained the unsaved draft. */
  dispose(): void { this.disposed = true; this.pending = undefined; }

  private start(): void {
    if (this.running || this.error || this.disposed || !this.pending) return;
    this.running = this.drain().finally(() => { this.running = undefined; this.start(); });
  }

  private async drain(): Promise<void> {
    while (this.pending && !this.disposed) {
      const item = this.pending;
      this.pending = undefined;
      try {
        const revision = await this.store.save({ ...item.draft, expectedRevisionId: this.revisionId });
        this.revisionId = revision.id;
        if (!this.disposed) this.onState({ status: this.pending ? 'saving' : 'saved', token: item.token, revision });
      } catch (cause) {
        this.error = cause instanceof Error ? cause : new Error(String(cause));
        this.pending ??= item;
        if (!this.disposed) this.onState({ status: 'error', token: this.pending.token, error: this.error });
        return;
      }
    }
  }
}
