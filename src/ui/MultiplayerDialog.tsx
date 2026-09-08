import { useEffect, useRef, useState } from 'react';
import { Button, Input } from './components';
import { shipPresets, shipPreset } from '../ships/presets';
import { fleetBudget } from '../simulation/battleRules';
import { MatchConnection, pendingTicket, type JoinMode, type RemoteBattleSession, type LobbyStatus } from '../game/session/RemoteBattleSession';
import './Multiplayer.css';
const definitions = new Map(Object.keys(shipPresets).map(id => [id, shipPreset(id)]));
export function MultiplayerDialog({ initialShipId, loading, onBattle, onClose }: { initialShipId: string; loading?: boolean; onBattle(session: RemoteBattleSession): Promise<void>; onClose(): void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const connection = useRef<MatchConnection | undefined>(undefined);
  const transferred = useRef(false); const active = useRef(true);
  const [fleet, setFleet] = useState([initialShipId]); const [filter, setFilter] = useState(''); const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false); const [status, setStatus] = useState<LobbyStatus>({ message: '' });
  const budget = fleetBudget(fleet, definitions);
  useEffect(() => { active.current = true; dialog.current?.showModal(); return () => { active.current = false; if (!transferred.current) connection.current?.cancel(); }; }, []);
  useEffect(() => { if (loading) dialog.current?.close(); else dialog.current?.showModal(); }, [loading]);
  const join = async (mode?: JoinMode) => {
    if (busy) return;
    setBusy(true); setStatus({ message: 'Connecting…' });
    try {
      const update = (value: LobbyStatus) => { if (active.current) setStatus(value); };
      const next = mode ? await MatchConnection.join(fleet, mode, code.trim().toLowerCase(), update) : MatchConnection.resume(update);
      connection.current = next;
      if (!active.current) { void next.matched.catch(() => {}); next.cancel(); return; }
      const session = await next.matched;
      // Transfer before loading so the dialog's unmount doesn't surrender the match.
      transferred.current = true;
      await onBattle(session);
    } catch (error) {
      transferred.current = false; connection.current?.cancel();
      if (active.current) { setBusy(false); setStatus({ message: '', error: error instanceof Error ? error.message : String(error) }); }
    }
  };
  return <dialog ref={dialog} className="multiplayer-dialog" aria-labelledby="multiplayer-title" onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="menu-heading"><h2 id="multiplayer-title">1v1 fleet battle</h2><Button variant="secondary" onClick={onClose}>{busy ? 'Cancel' : 'Close'}</Button></div>
    <p>Choose up to 8 vessels, including 2 carriers, within 200,000 tonnes. After 30 minutes, the fleet with more tonnage afloat wins.</p>
    <p>Map, weather and daylight are drawn when matched. Night battles occur less often.</p>
    {!busy ? <>
      {pendingTicket() && <Button variant="primary" onClick={() => void join()}>Reconnect to previous battle</Button>}
      <div className="multiplayer-fleet-grid">
        <section aria-label="Available ships"><Input aria-label="Find a ship" placeholder="Find a ship" value={filter} onChange={event => setFilter(event.target.value)}/>
          <ul>{Object.entries(shipPresets).filter(([, ship]) => ship.name.toLowerCase().includes(filter.toLowerCase())).map(([id, ship]) => <li key={id}>
            <span>{ship.name}<small>{Math.round(ship.hull.massKg / 1000).toLocaleString()} t{'airWing' in ship && ship.airWing ? ' · Carrier' : ''}</small></span>
            <Button variant="secondary" aria-label={`Add ${ship.name}`} disabled={!!fleetBudget([...fleet, id], definitions).error} onClick={() => setFleet([...fleet, id])}>Add</Button>
          </li>)}</ul>
        </section>
        <section aria-label="Your fleet"><h3>Your fleet</h3><p className="multiplayer-budget" role="status">{(budget.displacementKg / 1000).toLocaleString()} / 200,000 t · {budget.vessels} / 8 vessels · {budget.carriers} / 2 carriers</p>
          <ol>{fleet.map((id, i) => <li key={i}><span>{shipPreset(id).name}{i === 0 && <small>Initial command ship</small>}</span><Button variant="secondary" aria-label={`Remove ${shipPreset(id).name} vessel ${i + 1}`} onClick={() => setFleet(fleet.filter((_, index) => index !== i))}>Remove</Button></li>)}</ol>
          {budget.error && <p role="status">{budget.error}</p>}
        </section>
      </div>
      <div className="multiplayer-actions"><Button variant="primary" disabled={!!budget.error} onClick={() => void join('queue')}>Find opponent</Button><Button variant="secondary" disabled={!!budget.error} onClick={() => void join('create-invite')}>Create invite</Button></div>
      <div className="multiplayer-actions"><Input aria-label="Invite code" maxLength={12} value={code} onChange={event => setCode(event.target.value)} placeholder="Invite code"/><Button variant="secondary" disabled={!!budget.error || !/^[a-f0-9]{12}$/i.test(code.trim())} onClick={() => void join('join-invite')}>Join invite</Button></div>
    </> : <div className="multiplayer-waiting" role="status"><h3>{status.message}</h3>{status.inviteCode && <><p>Give this code to your opponent:</p><strong className="multiplayer-code">{status.inviteCode}</strong><p>Your fleet is locked while waiting.</p></>}</div>}
    {status.error && <p role="alert" className="error-message">{status.error}</p>}
  </dialog>;
}
