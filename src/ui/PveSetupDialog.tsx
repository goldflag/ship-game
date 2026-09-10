import { useEffect, useRef, useState, type DragEvent } from 'react';
import { PveDraft, type PveOptions } from '../game/session/PveDraft';
import type { PveRequest } from '../multiplayer/generated/PveRequest';
import type { Placement } from '../multiplayer/generated/Placement';
import { shipPreset } from '../ships/presets';
import { OCEAN_MAPS } from '../maps/catalog';
import { WEATHER_PRESETS } from '../maps/conditions';
import { assetUrl } from '../assetUrl';
import { Button, Input, Select, SelectOption } from './components';
import { Icon } from './Icons';
import { aircraftCount, budgetError, fleetTotals, placementError, unitName } from './pveSetup';
import { PveDeployment } from './PveDeployment';
import { transferFleetShip, type FleetTransfer } from './pveFleetEditing';
import './PveSetupDialog.css';

interface Props { initialRequest?: PveRequest; initialShipId: string; loading: boolean; onLaunch(draft: PveDraft, placements: Placement[]): Promise<void>; onClose(): void }
const seed = () => crypto.getRandomValues(new Uint32Array(1))[0];
const tonnes = (kg: number) => Math.round(kg / 1000).toLocaleString();
export function PveSetupDialog({ initialRequest, initialShipId, loading, onLaunch, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null), draftRef = useRef<PveDraft | undefined>(undefined), controller = useRef<AbortController | undefined>(undefined), nextId = useRef(Math.max(0, ...[...(initialRequest?.ships ?? []), ...(initialRequest?.groups ?? [])].map(s => Number(s.id.match(/(\d+)$/)?.[1]) || 0)) + 1);
  const [options, setOptions] = useState<PveOptions>();
  const [request, setRequest] = useState<PveRequest>(() => initialRequest ? structuredClone(initialRequest) : ({ version: 1, seed: seed(), mapId: 'pacific-islands', weather: 'partly-cloudy', difficulty: 'normal', groups: [{ id: 'front', name: 'Group 1', station: 'front' }, { id: 'rear', name: 'Group 2', station: 'rear' }], ships: [] }));
  const [step, setStep] = useState<'briefing' | 'deployment'>('briefing');
  const [draft, setDraft] = useState<PveDraft>();
  const [placements, setPlacements] = useState<Placement[]>([]);
  const [query, setQuery] = useState('');
  const [transfer, setTransfer] = useState<FleetTransfer>();
  const [dropGroup, setDropGroup] = useState<string>();
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  useEffect(() => { if (loading) dialog.current?.close(); else dialog.current?.showModal(); }, [loading]);
  useEffect(() => {
    const abort = new AbortController(); controller.current = abort; setError('');
    void PveDraft.options(abort.signal).then(value => {
      if (abort.signal.aborted) return;
      setOptions(value);
      const id = value.eligiblePresets.includes(initialShipId) ? initialShipId : value.eligiblePresets[0];
      setRequest(r => r.ships.length ? r : { ...r, ships: [{ id: `unit-${nextId.current++}`, presetId: id, groupId: (r.groups.find(group => group.station === (aircraftCount(id) ? 'rear' : 'front')) ?? r.groups[0]).id }] });
    }).catch(e => { if (!abort.signal.aborted) setError(String(e.message ?? e)); });
    return () => { abort.abort(); controller.current?.abort(); draftRef.current?.dispose(); };
  }, [initialShipId, retry]);
  const change = (next: PveRequest) => { draftRef.current?.dispose(); draftRef.current = undefined; setDraft(undefined); setRequest(next); setError(''); setTransfer(undefined); setDropGroup(undefined); };
  const prepare = async () => {
    if (busy) return;
    if (draft) { setStep('deployment'); return; }
    setBusy(true); setError('');
    const abort = new AbortController(); controller.current = abort;
    try {
      const prepared = await PveDraft.create(request, abort.signal);
      if (abort.signal.aborted) { prepared.dispose(); return; }
      draftRef.current = prepared; setDraft(prepared);
      setPlacements(prepared.briefing.setup.ships.map(s => ({ id: s.id, spawn: s.spawn! }))); setStep('deployment');
    } catch (e) { if (!abort.signal.aborted) setError(e instanceof Error ? e.message : String(e)); }
    finally { if (!abort.signal.aborted) setBusy(false); }
  };
  const launch = async () => {
    if (!draft || busy) return;
    setBusy(true); setError('');
    try { await draft.validate(placements); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); setBusy(false); return; }
    try {
      await onLaunch(draft, placements);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      // A graphics/worker failure may consume the draft. Regenerating this exact
      // request preserves the frozen opponent and allows placement to be retried.
      draft.dispose(); draftRef.current = undefined; setDraft(undefined); setStep('briefing');
    } finally { setBusy(false); }
  };
  const totals = fleetTotals(request.ships), budget = options?.rules.budget;
  const invalid = budget ? budgetError(request.ships, budget) : '';
  const groupInvalid = request.groups.some(g => !g.name.trim()) ? 'Name every task group.' : '';
  const filtered = options?.eligiblePresets.filter(id => `${shipPreset(id).name} ${id}`.toLowerCase().includes(query.toLowerCase().trim())) ?? [];
  const moveToGroup = (groupId: string) => {
    if (!transfer || busy || !options) return;
    const result = transferFleetShip(request, transfer, groupId, `unit-${nextId.current++}`, options.eligiblePresets, options.rules.budget);
    if (result.error) setError(result.error); else change(result.request);
    setTransfer(undefined); setDropGroup(undefined);
  };
  const startDrag = (event: DragEvent, selected: FleetTransfer) => {
    event.stopPropagation();
    if (busy) { event.preventDefault(); return; }
    event.dataTransfer.effectAllowed = selected.kind === 'catalog' ? 'copy' : 'move';
    event.dataTransfer.setData('text/plain', selected.id);
    setTransfer(selected); setError('');
  };
  const endDrag = () => { setTransfer(undefined); setDropGroup(undefined); };
  const transferredUnit = transfer?.kind === 'unit' ? request.ships.find(ship => ship.id === transfer.id) : undefined;
  const transferName = transfer?.kind === 'catalog' ? shipPreset(transfer.id).name : transferredUnit ? unitName(transferredUnit, request.ships) : '';
  const budgetView = budget && <div className="pve-budget" aria-label="Fleet allowances">{[
    ['Tonnage', `${tonnes(totals.displacementKg)} / ${tonnes(budget.maxDisplacementKg)} t`, totals.displacementKg, budget.maxDisplacementKg],
    ['Ships', `${totals.ships} / ${budget.maxShips}`, totals.ships, budget.maxShips],
    ['Aircraft', `${totals.aircraft} / ${budget.maxAircraft}`, totals.aircraft, budget.maxAircraft],
  ].map(([label, value, used, max]) => <div key={label} className={Number(used) > Number(max) ? 'is-error' : ''}><span>{label}</span><strong>{value}</strong><meter min={0} max={Number(max)} value={Number(used)} aria-label={String(label)}/></div>)}</div>;
  return <dialog ref={dialog} className="pve-setup" aria-labelledby="pve-title" onCancel={event => { event.preventDefault(); if (transfer) endDrag(); else if (!loading) onClose(); }}>
    <header className="pve-header"><div><h1 id="pve-title">{step === 'briefing' ? 'Assemble your fleet' : 'Deploy your fleet'}</h1></div><nav aria-label="Mission preparation"><span aria-current={step === 'briefing' ? 'step' : undefined}>Fleet</span><span aria-current={step === 'deployment' ? 'step' : undefined}>Deployment</span></nav><Button variant="icon" aria-label="Close PvE setup" onClick={onClose} disabled={loading}><Icon name="close"/></Button></header>
    {!options ? <div className="pve-preparing" role="status">{error ? <><p>{error}</p><Button onClick={() => setRetry(r => r + 1)}>Retry</Button></> : 'Loading mission content…'}</div> : step === 'deployment' && draft ? <PveDeployment key={draft.briefing.setup.seed} briefing={draft.briefing} placements={placements} onChange={setPlacements} disabled={busy}/> : <div className="pve-briefing">
      <section className="pve-mission pve-scroll" aria-label="Mission briefing">
        <h2>Battle setup</h2>
        {budgetView}
        <label>Waters<Select value={request.mapId} disabled={busy} onValueChange={mapId => change({ ...request, mapId })}>{OCEAN_MAPS.map(m => <SelectOption key={m.id} value={m.id}>{m.name}</SelectOption>)}</Select></label>
        <label>Weather<Select value={request.weather} disabled={busy} onValueChange={weather => change({ ...request, weather })}>{WEATHER_PRESETS.map(w => <SelectOption key={w.id} value={w.id}>{w.name}</SelectOption>)}</Select></label>
        <label>Difficulty<Select value={request.difficulty} disabled={busy} onValueChange={difficulty => change({ ...request, difficulty: difficulty as PveRequest['difficulty'] })}><SelectOption value="easy">Easy</SelectOption><SelectOption value="normal">Normal</SelectOption><SelectOption value="hard">Hard</SelectOption></Select></label>
        <div className="pve-seed"><small>Mission {request.seed.toString(16).toUpperCase().padStart(8, '0')}</small><Button disabled={busy} onClick={() => change({ ...request, seed: seed() })}>New opponent</Button></div>
      </section>
      <div className="pve-group-columns" aria-label="Your task groups">{request.groups.map(group => {
        const members = request.ships.filter(s => s.groupId === group.id);
        return <section className={`pve-group-column ${dropGroup === group.id ? 'is-drop-target' : ''}`} key={group.id} aria-label={group.name || 'Unnamed group'} tabIndex={0}
          onDragOver={event => { if (transfer && !busy) { event.preventDefault(); event.dataTransfer.dropEffect = transfer.kind === 'catalog' ? 'copy' : 'move'; setDropGroup(group.id); } }}
          onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropGroup(undefined); }}
          onDrop={event => { event.preventDefault(); event.stopPropagation(); moveToGroup(group.id); }}
          onClick={event => { if (!(event.target as HTMLElement).closest('button,input')) moveToGroup(group.id); }}
          onKeyDown={event => { if (event.target === event.currentTarget && transfer && ['Enter', ' '].includes(event.key)) { event.preventDefault(); moveToGroup(group.id); } }}>
          <header><Input aria-label={`Task group name: ${group.name}`} maxLength={32} value={group.name} disabled={busy} onChange={e => change({ ...request, groups: request.groups.map(g => g.id === group.id ? { ...g, name: e.target.value } : g) })}/><small>{members.length} {members.length === 1 ? 'ship' : 'ships'} · {tonnes(fleetTotals(members).displacementKg)} t</small></header>
          <ul className="pve-scroll pve-group-ships">{members.map(unit => <li key={unit.id} draggable={!busy} className={transfer?.kind === 'unit' && transfer.id === unit.id ? 'is-picked' : ''} onDragStart={event => startDrag(event, { kind: 'unit', id: unit.id })} onDragEnd={endDrag}>
            <button className="pve-member-pick" disabled={busy} aria-label={`Move ${unitName(unit, request.ships)} to another group`} aria-pressed={transfer?.kind === 'unit' && transfer.id === unit.id} onClick={() => setTransfer({ kind: 'unit', id: unit.id })}>
            <img src={assetUrl(`models/${unit.presetId}-thumbnail.png`)} alt="" width="112" height="38" draggable={false}/>
            <div><strong>{unitName(unit, request.ships)}</strong><small>{tonnes(shipPreset(unit.presetId).hull.massKg)} t{aircraftCount(unit.presetId) ? ` · ${aircraftCount(unit.presetId)} aircraft` : ''}</small></div></button>
            <Button variant="icon" aria-label={`Remove ${unitName(unit, request.ships)}`} disabled={busy} onClick={() => change({ ...request, ships: request.ships.filter(s => s.id !== unit.id) })}><Icon name="close" size={14}/></Button>

          </li>)}</ul>
          <footer>{!members.length && <p>Drop ships here</p>}{!members.length && request.groups.length > 1 && <Button disabled={busy} onClick={() => change({ ...request, groups: request.groups.filter(g => g.id !== group.id) })}>Remove empty group</Button>}</footer>
        </section>;
      })}<Button className="pve-add-group" disabled={busy || request.groups.length >= 9} onClick={() => { const id = `group-${nextId.current++}`; change({ ...request, groups: [...request.groups, { id, name: `Group ${Math.max(0, ...request.groups.map(group => Number(group.name.match(/^Group (\d+)$/)?.[1]) || 0)) + 1}`, station: 'front' }] }); }}>+ Group</Button></div>
      <section className="pve-catalog" aria-label="Ship catalog"><header><h2>Ships</h2><p>Drag ships into groups</p><label>Find a ship<Input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Name or class"/></label></header>
        <ul className="pve-scroll">{filtered.map(id => {
          const definition = shipPreset(id), over = budgetError([...request.ships, { id: 'preview', presetId: id, groupId: request.groups[0].id }], budget!);
          return <li key={id}><button className="pve-catalog-ship" draggable={!busy && !over} disabled={busy || !!over} title={over || `Drag ${definition.name} into a group`} aria-label={`Choose ${definition.name}`} aria-pressed={transfer?.kind === 'catalog' && transfer.id === id} onDragStart={event => startDrag(event, { kind: 'catalog', id })} onDragEnd={endDrag} onClick={() => setTransfer({ kind: 'catalog', id })}>
            <img src={assetUrl(`models/${id}-thumbnail.png`)} width="120" height="40" alt="" draggable={false}/><strong>{definition.name}</strong><small>{tonnes(definition.hull.massKg)} t{aircraftCount(id) ? ` · ${aircraftCount(id)} aircraft` : ''}</small></button></li>;
        })}</ul>{!filtered.length && <p className="pve-empty">No ships match this search.</p>}
      </section>
    </div>}
    <footer className="pve-footer"><div role="status" className={error || invalid || groupInvalid ? 'is-error' : ''}>{error || invalid || groupInvalid || (busy ? 'Preparing your mission…' : transfer ? `Choose a group for ${transferName}` : '')}</div><div>{step === 'deployment' && <Button disabled={busy} onClick={() => setStep('briefing')}>Back to fleet</Button>}<Button variant="primary" disabled={!options || busy || !!invalid || !!groupInvalid || (step === 'deployment' && !!draft && !!placementError(draft.briefing, placements))} onClick={() => void (step === 'briefing' ? prepare() : launch())}>{busy ? 'Preparing…' : step === 'briefing' ? 'Deploy fleet' : 'Start battle'}<Icon name="arrow" size={18}/></Button></div></footer>
  </dialog>;
}
