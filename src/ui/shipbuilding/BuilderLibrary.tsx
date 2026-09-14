import { useEffect, useRef, useState } from 'react';
import type { ConstructionSource } from '../../ships/blueprint';
import type { ConstructionDesignHead, ConstructionRevision, ConstructionStore } from '../../ships/constructionStore';
import { decodeSavedConstruction, loadSavedConstructionWithCatalog, newConstructionId } from '../../ships/constructionEditor';
import { loadConstructionCatalog } from '../../ships/constructionEquipment';
import { Button } from '../components';

export function downloadConstructionSource(json: string, name = 'ship-source') {
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${name.replace(/[^a-z0-9-]/gi, '-').slice(0, 80)}.json`;
  anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function BuilderLibrary({ store, catalogRevision, refresh, onOpen, onRecover }: {
  store?: ConstructionStore; catalogRevision: string; refresh?: string;
  onOpen(source: ConstructionSource, revisionId: string): Promise<void>;
  onRecover(source: ConstructionSource): Promise<void>;
}) {
  const [designs, setDesigns] = useState<ConstructionDesignHead[]>([]);
  const [revisions, setRevisions] = useState<ConstructionRevision[]>([]);
  const [chosen, setChosen] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const request = useRef(0);
  useEffect(() => () => { request.current++; }, []);
  useEffect(() => {
    let active = true;
    if (store) void store.list().then(designs => { if (active) setDesigns(designs); }).catch(cause => { if (active) setError(String(cause.message ?? cause)); });
    return () => { active = false; };
  }, [store, refresh]);
  const browse = async (id: string) => {
    const token = ++request.current;
    setChosen(id); setError(''); setLoading(true);
    try { const revisions = await store!.revisions(id); if (request.current === token) setRevisions(revisions); }
    catch (cause) { if (request.current === token) setError(String((cause as Error).message ?? cause)); }
    finally { if (request.current === token) setLoading(false); }
  };
  const open = async () => {
    setError(''); setLoading(true);
    try { const loaded = await loadSavedConstructionWithCatalog(store!, chosen); await onOpen(loaded.source, loaded.head.revisionId); }
    catch (cause) { setError(String((cause as Error).message ?? cause)); }
    finally { setLoading(false); }
  };
  const recover = async (revision: ConstructionRevision) => {
    setError(''); setLoading(true);
    try {
      const catalog = await loadConstructionCatalog(revision.catalogRevision);
      const source = decodeSavedConstruction(revision, catalog.revision);
      source.id = newConstructionId('design'); source.revision = newConstructionId('revision'); source.name = `${source.name.slice(0, 145)} recovered`;
      await onRecover(source);
    } catch (cause) { setError(String((cause as Error).message ?? cause)); }
    finally { setLoading(false); }
  };
  return <section aria-label="Local design library">
    <h2>Local designs</h2><p className="shipbuilder-help">Sources stay in this browser. Recovery opens a copy and preserves every original revision.</p>
    {!store && <p role="status">Local storage is unavailable. Download your current source to keep a backup.</p>}
    {store && !designs.length && <p>No designs saved yet. Start a hull; its source saves automatically.</p>}
    <div className="shipbuilder-list">{designs.map(design => <Button key={design.id} aria-pressed={chosen === design.id} onClick={() => void browse(design.id)}><span>{design.name}<small>{design.readError ?? new Date(design.updatedAt).toLocaleString()}</small></span></Button>)}</div>
    {chosen && <><Button variant="primary" disabled={loading} onClick={() => void open()}>Open latest revision</Button><h3>Recover a source</h3><div className="shipbuilder-revisions">{revisions.map(revision => <div key={revision.id}><span>{new Date(revision.createdAt).toLocaleString()}<small>Source v{revision.schemaVersion}</small></span><div className="shipbuilder-actions"><Button disabled={loading} onClick={() => void recover(revision)}>Recover copy</Button><Button onClick={() => downloadConstructionSource(revision.sourceJson, `source-${revision.id}`)}>Download original</Button></div></div>)}</div></>}
    {loading && <p role="status">Reading source revisions…</p>}{error && <p role="alert" className="shipbuilder-error">{error}</p>}
  </section>;
}
