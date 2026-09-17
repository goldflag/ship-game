import { currentAccount } from '../../accounts/session';
import { retainRecovery, savedReference } from '../../ships/constructionCloud';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ConstructionCatalog, ConstructionSource, ConstructionSuggestion } from '../../ships/blueprint';
import { CompiledRevision, type BuilderCompiler } from '../../ships/compiledRevision';
import { ConstructionRevisionOwner } from '../../ships/constructionRevisionOwner';
import { loadConstructionCatalog } from '../../ships/constructionEquipment';
import { startingHullBlock } from '../../ships/constructionStarter';
import { openConstructionStore, type ConstructionStore } from '../../ships/constructionStore';
import { newConstructionId } from '../../ships/constructionEditor';
import { BuilderTool } from './builderTool';

export type { BuilderCompiler } from '../../ships/compiledRevision';
export function freshConstruction(template: ConstructionSource, blank = false): ConstructionSource {
  const source = structuredClone(template); source.id = newConstructionId('design'); source.revision = newConstructionId('revision');
  source.name = blank ? 'Untitled design' : template.name;
  if (blank) Object.assign(source.construction, { primitives: [startingHullBlock()], surfaces: [], equipment: [], boundaries: [], loads: [] });
  return source;
}

/** The React adapter over three plain modules: the revision owner (history, autosave, the edit door),
 * the compiled revision (debounce, cancellation, the one acceptance predicate) and the builder tool
 * (layer, tool, selection, gestures). It opens storage, resolves the design's retained catalog and
 * subscribes to each module's snapshot; it forwards no methods, callers use the modules directly. */
export function useBuilderSource({ starterSource, initialSource, initialDesignId, compiler, catalog: initialCatalog, suggest, onSave, openStore = openConstructionStore, repositoryId }: {
  starterSource: ConstructionSource; initialSource?: ConstructionSource; initialDesignId?: string; compiler: BuilderCompiler; catalog: ConstructionCatalog;
  suggest?(source: ConstructionSource, partIds: string[], signal?: AbortSignal): Promise<ConstructionSuggestion>;
  onSave?(source: ConstructionSource): void;
  openStore?(): Promise<ConstructionStore>;
  repositoryId?: string;
}) {
  const account = useRef(currentAccount()).current;
  const onSaveRef = useRef(onSave); onSaveRef.current = onSave;
  const suggestRef = useRef(suggest); suggestRef.current = suggest;
  const [owner] = useState(() => new ConstructionRevisionOwner(initialSource ?? freshConstruction(starterSource), {
    retainRecovery: input => retainRecovery(input, account),
    onSave: saved => onSaveRef.current?.(saved),
    savedDesignId: id => savedReference(id)?.designId,
  }));
  const [compiled] = useState(() => new CompiledRevision(owner, compiler));
  const catalogRef = useRef(initialCatalog);
  const [tool] = useState(() => new BuilderTool(owner, {
    catalog: () => catalogRef.current,
    compiled: () => compiled.getSnapshot().current,
    retained: () => compiled.getSnapshot().retained,
    suggest: suggest ? (source, ids, signal) => suggestRef.current!(source, ids, signal) : undefined,
  }));
  const revision = useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot);
  const compile = useSyncExternalStore(compiled.subscribe, compiled.getSnapshot, compiled.getSnapshot);
  const toolState = useSyncExternalStore(tool.subscribe, tool.getSnapshot, tool.getSnapshot);
  const source = revision.history.source;
  const [store, setStore] = useState<ConstructionStore>();

  // A design opens on the newest parts catalog. It keeps its saved revision only while that newest one is unknown
  // or no longer has a part the design has fitted; the retained revision is fetched meanwhile.
  const [activeCatalog, setActiveCatalog] = useState(initialCatalog);
  const [latestCatalog, setLatestCatalog] = useState(initialCatalog);
  const [latestLoaded, setLatestLoaded] = useState(false);
  useEffect(() => { let active = true; void loadConstructionCatalog().then(next => { if (active) { setLatestCatalog(next); setLatestLoaded(true); } }).catch(() => {}); return () => { active = false; }; }, []);
  const catalogRevision = source.construction.catalogRevision;
  useEffect(() => {
    if (!latestLoaded || !revision.ready || revision.busy || catalogRevision === latestCatalog.revision) return;
    const available = new Set(latestCatalog.equipment.map(part => part.id));
    if (source.construction.equipment.some(fitted => !available.has(fitted.partId))) return;
    if (owner.adoptCatalog(latestCatalog.revision)) setActiveCatalog(latestCatalog);
  }, [latestLoaded, latestCatalog, catalogRevision, revision.ready, revision.busy, revision.adoption, owner]);
  useEffect(() => {
    if (activeCatalog.revision === catalogRevision) return;
    let active = true;
    void loadConstructionCatalog(catalogRevision).then(catalog => { if (active) setActiveCatalog(catalog); }).catch(cause => { if (active) owner.setError(`The saved equipment revision is unavailable. ${cause instanceof Error ? cause.message : String(cause)}`); });
    return () => { active = false; };
  }, [catalogRevision, activeCatalog.revision]);
  const catalog = useMemo(() => activeCatalog.revision === catalogRevision ? activeCatalog : { ...activeCatalog, equipment: [] }, [activeCatalog, catalogRevision]);
  catalogRef.current = catalog;

  useEffect(() => {
    let active = true; let opened: ConstructionStore | undefined;
    void openStore().then(async storage => {
      opened = storage;
      if (!active) { storage.close(); return; }
      await owner.connect(storage, initialDesignId, !!initialSource);
      if (active) setStore(storage);
    }).catch(cause => { if (active) owner.unavailable(cause); });
    return () => { active = false; owner.disconnect(); opened?.close(); };
  }, []);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (owner.unsaved || revision.saveState.status === 'error') { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [owner, revision.saveState.status]);
  useEffect(() => () => { tool.dispose(); compiled.dispose(); }, [compiled, tool]);
  useEffect(() => {
    if (!store || !repositoryId || !revision.ready) return;
    const timer = setInterval(() => { void owner.pollRepository(repositoryId); }, 1200);
    return () => clearInterval(timer);
  }, [store, repositoryId, revision.ready, owner]);

  return { owner, revision, compiled, compile, tool, toolState, source, store, catalog, activeCatalog, latestCatalog, setActiveCatalog,
    reloadRepository: async () => { if (repositoryId) await owner.reloadRepository(repositoryId); } };
}
