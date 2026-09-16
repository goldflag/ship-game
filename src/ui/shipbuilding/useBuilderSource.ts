import { currentAccount } from '../../accounts/session';
import { retainRecovery, savedReference } from '../../ships/constructionCloud';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ConstructionResult, ConstructionSource, ConstructionSuggestion } from '../../ships/blueprint';
import { ConstructionRevisionGate } from '../../ships/constructionHistory';
import { ConstructionRevisionOwner } from '../../ships/constructionRevisionOwner';
import { startingHullBlock } from '../../ships/constructionStarter';
import { openConstructionStore, type ConstructionStore } from '../../ships/constructionStore';
import { newConstructionId } from '../../ships/constructionEditor';

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

export function useBuilderSource({ starterSource, initialSource, initialDesignId, compiler, catalogRevision, onSave, openStore = openConstructionStore, repositoryId }: {
  starterSource: ConstructionSource; initialSource?: ConstructionSource; initialDesignId?: string; compiler: BuilderCompiler; catalogRevision: string;
  onSave?(source: ConstructionSource): void;
  openStore?(): Promise<ConstructionStore>;
  repositoryId?: string;
}) {
  const account = useRef(currentAccount()).current;
  const onSaveRef = useRef(onSave); onSaveRef.current = onSave;
  const [owner] = useState(() => new ConstructionRevisionOwner(initialSource ?? freshConstruction(starterSource), {
    retainRecovery: input => retainRecovery(input, account),
    onSave: saved => onSaveRef.current?.(saved),
    savedDesignId: id => savedReference(id)?.designId,
  }));
  const snapshot = useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot);
  const { history, saveState, error, adoption } = snapshot;
  const source = history.source;
  const [store, setStore] = useState<ConstructionStore>();
  const [ready, setReady] = useState(false);
  const [result, setResult] = useState<ConstructionResult>();
  const [compiling, setCompiling] = useState(true);
  const [compileError, setCompileError] = useState('');
  const gate = useRef(new ConstructionRevisionGate());
  const [compileAgain, setCompileAgain] = useState(0);
  const acceptedAdoption = useRef(-1);
  const resultRef = useRef({ result, adoption: -1 }); resultRef.current = { result, adoption: acceptedAdoption.current };

  useEffect(() => {
    let active = true; let opened: ConstructionStore | undefined;
    void openStore().then(async storage => {
      opened = storage;
      if (!active) { storage.close(); return; }
      await owner.connect(storage, initialDesignId, !!initialSource);
      if (active) { setStore(storage); setReady(true); }
    }).catch(cause => { if (active) { owner.unavailable(cause); setReady(true); } });
    return () => { active = false; owner.disconnect(); opened?.close(); };
  }, []);

  useEffect(() => {
    setResult(undefined); setCompileError('');
  }, [adoption]);

  useEffect(() => {
    if (!ready) return;
    const token = gate.current.issue(), abort = new AbortController();
    setCompiling(true); setCompileError('');
    const timer = setTimeout(() => {
      void compiler.compile(source, abort.signal).then(compiled => {
        if (abort.signal.aborted || !gate.current.accepts(token) || owner.getSnapshot().adoption !== adoption || owner.source.revision !== compiled.revision || compiled.sourceId !== owner.source.id) return;
        acceptedAdoption.current = adoption; setResult(compiled); setCompiling(false);
      }).catch(cause => {
        if (abort.signal.aborted || !gate.current.accepts(token)) return;
        setCompileError(cause instanceof Error ? cause.message : String(cause)); setCompiling(false);
      });
    }, 180);
    return () => { clearTimeout(timer); abort.abort(); gate.current.invalidate(); };
  }, [source, ready, adoption, compileAgain, compiler]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (owner.unsaved || saveState.status === 'error') { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [owner, saveState.status]);
  useEffect(() => () => { gate.current.invalidate(); compiler.dispose(); }, [compiler]);
  useEffect(() => {
    if (!store || !repositoryId || !ready) return;
    const timer = setInterval(() => { void owner.pollRepository(repositoryId); }, 1200);
    return () => clearInterval(timer);
  }, [store, repositoryId, ready, owner]);

  const readSource = () => structuredClone(owner.source);
  const readResult = () => {
    const latest = owner.source, current = resultRef.current;
    return current.adoption === owner.getSnapshot().adoption && current.result?.revision === latest.revision && current.result.sourceId === latest.id
      ? structuredClone(current.result) : undefined;
  };
  return { source, history, store, ready, result, compiling, compileError, error, setError: owner.setError, saveState,
    edit: owner.edit, applyBatch: owner.applyBatch, undo: owner.undo, redo: owner.redo, flush: owner.flush, replace: owner.replace,
    removeDesign: (designId: string, revisionId: string, replacement: ConstructionSource) => owner.removeDesign(designId, revisionId, replacement),
    reloadRepository: async () => { if (repositoryId) await owner.reloadRepository(repositoryId); },
    retrySave: owner.retrySave, retryCompile: () => setCompileAgain(value => value + 1), readSource, readResult,
    currentResult: acceptedAdoption.current === adoption && result?.revision === source.revision && result.sourceId === source.id ? result : undefined };
}
