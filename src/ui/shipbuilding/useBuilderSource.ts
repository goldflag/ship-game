import { useEffect, useRef, useState } from 'react';
import type { ConstructionResult, ConstructionSource, ConstructionSuggestion } from '../../ships/blueprint';
import { createConstructionHistory, editConstruction, undoConstruction, redoConstruction, ConstructionRevisionGate } from '../../ships/constructionHistory';
import { ConstructionAutosave, type ConstructionSaveState } from '../../ships/constructionAutosave';
import { startingHullBlock } from '../../ships/constructionStarter';
import { openConstructionStore, type ConstructionStore } from '../../ships/constructionStore';
import { decodeConstructionSource, loadSavedConstructionWithCatalog, newConstructionId } from '../../ships/constructionEditor';

export interface BuilderCompiler {
  compile(source: ConstructionSource, signal?: AbortSignal): Promise<ConstructionResult>;
  suggest?(source: ConstructionSource, partIds: string[], signal?: AbortSignal): Promise<ConstructionSuggestion>;
  dispose(): void;
}
export function freshConstruction(template: ConstructionSource, blank = false): ConstructionSource {
  const source = structuredClone(template); source.id = newConstructionId('design'); source.revision = newConstructionId('revision');
  source.name = blank ? 'Untitled design' : template.name;
  if (blank) Object.assign(source.construction, { primitives: [startingHullBlock()], surfaces: [], equipment: [], boundaries: [], loads: [] });
  return source;
}

export function useBuilderSource({ starterSource, initialSource, initialDesignId, compiler, catalogRevision, onSave }: {
  starterSource: ConstructionSource; initialSource?: ConstructionSource; initialDesignId?: string; compiler: BuilderCompiler; catalogRevision: string;
  onSave?(source: ConstructionSource): void;
}) {
  const [history, setHistory] = useState(() => createConstructionHistory(initialSource ?? freshConstruction(starterSource)));
  const source = history.source;
  const [store, setStore] = useState<ConstructionStore>();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [saveState, setSaveState] = useState<ConstructionSaveState>({ status: 'saving', token: 0 });
  const [saverVersion, setSaverVersion] = useState(0);
  const [writerEpoch, setWriterEpoch] = useState(0);
  const saver = useRef<ConstructionAutosave | undefined>(undefined);
  const head = useRef<string | null>(null);
  const lastQueued = useRef('');
  const onSaveRef = useRef(onSave); onSaveRef.current = onSave;
  const sourceRef = useRef(source); sourceRef.current = source;
  const [result, setResult] = useState<ConstructionResult>();
  const [compiling, setCompiling] = useState(true);
  const [compileError, setCompileError] = useState('');
  const gate = useRef(new ConstructionRevisionGate());
  const [compileAgain, setCompileAgain] = useState(0);

  useEffect(() => {
    let active = true; let opened: ConstructionStore | undefined;
    void openConstructionStore().then(async storage => {
      opened = storage;
      if (!active) { storage.close(); return; }
      if (initialDesignId) {
        try {
          const loaded = await loadSavedConstructionWithCatalog(storage, initialDesignId);
          if (!active) return;
          head.current = loaded.head.revisionId; lastQueued.current = loaded.source.revision;
          setHistory(createConstructionHistory(loaded.source)); setSaveState({ status: 'saved', token: 0, revision: loaded.revision });
        } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : String(cause)); }
      } else if (initialSource) {
        try {
          const loaded = await loadSavedConstructionWithCatalog(storage, initialSource.id);
          if (!active) return;
          if (loaded.source.revision === initialSource.revision) {
            head.current = loaded.head.revisionId; lastQueued.current = initialSource.revision;
            setSaveState({ status: 'saved', token: 0, revision: loaded.revision });
          } else head.current = 'source-returned-from-trial'; // CAS rejects overwriting a newer edit in another tab.
        } catch (cause) { if ((cause as { code?: string }).code !== 'not-found' && active) setError(cause instanceof Error ? cause.message : String(cause)); }
      }
      if (active) { setStore(storage); setReady(true); }
    }).catch(cause => { if (active) { setError(cause instanceof Error ? cause.message : String(cause)); setReady(true); setSaveState({ status: 'error', token: 0, error: cause }); } });
    return () => { active = false; opened?.close(); };
  }, []);

  useEffect(() => {
    if (!store || !ready) return;
    const save = new ConstructionAutosave(store, head.current, state => {
      setSaveState(state);
      if (state.error) setError(state.error.message);
      if (state.revision) {
        head.current = state.revision.id;
        try { onSaveRef.current?.(decodeConstructionSource(JSON.parse(state.revision.sourceJson))); }
        catch (cause) { setError(`Source saved, but the local fleet list could not refresh: ${cause instanceof Error ? cause.message : String(cause)}`); }
      }
    });
    saver.current = save; setSaverVersion(version => version + 1);
    return () => { save.dispose(); if (saver.current === save) saver.current = undefined; };
  }, [store, ready, source.id, writerEpoch]);

  useEffect(() => {
    if (!saver.current || !ready || lastQueued.current === source.revision) return;
    lastQueued.current = source.revision;
    saver.current.enqueue({ designId: source.id, name: source.name, source, schemaVersion: source.schemaVersion, catalogRevision: source.construction.catalogRevision });
  }, [source, ready, saverVersion]);

  useEffect(() => {
    if (!ready) return;
    const token = gate.current.issue(), abort = new AbortController();
    setCompiling(true); setCompileError('');
    const timer = setTimeout(() => {
      void compiler.compile(source, abort.signal).then(compiled => {
        if (abort.signal.aborted || !gate.current.accepts(token) || sourceRef.current.revision !== compiled.revision || compiled.sourceId !== source.id) return;
        setResult(compiled); setCompiling(false);
      }).catch(cause => {
        if (abort.signal.aborted || !gate.current.accepts(token)) return;
        setCompileError(cause instanceof Error ? cause.message : String(cause)); setCompiling(false);
      });
    }, 180);
    return () => { clearTimeout(timer); abort.abort(); gate.current.invalidate(); };
  }, [source, ready, compileAgain, compiler]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (saver.current?.unsaved || saveState.status === 'error') { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [saveState.status]);
  useEffect(() => () => { gate.current.invalidate(); compiler.dispose(); }, [compiler]);

  const edit = (label: string, command: (draft: ConstructionSource) => void) => setHistory(current => editConstruction(current, label, draft => {
    command(draft);
    if (JSON.stringify(draft) !== JSON.stringify(current.source)) draft.revision = newConstructionId('revision');
  }));
  const undo = () => setHistory(current => { const next = undoConstruction(current); return next === current ? current : { ...next, source: { ...next.source, revision: newConstructionId('revision') } }; });
  const redo = () => setHistory(current => { const next = redoConstruction(current); return next === current ? current : { ...next, source: { ...next.source, revision: newConstructionId('revision') } }; });
  const flush = async () => {
    if (!saver.current) throw new Error('Local saving is unavailable. Download this source before closing.');
    await saver.current.flush();
  };
  const replace = async (next: ConstructionSource, revisionId: string | null, saved: boolean, retainDraft = false) => {
    if (!retainDraft) await flush();
    saver.current?.dispose(); head.current = revisionId; lastQueued.current = saved ? next.revision : '';
    setResult(undefined); setError(''); setCompileError(''); setSaveState({ status: saved ? 'saved' : 'saving', token: 0 });
    setHistory(createConstructionHistory(next));
    // A recovered revision of the same design must also recreate its compare-and-swap writer.
    setWriterEpoch(value => value + 1);
  };

  const removeDesign = async (designId: string, revisionId: string, replacement: ConstructionSource) => {
    if (!store) throw new Error('Local storage is unavailable. Retry when browser storage is available.');
    const current = designId === sourceRef.current.id;
    if (current) await flush();
    await store.remove(designId, current ? head.current! : revisionId);
    // The old writer is drained before deletion and never saves the deleted source again.
    if (current) await replace(replacement, null, false, true);
  };

  return { source, history, store, ready, result, compiling, compileError, error, setError, saveState, edit, undo, redo, flush, replace, removeDesign,
    retrySave: () => saver.current?.retry(), retryCompile: () => setCompileAgain(value => value + 1),
    currentResult: result?.revision === source.revision && result.sourceId === source.id ? result : undefined };
}
