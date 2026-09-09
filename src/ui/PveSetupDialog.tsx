import { useEffect, useRef, useState } from 'react';
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
import './PveSetupDialog.css';

interface Props { initialShipId: string; loading: boolean; onLaunch(draft: PveDraft, placements: Placement[]): Promise<void>; onClose(): void }
const seed = () => crypto.getRandomValues(new Uint32Array(1))[0];
const tonnes = (kg: number) => Math.round(kg / 1000).toLocaleString();
export function PveSetupDialog({ initialShipId, loading, onLaunch, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null), draftRef = useRef<PveDraft | undefined>(undefined), controller = useRef<AbortController | undefined>(undefined), nextId = useRef(1);
  const [options, setOptions] = useState<PveOptions>();
  const [request, setRequest] = useState<PveRequest>(() => ({ version: 1, seed: seed(), mapId: 'pacific-islands', weather: 'partly-cloudy', difficulty: 'normal', groups: [{ id: 'front', name: 'Surface force', station: 'front' }, { id: 'rear', name: 'Carrier group', station: 'rear' }], ships: [] }));
  const [step, setStep] = useState<'briefing' | 'deployment'>('briefing');
  const [draft, setDraft] = useState<PveDraft>();
  const [placements, setPlacements] = useState<Placement[]>([]);
  const [query, setQuery] = useState(''), [groupId, setGroupId] = useState('front');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  useEffect(() => { if (loading) dialog.current?.close(); else dialog.current?.showModal(); }, [loading]);
  useEffect(() => {
    const abort = new AbortController(); controller.current = abort; setError('');
    void PveDraft.options(abort.signal).then(value => {
      if (abort.signal.aborted) return;
      setOptions(value);
      const id = value.eligiblePresets.includes(initialShipId) ? initialShipId : value.eligiblePresets[0];
      setRequest(r => r.ships.length ? r : { ...r, ships: [{ id: `unit-${nextId.current++}`, presetId: id, groupId: aircraftCount(id) ? 'rear' : 'front' }] });
      setGroupId(aircraftCount(id) ? 'rear' : 'front');
    }).catch(e => { if (!abort.signal.aborted) setError(String(e.message ?? e)); });
    return () => { abort.abort(); controller.current?.abort(); draftRef.current?.dispose(); };
  }, [initialShipId, retry]);
  const change = (next: PveRequest) => { draftRef.current?.dispose(); draftRef.current = undefined; setDraft(undefined); setRequest(next); setError(''); };
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
  const selectedGroup = request.groups.find(g => g.id === groupId) ?? request.groups[0];
  const filtered = options?.eligiblePresets.filter(id => `${shipPreset(id).name} ${id}`.toLowerCase().includes(query.toLowerCase().trim())) ?? [];
  const add = (id: string) => change({ ...request, ships: [...request.ships, { id: `unit-${nextId.current++}`, presetId: id, groupId: selectedGroup.id }] });
  const budgetView = budget && <div className="pve-budget" aria-label="Fleet allowances">{[
    ['Tonnage', `${tonnes(totals.displacementKg)} / ${tonnes(budget.maxDisplacementKg)} t`, totals.displacementKg, budget.maxDisplacementKg],
    ['Ships', `${totals.ships} / ${budget.maxShips}`, totals.ships, budget.maxShips],
    ['Aircraft', `${totals.aircraft} / ${budget.maxAircraft}`, totals.aircraft, budget.maxAircraft],
  ].map(([label, value, used, max]) => <div key={label} className={Number(used) > Number(max) ? 'is-error' : ''}><span>{label}</span><strong>{value}</strong><meter min={0} max={Number(max)} value={Number(used)} aria-label={String(label)}/></div>)}</div>;
  return <dialog ref={dialog} className="pve-setup" aria-labelledby="pve-title" onCancel={event => { event.preventDefault(); if (!loading) onClose(); }}>
    <header className="pve-header"><div><span className="pve-eyebrow">FLEET COMMAND · PvE</span><h1 id="pve-title">{step === 'briefing' ? 'Assemble your fleet' : 'Deploy your fleet'}</h1></div><nav aria-label="Mission preparation"><span aria-current={step === 'briefing' ? 'step' : undefined}>01 Briefing & fleet</span><span aria-current={step === 'deployment' ? 'step' : undefined}>02 Deployment</span></nav><Button variant="icon" aria-label="Close PvE setup" onClick={onClose} disabled={loading}><Icon name="close"/></Button></header>
    {!options ? <div className="pve-preparing" role="status">{error ? <><p>{error}</p><Button onClick={() => setRetry(r => r + 1)}>Retry</Button></> : 'Loading mission content…'}</div> : step === 'deployment' && draft ? <PveDeployment key={draft.briefing.setup.seed} briefing={draft.briefing} placements={placements} onChange={setPlacements} disabled={busy}/> : <div className="pve-briefing">
      <section className="pve-mission pve-scroll" aria-label="Mission briefing">
        <h2>Destroy the enemy fleet</h2><p>Sink or permanently incapacitate every enemy ship. Captains handle navigation, guns and local defense; you command the fleet.</p>
        <dl className="pve-mission-facts"><div><dt>Enemy strength</dt><dd>Scales to your selected fleet</dd></div><div><dt>Battle area</dt><dd>25 km radius · visible boundary</dd></div><div><dt>Time limit</dt><dd>None</dd></div></dl>
        <p className="pve-intel-note">Enemy positions are unknown. Surface forces can contest the front and report contacts while carrier groups patrol behind them.</p>
        {budgetView}
        <label>Waters<Select value={request.mapId} disabled={busy} onValueChange={mapId => change({ ...request, mapId })}>{OCEAN_MAPS.map(m => <SelectOption key={m.id} value={m.id}>{m.name}</SelectOption>)}</Select></label>
        <label>Weather<Select value={request.weather} disabled={busy} onValueChange={weather => change({ ...request, weather })}>{WEATHER_PRESETS.map(w => <SelectOption key={w.id} value={w.id}>{w.name}</SelectOption>)}</Select></label>
        <label>Enemy command<Select value={request.difficulty} disabled={busy} onValueChange={difficulty => change({ ...request, difficulty: difficulty as PveRequest['difficulty'] })}><SelectOption value="easy">Easy</SelectOption><SelectOption value="normal">Normal</SelectOption><SelectOption value="hard">Hard</SelectOption></Select></label>
        <div className="pve-seed"><small>Mission {request.seed.toString(16).toUpperCase().padStart(8, '0')}</small><Button disabled={busy} onClick={() => change({ ...request, seed: seed() })}>New opponent</Button></div>
      </section>
      <div className="pve-group-columns" aria-label="Your task groups">{request.groups.map(group => {
        const members = request.ships.filter(s => s.groupId === group.id);
        return <section className="pve-group-column" key={group.id} aria-label={group.name || 'Unnamed task group'}>
          <header><Input aria-label={`Task group name: ${group.name}`} maxLength={32} value={group.name} disabled={busy} onChange={e => change({ ...request, groups: request.groups.map(g => g.id === group.id ? { ...g, name: e.target.value } : g) })}/><small>{members.length} ships · {tonnes(fleetTotals(members).displacementKg)} t</small></header>
          <label className="pve-group-station">Opening position<Select aria-label={`Opening position for ${group.name}`} value={group.station} disabled={busy} onValueChange={station => change({ ...request, groups: request.groups.map(g => g.id === group.id ? { ...g, station: station as 'front' | 'rear' } : g) })}><SelectOption value="front">Front station</SelectOption><SelectOption value="rear">Rear patrol</SelectOption></Select></label>
          <p className="pve-standing-order">{group.station === 'front' ? 'Leader holds station. Escorts stay with it until you give new orders.' : 'Leader follows a broad patrol. Escorts remain in formation.'}</p>
          <ul className="pve-scroll pve-group-ships">{members.map(unit => <li key={unit.id}>
            <img src={assetUrl(`models/${unit.presetId}-thumbnail.png`)} alt="" width="112" height="38"/>
            <div><strong>{unitName(unit, request.ships)}</strong><small>{tonnes(shipPreset(unit.presetId).hull.massKg)} t{aircraftCount(unit.presetId) ? ` · ${aircraftCount(unit.presetId)} aircraft` : ''}</small></div>
            <Button variant="icon" aria-label={`Remove ${unitName(unit, request.ships)}`} disabled={busy} onClick={() => change({ ...request, ships: request.ships.filter(s => s.id !== unit.id) })}><Icon name="close" size={14}/></Button>
            <Select aria-label={`Task group for ${unitName(unit, request.ships)}`} value={unit.groupId} disabled={busy} onValueChange={groupId => change({ ...request, ships: request.ships.map(s => s.id === unit.id ? { ...s, groupId } : s) })}>{request.groups.map(g => <SelectOption key={g.id} value={g.id}>{g.name || 'Unnamed group'}</SelectOption>)}</Select>
          </li>)}</ul>
          <footer>{members.length ? <small>Guns & AA free · torpedoes held</small> : <p>Add ships from the catalog.</p>}{!members.length && request.groups.length > 1 && <Button disabled={busy} onClick={() => change({ ...request, groups: request.groups.filter(g => g.id !== group.id) })}>Remove empty group</Button>}</footer>
        </section>;
      })}<Button className="pve-add-group" disabled={busy || request.groups.length >= 9} onClick={() => { const id = `group-${nextId.current++}`; change({ ...request, groups: [...request.groups, { id, name: `Task group ${request.groups.length + 1}`, station: 'front' }] }); setGroupId(id); }}>+ Task group</Button></div>
      <section className="pve-catalog" aria-label="Ship catalog"><header><h2>Ship catalog</h2><label>Find a ship<Input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Name or class"/></label><label>Add ships to<Select value={selectedGroup.id} disabled={busy} onValueChange={setGroupId}>{request.groups.map(g => <SelectOption key={g.id} value={g.id}>{g.name || 'Unnamed group'}</SelectOption>)}</Select></label></header>
        <ul className="pve-scroll">{filtered.map(id => {
          const definition = shipPreset(id), over = budgetError([...request.ships, { id: 'preview', presetId: id, groupId: selectedGroup.id }], budget!);
          return <li key={id}><img src={assetUrl(`models/${id}-thumbnail.png`)} width="120" height="40" alt=""/><strong>{definition.name}</strong><small>{tonnes(definition.hull.massKg)} t{aircraftCount(id) ? ` · ${aircraftCount(id)} aircraft` : ''}</small><Button disabled={busy || !!over} title={over || `Add to ${selectedGroup.name}`} aria-label={`Add ${definition.name} to ${selectedGroup.name}`} onClick={() => add(id)}>Add <span aria-hidden="true">+</span></Button></li>;
        })}</ul>{!filtered.length && <p className="pve-empty">No ships match this search.</p>}
      </section>
    </div>}
    <footer className="pve-footer"><div role="status" className={error || invalid || groupInvalid ? 'is-error' : ''}>{error || invalid || groupInvalid || (busy ? 'Preparing your mission…' : step === 'deployment' ? 'Enemy composition and placement are fixed. Your deployment remains editable.' : 'Both teams use the same fleet allowances. Deploy when your fleet is ready.')}</div><div>{step === 'deployment' && <Button disabled={busy} onClick={() => setStep('briefing')}>Back to briefing</Button>}<Button variant="primary" disabled={!options || busy || !!invalid || !!groupInvalid || (step === 'deployment' && !!draft && !!placementError(draft.briefing, placements))} onClick={() => void (step === 'briefing' ? prepare() : launch())}>{busy ? 'Preparing…' : step === 'briefing' ? 'Deploy fleet' : 'Start battle'}<Icon name="arrow" size={18}/></Button></div></footer>
  </dialog>;
}
