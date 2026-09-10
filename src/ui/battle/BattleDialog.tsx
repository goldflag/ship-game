import { useEffect, useRef, useState, type DragEvent } from 'react';
import { PveDraft, type PveOptions } from '../../game/session/PveDraft';
import { MatchConnection, pendingTicket, type JoinMode, type LobbyStatus, type RemoteBattleSession } from '../../game/session/RemoteBattleSession';
import type { Placement } from '../../multiplayer/generated/Placement';
import type { PveRequest } from '../../multiplayer/generated/PveRequest';
import { shipPreset, shipPresets } from '../../ships/presets';
import type { BattleSetup } from '../../simulation/battle';
import { Button } from '../components';
import { Icon } from '../Icons';
import { aircraftCount, unitName } from '../pveSetup';
import { BATTLE_MODES, carryToCustom, carryToDuel, carryToPve, fleetForCarry, saveBattleMode, type BattleMode } from './battleModes';
import { CustomLanes, CustomRail, customBrief, FormationSelect } from './CustomMode';
import { DeployScreen } from './DeployScreen';
import { applyCustomDeployment, applyPveDeployment, customDeployment, pveDeployment } from './deploymentModel';
import { DuelLanes, DuelRail, duelBrief } from './DuelMode';
import { duelBudget, type FleetTransfer } from './fleetTransfer';
import { missionSeed, PveLanes, PveRail, pveBrief, pveInvalid } from './PveMode';
import { ShipCatalog } from './ShipCatalog';
import './BattleDialog.css';

interface Props {
  initialMode: BattleMode; initialShipId: string; loading: boolean; onClose(): void;
  /** Review pages open directly on the deployment chart. */
  initialStep?: 'fleet' | 'deploy';
  setup: BattleSetup; onSetupChange(setup: BattleSetup): void; onLaunchCustom(): void; customError: string;
  pveRequest?: PveRequest; onLaunchPve(draft: PveDraft, placements: Placement[]): Promise<void>;
  onOnlineBattle(session: RemoteBattleSession): Promise<void>;
}
const ALL_SHIPS = Object.keys(shipPresets);
const defaultRequest = (): PveRequest => ({ version: 1, seed: missionSeed(), mapId: 'pacific-islands', weather: 'partly-cloudy', difficulty: 'normal', groups: [{ id: 'front', name: 'Group 1', station: 'front' }, { id: 'rear', name: 'Group 2', station: 'rear' }], ships: [] });

/** One battle screen for every mode: catalog, drop lanes and waters, then the deployment chart. */
export function BattleDialog({ initialMode, initialShipId, loading, onClose, initialStep = 'fleet', setup, onSetupChange, onLaunchCustom, customError, pveRequest, onLaunchPve, onOnlineBattle }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState<BattleMode>(initialMode);
  const [step, setStep] = useState<'fleet' | 'deploy'>(initialStep);
  const [transfer, setTransfer] = useState<FleetTransfer>();
  const [message, setMessage] = useState<{ text: string; error: boolean }>({ text: '', error: false });
  const notice = (text: string, error = true) => setMessage({ text, error });
  // PvE mission state. The draft's worker owns the hidden enemy from generation to launch.
  const [options, setOptions] = useState<PveOptions>();
  const [request, setRequest] = useState<PveRequest>(() => pveRequest ? structuredClone(pveRequest) : defaultRequest());
  const [draft, setDraft] = useState<PveDraft>(); const draftRef = useRef<PveDraft | undefined>(undefined);
  const [placements, setPlacements] = useState<Placement[]>([]);
  const [pveBusy, setPveBusy] = useState(false); const [optionsRetry, setOptionsRetry] = useState(0); const [optionsError, setOptionsError] = useState('');
  const nextId = useRef(Math.max(0, ...[...(pveRequest?.ships ?? []), ...(pveRequest?.groups ?? [])].map(s => Number(s.id.match(/(\d+)$/)?.[1]) || 0)) + 1);
  const newId = () => `unit-${nextId.current++}`;
  const pendingCarry = useRef<string[] | undefined>(undefined);
  const controller = useRef<AbortController | undefined>(undefined);
  // 1v1 state. The connection is cancelled unless the match transfers into a battle.
  const [fleet, setFleet] = useState([initialShipId]); const [code, setCode] = useState('');
  const [duelBusy, setDuelBusy] = useState(false); const [status, setStatus] = useState<LobbyStatus>({ message: '' });
  const connection = useRef<MatchConnection | undefined>(undefined); const transferred = useRef(false); const active = useRef(true);

  useEffect(() => { active.current = true; return () => { active.current = false; if (!transferred.current) connection.current?.cancel(); controller.current?.abort(); draftRef.current?.dispose(); }; }, []);
  useEffect(() => { if (loading) dialog.current?.close(); else if (!dialog.current?.open) dialog.current?.showModal(); }, [loading]);
  useEffect(() => { saveBattleMode(mode); }, [mode]);
  useEffect(() => {
    if (mode !== 'pve' || options) return;
    const abort = new AbortController(); controller.current = abort; setOptionsError('');
    void PveDraft.options(abort.signal).then(value => {
      if (abort.signal.aborted) return;
      setOptions(value);
      setRequest(current => {
        if (current.ships.length) return current;
        const carried = carryToPve(current, pendingCarry.current ?? [], value.eligiblePresets, value.rules.budget, newId);
        pendingCarry.current = undefined;
        if (carried.ships.length) return carried;
        const id = value.eligiblePresets.includes(initialShipId) ? initialShipId : value.eligiblePresets[0];
        return id ? { ...current, ships: [{ id: newId(), presetId: id, groupId: (current.groups.find(group => group.station === (aircraftCount(id) ? 'rear' : 'front')) ?? current.groups[0]).id }] } : current;
      });
    }).catch(error => { if (!abort.signal.aborted) setOptionsError(String(error.message ?? error)); });
    return () => abort.abort();
  }, [mode, options, optionsRetry, initialShipId]);

  const changeRequest = (next: PveRequest) => { draftRef.current?.dispose(); draftRef.current = undefined; setDraft(undefined); setRequest(next); setMessage({ text: '', error: false }); };
  const switchMode = (next: BattleMode) => {
    if (next === mode || pveBusy || duelBusy) return;
    const ids = fleetForCarry(mode, { setup, request: options ? request : pveRequest, duel: fleet });
    if (next === 'custom') onSetupChange(carryToCustom(setup, ids));
    else if (next === 'duel') setFleet(current => carryToDuel(current, initialShipId, ids));
    else if (options) { const carried = carryToPve(request, ids, options.eligiblePresets, options.rules.budget, newId); if (carried !== request) changeRequest(carried); }
    else pendingCarry.current = ids;
    setMode(next); setStep('fleet'); setTransfer(undefined); setMessage({ text: '', error: false });
  };
  const preparePve = async () => {
    if (pveBusy || !options) return;
    if (draft) { setStep('deploy'); return; }
    setPveBusy(true); setMessage({ text: '', error: false });
    const abort = new AbortController(); controller.current = abort;
    try {
      const prepared = await PveDraft.create(request, abort.signal);
      if (abort.signal.aborted) { prepared.dispose(); return; }
      draftRef.current = prepared; setDraft(prepared);
      setPlacements(prepared.briefing.setup.ships.map(ship => ({ id: ship.id, spawn: ship.spawn! }))); setStep('deploy');
    } catch (error) { if (!abort.signal.aborted) notice(error instanceof Error ? error.message : String(error)); }
    finally { if (!abort.signal.aborted) setPveBusy(false); }
  };
  const launchPve = async () => {
    if (!draft || pveBusy) return;
    setPveBusy(true); setMessage({ text: '', error: false });
    try { await draft.validate(placements); }
    catch (error) { notice(error instanceof Error ? error.message : String(error)); setPveBusy(false); return; }
    try { await onLaunchPve(draft, placements); }
    catch (error) {
      notice(error instanceof Error ? error.message : String(error));
      // A graphics/worker failure may consume the draft. Regenerating this exact request keeps the frozen opponent.
      draft.dispose(); draftRef.current = undefined; setDraft(undefined); setStep('fleet');
    } finally { setPveBusy(false); }
  };
  const join = async (joinMode?: JoinMode) => {
    if (duelBusy) return;
    setDuelBusy(true); setStatus({ message: 'Connecting…' }); setMessage({ text: '', error: false });
    try {
      const update = (value: LobbyStatus) => { if (active.current) setStatus(value); };
      const next = joinMode ? await MatchConnection.join(fleet, joinMode, code.trim().toLowerCase(), update) : MatchConnection.resume(update);
      connection.current = next;
      if (!active.current) { void next.matched.catch(() => {}); next.cancel(); return; }
      const session = await next.matched;
      transferred.current = true; // Transfer before loading so the dialog's unmount doesn't surrender the match.
      await onOnlineBattle(session);
    } catch (error) {
      transferred.current = false; connection.current?.cancel();
      if (active.current) { setDuelBusy(false); setStatus({ message: '' }); notice(error instanceof Error ? error.message : String(error)); }
    }
  };
  const cancelJoin = () => { connection.current?.cancel(); connection.current = undefined; setDuelBusy(false); setStatus({ message: '' }); };
  const close = () => { if (duelBusy) cancelJoin(); if (!loading) onClose(); };

  const busy = pveBusy || duelBusy, catalogDisabled = busy || step === 'deploy';
  const startCatalogDrag = (id: string, event: DragEvent<HTMLElement>) => {
    event.stopPropagation();
    if (catalogDisabled) { event.preventDefault(); return; }
    event.dataTransfer.effectAllowed = 'copy'; event.dataTransfer.setData('text/plain', id); setTransfer({ kind: 'catalog', id }); setMessage({ text: '', error: false });
  };
  const pick = (id: string) => { setTransfer(transfer?.kind === 'catalog' && transfer.id === id ? undefined : { kind: 'catalog', id }); setMessage({ text: '', error: false }); };
  const unavailable = (id: string): string => {
    if (mode === 'pve') { if (!options) return ''; if (!options.eligiblePresets.includes(id)) return 'Not available in fleet command yet.'; return pveInvalid({ ...request, ships: [...request.ships, { id: 'preview', presetId: id, groupId: request.groups[0]?.id ?? 'front' }] }, options).replace('Fleet exceeds', 'Would exceed'); }
    if (mode === 'duel') return duelBudget([...fleet, id]).error ?? '';
    return '';
  };
  const transferName = !transfer ? '' : transfer.kind === 'catalog' ? shipPreset(transfer.id).name
    : mode === 'pve' ? (request.ships.find(ship => ship.id === transfer.id) ? unitName(request.ships.find(ship => ship.id === transfer.id)!, request.ships) : '') : 'the ship';
  const customPlacement = mode === 'custom' && step === 'deploy' ? customDeployment(setup) : undefined;
  const pveInvalidText = mode === 'pve' ? pveInvalid(request, options) : '';
  const brief = mode === 'custom' ? customBrief(setup) : mode === 'pve' ? pveBrief(request) : duelBrief(fleet);
  const primary = (() => {
    if (mode === 'custom') return step === 'fleet' ? { label: 'Deploy fleet', disabled: !setup.enemies.length, run: () => { setTransfer(undefined); setStep('deploy'); } } : { label: 'Start battle', disabled: !!customPlacement?.error || loading, run: onLaunchCustom };
    if (mode === 'pve') return step === 'fleet' ? { label: pveBusy ? 'Preparing…' : 'Deploy fleet', disabled: !options || pveBusy || !!pveInvalidText, run: () => { setTransfer(undefined); void preparePve(); } }
      : { label: pveBusy ? 'Preparing…' : 'Start battle', disabled: pveBusy || !draft || !!pveDeployment(draft.briefing, placements).error, run: () => void launchPve() };
    return { label: 'Find opponent', disabled: duelBusy || !!duelBudget(fleet).error, run: () => void join('queue') };
  })();
  const canResume = (() => { try { return pendingTicket(); } catch { return false; } })();
  const statusText = message.text || customError || (busy ? (pveBusy ? 'Preparing your mission…' : status.message) : transfer ? `Choose a lane for ${transferName}.` : mode === 'pve' && optionsError ? optionsError : '');
  const statusError = message.error || !!customError || (!!optionsError && !message.text && !busy);

  return <dialog ref={dialog} className="battle-dialog" aria-labelledby="battle-title" onCancel={event => { event.preventDefault(); if (transfer) setTransfer(undefined); else close(); }}>
    <header className="battle-top">
      <h1 id="battle-title" className="battle-title"><Icon name="anchor" size={20}/>Battle</h1>
      <div className="battle-modes" role="tablist" aria-label="Battle mode">
        {BATTLE_MODES.map(entry => <button type="button" key={entry.id} role="tab" aria-selected={mode === entry.id} disabled={busy} title={entry.summary} onClick={() => switchMode(entry.id)}>{entry.name}</button>)}
      </div>
      <p className="battle-mode-summary">{step === 'deploy' ? <>Fleet <b>› Deploy</b></> : BATTLE_MODES.find(entry => entry.id === mode)!.summary}</p>
      <Button variant="icon" className="battle-close" aria-label="Close battle setup" disabled={loading} onClick={close}><Icon name="close"/></Button>
    </header>
    {step === 'deploy' && mode === 'custom' && customPlacement && <DeployScreen deployment={customPlacement} disabled={loading} fitKey={`${setup.mapId}:${setup.spawnDistance}:${setup.formation ?? 'line'}:${setup.friendlyBots.length}:${setup.enemies.length}`}
      onChange={units => onSetupChange(applyCustomDeployment(setup, units))} onReset={() => onSetupChange({ ...setup, spawns: undefined })} tools={<FormationSelect setup={setup} onChange={onSetupChange} compact/>}/>}
    {step === 'deploy' && mode === 'pve' && draft && <DeployScreen key={draft.briefing.setup.seed} deployment={pveDeployment(draft.briefing, placements)} disabled={pveBusy} fitKey={String(draft.briefing.setup.seed)}
      onChange={units => setPlacements(applyPveDeployment(units))} onReset={() => setPlacements(draft.briefing.setup.ships.map(ship => ({ id: ship.id, spawn: ship.spawn! })))}/>}
    {step === 'fleet' && <div className="battle-body">
      <ShipCatalog ships={ALL_SHIPS} hint={mode === 'custom' ? 'Drag into a lane' : mode === 'pve' ? 'Drag into a group' : 'Drag into a berth'} picked={transfer?.kind === 'catalog' ? transfer.id : undefined} commanded={mode === 'custom' ? setup.playerShipId : undefined}
        disabled={catalogDisabled} unavailable={unavailable} onPick={pick} onDragStart={startCatalogDrag} onDragEnd={() => setTransfer(undefined)}/>
      <div className="battle-center">
        {mode === 'custom' && <CustomLanes setup={setup} onChange={next => { onSetupChange(next); setMessage({ text: '', error: false }); }} transfer={transfer} onTransfer={setTransfer} onError={notice} disabled={busy}/>}
        {mode === 'pve' && (options ? <PveLanes request={request} options={options} onChange={changeRequest} transfer={transfer} onTransfer={setTransfer} onError={notice} nextId={newId} disabled={busy}/>
          : <div className="battle-preparing" role="status">{optionsError ? <><p>{optionsError}</p><Button onClick={() => setOptionsRetry(value => value + 1)}>Retry</Button></> : 'Loading mission content…'}</div>)}
        {mode === 'duel' && <DuelLanes fleet={fleet} onChange={setFleet} transfer={transfer} onTransfer={setTransfer} onError={notice} disabled={busy}/>}
      </div>
      <aside className="battle-rail" aria-label="Battle settings">
        {mode === 'custom' && <CustomRail setup={setup} onChange={onSetupChange} disabled={busy}/>}
        {mode === 'pve' && <PveRail request={request} onChange={changeRequest} disabled={busy}/>}
        {mode === 'duel' && <DuelRail fleet={fleet} busy={duelBusy} status={status} code={code} onCode={setCode} onJoin={joinMode => void join(joinMode)} onResume={canResume ? () => void join() : undefined} onCancel={cancelJoin} disabled={loading}/>}
      </aside>
    </div>}
    <footer className="battle-footer">
      <div className="battle-brief"><Icon name="compass" size={20}/><p><strong>{brief[0]}</strong>{brief.slice(1).map(line => <span key={line}>{line}</span>)}</p></div>
      <p className={`battle-status ${statusError ? 'is-error' : ''}`} role={statusError ? 'alert' : 'status'}>{statusText}</p>
      {step === 'deploy' ? <Button disabled={busy} onClick={() => setStep('fleet')}>Back to fleet</Button> : <Button variant="secondary" disabled={loading} onClick={close}>{duelBusy ? 'Cancel' : 'Back to port'}</Button>}
      <Button variant="primary" disabled={primary.disabled} onClick={primary.run}>{primary.label}<Icon name="arrow" size={18}/></Button>
    </footer>
  </dialog>;
}
