import { DeleteDesignButton } from './DeleteDesignButton';
import { removeLocalShip } from '../ships/localShips';
import { useEffect, useRef, useState } from 'react';
import { openConstructionStore, type ConstructionDesignHead } from '../ships/constructionStore';
import type { LocalShipRevision } from '../ships/localShips';
import { Button } from './components';

export function PortDesigns({ ships, selectedId, ready, preparing, onNew, onEdit, onInspect, onDelete }: {
  ships: readonly LocalShipRevision[]; selectedId: string; ready: boolean; preparing: boolean;
  onNew(): void; onEdit(id: string): void; onInspect(id: string): void; onDelete?(id: string): void;
}) {
  const [designs, setDesigns] = useState<ConstructionDesignHead[]>([]);
  const [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0), [choosing, setChoosing] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    void (async () => {
      const store = await openConstructionStore();
      try { const heads = await store.list(); if (active) setDesigns(heads); }
      finally { store.close(); }
    })().catch(error => { if (active) setError(error instanceof Error ? error.message : String(error)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [refresh]);
  useEffect(() => {
    const focus = () => setRefresh(value => value + 1);
    window.addEventListener('focus', focus);
    return () => window.removeEventListener('focus', focus);
  }, []);
  useEffect(() => { if (choosing) list.current?.querySelector<HTMLButtonElement>('button')?.focus(); }, [choosing]);
  const selected = ships.find(ship => ship.definition.id === selectedId);
  return <section className="port-designs" aria-label="Ship designs">
    <h2>Ship designs</h2>
    <div className="port-design-actions">
      <Button variant="primary" disabled={!ready} onClick={onNew}>New design <span aria-hidden="true">+</span></Button>
      <Button disabled={!ready || loading || !designs.length} onClick={() => selected ? onEdit(selected.source.id) : setChoosing(true)}>Edit design <span aria-hidden="true">↗</span></Button>
    </div>
    <div className="port-design-heading"><span>{choosing ? 'Choose a design to edit' : 'Saved locally'}</span><small>{designs.length}</small></div>
    {loading && <p role="status">Loading your designs…</p>}
    {error && <p role="alert">{error} <button onClick={() => setRefresh(value => value + 1)}>Retry</button></p>}
    {!loading && !error && !designs.length && <p>Create a design to start building your fleet.</p>}
    <div ref={list} className="port-design-list">
      {designs.map(design => {
        const ship = ships.find(ship => ship.source.id === design.id), selected = ship?.definition.id === selectedId;
        return <div className="port-design-row" key={design.id} data-selected={selected}>
          <button className="port-design-open" disabled={!ready} aria-label={`${choosing || !ship ? 'Edit' : 'Inspect'} ${design.name}`} aria-pressed={selected}
            onClick={() => choosing || !ship ? onEdit(design.id) : onInspect(ship.definition.id)}>
            <strong>{design.name}</strong><small>{design.readError ? 'Needs recovery' : ship ? 'Ready for sea' : preparing ? 'Preparing preview…' : 'Draft · open to edit'}</small>
          </button>
          <button className="port-design-edit" disabled={!ready} aria-label={`Open ${design.name} in shipbuilder`} onClick={() => onEdit(design.id)}>Edit</button>
          <DeleteDesignButton name={design.name} disabled={!ready} onDelete={async () => {
            const store = await openConstructionStore();
            try { await store.remove(design.id, design.revisionId); onDelete?.(design.id); removeLocalShip(design.id); setDesigns(current => current.filter(item => item.id !== design.id)); }
            catch (cause) { setRefresh(value => value + 1); throw cause; }
            finally { store.close(); }
          }}/>

        </div>;
      })}
    </div>
  </section>;
}
