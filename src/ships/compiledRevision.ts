import type { ConstructionResult, ConstructionSource, ConstructionSuggestion } from './blueprint';
import { ConstructionRevisionGate } from './constructionHistory';

export interface BuilderCompiler {
  compile(source: ConstructionSource, signal?: AbortSignal): Promise<ConstructionResult>;
  suggest?(source: ConstructionSource, partIds: string[], signal?: AbortSignal): Promise<ConstructionSuggestion>;
  dispose(): void;
}
/** What the revision owner exposes to compilation: its source, whether it is open yet, and adoption changes. */
export interface CompiledRevisionSource {
  readonly source: ConstructionSource;
  getSnapshot(): { adoption: number; ready: boolean };
  subscribe(listener: () => void): () => void;
}
export interface CompiledRevisionSnapshot {
  /** The result for exactly the owner's source revision and adoption; undefined while it is pending. */
  current?: ConstructionResult;
  /** The last accepted result of this adoption, retained through recompiles for rooms and centers. */
  retained?: ConstructionResult;
  compiling: boolean;
  error: string;
}

/** Compiles the owner's current revision after a short debounce and answers one question: is
 * there a result for exactly what the owner holds now? The acceptance predicate (`isCurrent`)
 * is written once and decides both whether a finished compile is kept and whether the kept
 * result still counts. Adoption of another source discards the retained result; a rejected
 * or superseded compile never replaces it. */
export class CompiledRevision {
  private snapshot: CompiledRevisionSnapshot = { compiling: true, error: '' };
  private listeners = new Set<() => void>();
  private readonly gate = new ConstructionRevisionGate();
  private accepted?: { result: ConstructionResult; adoption: number };
  private key = '';
  private compiling = true;
  private error = '';
  private timer?: ReturnType<typeof setTimeout>;
  private abort?: AbortController;
  private readonly unsubscribe: () => void;

  constructor(private readonly owner: CompiledRevisionSource, private readonly compiler: BuilderCompiler, private readonly delayMs = 40,
    /** Only return results produced by this app for exactly the supplied source, including its catalog. */
    private readonly prepared?: (source: ConstructionSource) => ConstructionResult | undefined) {
    this.unsubscribe = owner.subscribe(this.observe);
    this.observe();
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  /** A detached copy of the current result for callers outside React. */
  read = (): ConstructionResult | undefined => this.snapshot.current && structuredClone(this.snapshot.current);
  retry = () => { this.cancel(); if (this.owner.getSnapshot().ready) this.schedule(); this.refresh(); };
  dispose() { this.unsubscribe(); this.cancel(); this.compiler.dispose(); }

  /** The one acceptance predicate: a result counts only for the adoption, source and revision it compiled. */
  private isCurrent(result: ConstructionResult, adoption: number) {
    const source = this.owner.source;
    return adoption === this.owner.getSnapshot().adoption && result.revision === source.revision && result.sourceId === source.id;
  }
  private observe = () => {
    const { adoption, ready } = this.owner.getSnapshot(), source = this.owner.source;
    if (this.accepted && this.accepted.adoption !== adoption) { this.accepted = undefined; this.error = ''; }
    const key = ready ? `${adoption}:${source.id}:${source.revision}` : '';
    if (key !== this.key) {
      this.key = key; this.cancel();
      if (ready) {
        const result = this.prepared?.(source);
        if (result && this.isCurrent(result, adoption)) {
          this.accepted = { result, adoption }; this.compiling = false; this.error = '';
        } else this.schedule();
      }
    }
    this.refresh();
  };
  private cancel() {
    clearTimeout(this.timer); this.timer = undefined;
    this.abort?.abort(); this.abort = undefined;
    this.gate.invalidate();
  }
  private schedule() {
    const token = this.gate.issue(), abort = new AbortController(), { adoption } = this.owner.getSnapshot(), source = this.owner.source;
    this.abort = abort; this.compiling = true; this.error = '';
    this.timer = setTimeout(() => {
      void this.compiler.compile(source, abort.signal).then(compiled => {
        if (abort.signal.aborted || !this.gate.accepts(token) || !this.isCurrent(compiled, adoption)) return;
        this.accepted = { result: compiled, adoption }; this.compiling = false; this.refresh();
      }).catch(cause => {
        if (abort.signal.aborted || !this.gate.accepts(token)) return;
        this.error = cause instanceof Error ? cause.message : String(cause); this.compiling = false; this.refresh();
      });
    }, this.delayMs);
  }
  private refresh() {
    const retained = this.accepted?.result;
    const current = this.accepted && this.isCurrent(this.accepted.result, this.accepted.adoption) ? this.accepted.result : undefined;
    const previous = this.snapshot;
    if (previous.current === current && previous.retained === retained && previous.compiling === this.compiling && previous.error === this.error) return;
    this.snapshot = { current, retained, compiling: this.compiling, error: this.error };
    for (const listener of this.listeners) listener();
  }
}
