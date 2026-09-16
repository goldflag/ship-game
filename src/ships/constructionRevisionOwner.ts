import type { ConstructionSource } from './blueprint';
import { ConstructionAutosave, type ConstructionSaveState } from './constructionAutosave';
import { applyConstructionBatch, type ConstructionBatch } from './constructionCommands';
import { decodeConstructionSource, loadSavedConstructionWithCatalog, newConstructionId } from './constructionEditor';
import { createConstructionHistory, editConstruction, redoConstruction, undoConstruction, type ConstructionHistory } from './constructionHistory';
import { ConstructionStoreError, type ConstructionRevision, type ConstructionStore, type SaveConstructionSource } from './constructionStore';

export type ConstructionHead = { kind: 'new' } | { kind: 'saved'; revisionId: string } | { kind: 'rejected'; revisionId: string };
type LoadedConstruction = Pick<Awaited<ReturnType<typeof loadSavedConstructionWithCatalog>>, 'source' | 'head' | 'revision'>;
export interface ConstructionRevisionSnapshot {
  history: ConstructionHistory<ConstructionSource>;
  head: ConstructionHead;
  saveState: ConstructionSaveState;
  error: string;
  /** Changes when an external source is adopted, including same-design recovery. */
  adoption: number;
}
interface RevisionOwnerOptions {
  retainRecovery(input: SaveConstructionSource): Promise<unknown>;
  onSave?(source: ConstructionSource): void;
  load?(store: ConstructionStore, id: string): Promise<LoadedConstruction>;
  savedDesignId?(sourceId: string): string | undefined;
}

/** Owns editable revisions and their CAS writer independently of React render timing. */
export class ConstructionRevisionOwner {
  private snapshot: ConstructionRevisionSnapshot;
  private listeners = new Set<() => void>();
  private store?: ConstructionStore;
  private saver?: ConstructionAutosave;
  private lastQueued = '';
  private generation = 0;
  private checking = false;
  private recovery = Promise.resolve();
  private readonly load: NonNullable<RevisionOwnerOptions['load']>;

  constructor(source: ConstructionSource, private readonly options: RevisionOwnerOptions) {
    this.snapshot = { history: createConstructionHistory(source), head: { kind: 'new' }, saveState: { status: 'saving', token: 0 }, error: '', adoption: 0 };
    this.load = options.load ?? loadSavedConstructionWithCatalog;
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  get source() { return this.snapshot.history.source; }
  get unsaved() { return !!this.saver?.unsaved || this.lastQueued !== this.source.revision; }
  setError = (error: string) => this.update({ error });
  private update(patch: Partial<ConstructionRevisionSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }

  /** Store opening/closing belongs to the adapter; saved sources resolve their exact catalog here. */
  async connect(store: ConstructionStore, initialDesignId?: string, returnedSource = false): Promise<void> {
    const generation = ++this.generation;
    this.store = store;
    try {
      if (initialDesignId || returnedSource) {
        const loaded = await this.load(store, initialDesignId ?? this.source.id);
        if (generation !== this.generation) return;
        if (initialDesignId || JSON.stringify(loaded.source) === JSON.stringify(this.source)) {
          this.adopt(loaded.source, { kind: 'saved', revisionId: loaded.head.revisionId }, true, undefined, loaded.revision);
          return;
        }
        this.update({ head: { kind: 'rejected', revisionId: loaded.head.revisionId } });
      }
    } catch (cause) {
      if (generation !== this.generation) return;
      if (initialDesignId || (cause as { code?: string }).code !== 'not-found') this.setError(message(cause));
    }
    if (generation !== this.generation) return;
    this.createWriter();
    this.enqueue();
  }

  disconnect() {
    this.generation++;
    if (this.saver?.unsaved) this.lastQueued = '';
    this.saver?.dispose(); this.saver = undefined; this.store = undefined;
  }
  unavailable(cause: unknown) { this.update({ error: message(cause), saveState: { status: 'error', token: 0, error: new Error(message(cause)) } }); }

  private createWriter() {
    this.saver?.dispose();
    if (!this.store) return;
    const head = this.snapshot.head;
    const store = head.kind === 'rejected' ? { save: async () => { throw new ConstructionStoreError('conflict', 'This source differs from the saved revision. Download a backup, reload the saved source, or save a copy.'); } } : this.store;
    const generation = this.generation;
    this.saver = new ConstructionAutosave({ save: async input => {
      // Cloud acknowledgement removes recovery: retention must finish before that save begins.
      const retained = this.recovery;
      await retained;
      if (generation !== this.generation) throw new ConstructionStoreError('conflict', 'The active design changed before this save began.');
      return store.save(input);
    } }, head.kind === 'new' ? null : head.revisionId, state => {
      this.update({ saveState: state, ...(state.error ? { error: state.error.message } : {}), ...(state.revision ? { head: { kind: 'saved', revisionId: state.revision.id } as ConstructionHead } : {}) });
      if (state.revision) {
        try { this.options.onSave?.(decodeConstructionSource(JSON.parse(state.revision.sourceJson))); }
        catch (cause) { this.setError(`Source saved, but the local fleet list could not refresh: ${message(cause)}`); }
      }
    });
  }

  private enqueue() {
    if (!this.saver || this.lastQueued === this.source.revision) return;
    const source = structuredClone(this.source), head = this.snapshot.head;
    const draft = { designId: source.id, name: source.name, source, schemaVersion: source.schemaVersion, catalogRevision: source.construction.catalogRevision };
    const generation = this.generation;
    // Serialize retention so an older asynchronous IndexedDB open cannot overwrite a newer draft.
    this.recovery = this.recovery.then(() => this.options.retainRecovery({ ...draft, expectedRevisionId: head.kind === 'new' ? null : head.revisionId })).then(() => {}, cause => {
      if (generation === this.generation) this.setError(`Draft recovery unavailable: ${message(cause)}`);
    });
    this.lastQueued = source.revision;
    this.saver.enqueue(draft);
  }
  private change(history: ConstructionHistory<ConstructionSource>) {
    if (history === this.snapshot.history) return;
    this.update({ history });
    this.enqueue();
  }
  edit = (label: string, command: (draft: ConstructionSource) => void) => {
    const current = this.source;
    this.change(editConstruction(this.snapshot.history, label, draft => {
      command(draft);
      if (JSON.stringify(draft) !== JSON.stringify(current)) draft.revision = newConstructionId('revision');
    }));
  };
  applyBatch = (batch: ConstructionBatch) => {
    const next = applyConstructionBatch(this.source, batch);
    this.change(editConstruction(this.snapshot.history, batch.label, draft => Object.assign(draft, next)));
    return structuredClone(next);
  };
  undo = () => this.travel(undoConstruction(this.snapshot.history));
  redo = () => this.travel(redoConstruction(this.snapshot.history));
  private travel(next: ConstructionHistory<ConstructionSource>) {
    if (next !== this.snapshot.history) this.change({ ...next, source: { ...next.source, revision: newConstructionId('revision') } });
  }
  flush = async () => {
    if (!this.saver) throw new Error('Saving is unavailable. Download this source before closing.');
    try { await this.saver.flush(); }
    finally { await this.recovery; }
  };
  retrySave = async () => { await this.saver?.retry(); };

  private adopt(next: ConstructionSource, head: ConstructionHead, saved: boolean, label?: string, revision?: ConstructionRevision) {
    this.generation++;
    this.saver?.dispose();
    this.lastQueued = saved ? next.revision : '';
    const history = label ? editConstruction(this.snapshot.history, label, draft => Object.assign(draft, next)) : createConstructionHistory(next);
    this.update({ history, head, error: '', saveState: { status: saved ? 'saved' : 'saving', token: 0, revision }, adoption: this.snapshot.adoption + 1 });
    this.createWriter();
    this.enqueue();
  }
  replace = async (next: ConstructionSource, revisionId: string | null, saved: boolean, retainDraft = false) => {
    const generation = this.generation, source = this.source;
    if (!retainDraft) await this.flush();
    else await this.recovery;
    this.requireCurrent(generation, source);
    this.adopt(next, revisionId === null ? { kind: 'new' } : { kind: 'saved', revisionId }, saved);
  };
  async removeDesign(designId: string, revisionId: string, replacement: ConstructionSource) {
    if (!this.store) throw new Error('Local storage is unavailable. Retry when browser storage is available.');
    const generation = this.generation, source = this.source, store = this.store;
    const current = designId === this.source.id || this.options.savedDesignId?.(this.source.id) === designId;
    if (current) { await this.flush(); this.requireCurrent(generation, source); }
    const head = this.snapshot.head;
    await store.remove(designId, current && head.kind !== 'new' ? head.revisionId : revisionId);
    if (current) { this.requireCurrent(generation, source); this.adopt(replacement, { kind: 'new' }, false); }
  }
  async reloadRepository(repositoryId: string) {
    if (!this.store) return;
    const generation = this.generation, source = this.source, store = this.store;
    if (this.unsaved) { try { await this.flush(); } catch { /* Retain the rejected draft as an undo step. */ } }
    this.requireCurrent(generation, source);
    const loaded = await this.load(store, repositoryId);
    if (generation !== this.generation || source !== this.source) return;
    this.adopt(loaded.source, { kind: 'saved', revisionId: loaded.head.revisionId }, true, 'Reload repository source', loaded.revision);
  }
  private requireCurrent(generation: number, source: ConstructionSource) {
    if (generation !== this.generation || source !== this.source) throw new ConstructionStoreError('conflict', 'The active design changed. Your latest draft is preserved; retry the action.');
  }
  async pollRepository(repositoryId: string) {
    if (!this.store || this.checking) return;
    this.checking = true;
    const generation = this.generation, source = this.source, head = this.snapshot.head;
    try {
      const loaded = await this.load(this.store, repositoryId);
      if (generation !== this.generation || source !== this.source || head !== this.snapshot.head || (head.kind !== 'new' && loaded.head.revisionId === head.revisionId)) return;
      if (this.unsaved) {
        this.setError('Repository source changed while this draft was being edited. Download a backup, then reload the repository source. Your draft remains editable.');
        return;
      }
      this.adopt(loaded.source, { kind: 'saved', revisionId: loaded.head.revisionId }, true, 'Updated repository source', loaded.revision);
    } catch (cause) { if (generation === this.generation) this.setError(message(cause)); }
    finally { this.checking = false; }
  }
}
const message = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);
