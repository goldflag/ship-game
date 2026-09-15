import { DeleteDesignButton } from '../DeleteDesignButton';
import { useEffect, useRef, useState } from 'react';
import type { ConstructionSource } from '../../ships/blueprint';
import type { ConstructionDesignHead, ConstructionRevision, ConstructionStore } from '../../ships/constructionStore';
import { decodeSavedConstruction, loadSavedConstructionWithCatalog, newConstructionId } from '../../ships/constructionEditor';
import { loadConstructionCatalog } from '../../ships/constructionEquipment';
import type { ConstructionStarter } from '../../ships/constructionStarter';

export function downloadConstructionSource(json: string, name = 'ship-source') {
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${name.replace(/[^a-z0-9-]/gi, '-').slice(0, 80)}.json`;
  anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The transient list under the ship's name: new designs, backups and local revisions. */
export function DesignsMenu({ store, currentId, refresh, onClose, onNew, onSaveCopy, onDownload, onOpen, onRecover, onDelete, onImport, disabled, partsUpdate }: {
  store?: ConstructionStore; disabled?: boolean; currentId: string; refresh?: string; onClose(): void;
  onImport?(): void;
  onNew(kind: ConstructionStarter): void; onSaveCopy(): void; onDownload(): void;
  onOpen(source: ConstructionSource, revisionId: string): Promise<void>;
  onRecover(source: ConstructionSource): Promise<void>;
  onDelete(designId: string, revisionId: string): Promise<void>;
  partsUpdate?: { changedParts: string[]; missingParts: string[]; onApply(): void };
}) {
  const [designs, setDesigns] = useState<ConstructionDesignHead[]>([]);
  const [revisions, setRevisions] = useState<ConstructionRevision[]>([]);
  const [chosen, setChosen] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [reviewParts, setReviewParts] = useState(false);
  const request = useRef(0);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => () => { request.current++; }, []);
  useEffect(() => {
    let active = true;
    if (store) void store.list().then(designs => { if (active) setDesigns(designs); }).catch(cause => { if (active) setError(String(cause.message ?? cause)); });
    return () => { active = false; };
  }, [store, refresh]);
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node) && !(event.target as HTMLElement).closest('.sb-meta')) onClose(); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [onClose]);
  const guarded = async (work: () => Promise<void>) => {
    const token = ++request.current;
    setError(''); setLoading(true);
    try { await work(); }
    catch (cause) { if (request.current === token) setError(String((cause as Error).message ?? cause)); }
    finally { if (request.current === token) setLoading(false); }
  };
  const browse = (id: string) => { setChosen(id); setRevisions([]); void guarded(async () => { setRevisions(await store!.revisions(id)); }); };
  const open = () => void guarded(async () => { const loaded = await loadSavedConstructionWithCatalog(store!, chosen); await onOpen(loaded.source, loaded.head.revisionId); });
  const recover = (revision: ConstructionRevision) => void guarded(async () => {
    const catalog = await loadConstructionCatalog(revision.catalogRevision);
    const source = decodeSavedConstruction(revision, catalog.revision);
    source.id = newConstructionId('design'); source.revision = newConstructionId('revision'); source.name = `${source.name.slice(0, 145)} recovered`;
    await onRecover(source);
  });
  const when = (time: number) => new Date(time).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  return <div ref={menu} className="sb-menu" role="menu" aria-label="Designs">
    <div className="sb-menu-row"><span className="sb-lead">New</span><button role="menuitem" disabled={loading || disabled} onClick={() => onNew('patrol')}>Patrol hull</button><button role="menuitem" disabled={loading || disabled} onClick={() => onNew('catamaran')}>Twin hull</button><button role="menuitem" disabled={loading || disabled} onClick={() => onNew('blank')}>New design</button></div>
    <div className="sb-menu-row"><span className="sb-lead">This design</span>{onImport && <button role="menuitem" disabled={loading || disabled} onClick={onImport}>Import source</button>}<button role="menuitem" disabled={loading || disabled} onClick={onSaveCopy}>Save as copy</button><button role="menuitem" disabled={loading || disabled} onClick={onDownload}>Download backup</button></div>
    {partsUpdate && <div className="sb-menu-list">
      <button role="menuitem" disabled={loading || disabled || !!partsUpdate.missingParts.length} onClick={() => {
        if (partsUpdate.changedParts.length && !reviewParts) setReviewParts(true);
        else partsUpdate.onApply();
      }}>{reviewParts ? 'Apply parts update' : 'Update parts library'}</button>
      {partsUpdate.missingParts.length > 0 ? <p role="status">Unavailable in the new library: {partsUpdate.missingParts.join(', ')}.</p>
        : reviewParts ? <p role="status">Updates fitted variants: {partsUpdate.changedParts.join(', ')}. This design will recompile; Undo restores its previous library.</p>
        : <p>Add the latest fittings to this design’s palette.</p>}
    </div>}
    <div className="sb-menu-list">
      <span className="sb-lead">Local designs</span>
      {!store && <p>Local storage is unavailable. Download the current source to keep a backup.</p>}
      {store && !designs.length && <p>No designs saved yet. Sources save here automatically.</p>}
      {designs.map(design => <div className="sb-menu-design" key={design.id}>
        <button role="menuitem" disabled={loading || disabled} aria-pressed={chosen === design.id} onClick={() => browse(design.id)}>
          <span>{design.name}{design.id === currentId && <i> · open</i>}</span><small>{design.readError ?? when(design.updatedAt)}</small>
        </button>
        <DeleteDesignButton name={design.name} disabled={loading || disabled} onDelete={async () => {
          setLoading(true);
          try { await onDelete(design.id, design.revisionId); if (chosen === design.id) { setChosen(''); setRevisions([]); } }
          finally { try { setDesigns(await store!.list()); } finally { setLoading(false); } }
        }}/>
      </div>)}
    </div>
    {chosen && <div className="sb-menu-revisions">
      <button role="menuitem" className="brass" disabled={loading || disabled || chosen === currentId} onClick={open}>{chosen === currentId ? 'Latest revision is open' : 'Open latest revision'}</button>
      {revisions.map(revision => <div key={revision.id}><span>{when(revision.createdAt)} <small>v{revision.schemaVersion}</small></span>
        <button role="menuitem" disabled={loading || disabled} onClick={() => recover(revision)}>Recover copy</button>
        <button role="menuitem" onClick={() => downloadConstructionSource(revision.sourceJson, `source-${revision.id}`)}>Download</button></div>)}
    </div>}
    {loading && <p role="status">Updating local designs…</p>}
    {error && <p role="alert" className="bad">{error}</p>}
  </div>;
}
