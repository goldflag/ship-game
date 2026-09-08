import { useState } from 'react';
import type { Game } from '../game/Game';
import type { CombatTelemetry } from '../simulation/combat';
export function FleetOrders({ game, combat }: { game: Game | null; combat: CombatTelemetry }) {
  const [recipient, setRecipient] = useState(''); const [x, setX] = useState('0'); const [z, setZ] = useState('0');
  const [notice, setNotice] = useState('');
  const session = game?.simulation;
  if (!session?.selectShip) return null;
  const ships = combat.contacts.filter(c => c.team === 'friendly' && !c.physicalLost);
  const id = ships.some(s => s.id === recipient) ? recipient : ships.find(s => s.id === session.ship.id)?.id ?? ships[0]?.id ?? '';
  const enabled = !!id && combat.result === 'active' && session.phase === 'running';
  const send = (order: () => void, message: string) => { order(); setNotice(message); };
  return <details className="fleet-orders"><summary>Fleet orders</summary>
    <label>Order vessel <select aria-label="Order vessel" value={id} onChange={e => setRecipient(e.target.value)}>{ships.map(s => <option value={s.id} key={s.id}>{s.name} · {s.id}</option>)}</select></label>
    <div className="fleet-orders-controls">
      <button disabled={!enabled || id === session.ship.id} onClick={() => send(() => session.selectShip?.(id), 'Command transfer requested')}>Take helm</button>
      <button disabled={!enabled} onClick={() => send(() => session.holdShip?.(id), 'Hold position ordered')}>Hold</button>
      <button disabled={!enabled} onClick={() => send(() => session.automateShip?.(id), 'Autonomous movement ordered')}>Autonomous</button>
      <button disabled={!enabled || !combat.targetId} onClick={() => send(() => session.focusShip?.(id, combat.targetId), 'Focus target ordered')}>Attack selected enemy</button>
    </div>
    <div className="fleet-orders-controls">
      <button disabled={!enabled} onClick={() => { if (game) game.fleetWaypointShipId = id; setNotice('Click the navigation chart to set a waypoint'); }}>Chart waypoint</button>
      <label>X m <input aria-label="Waypoint X meters" type="number" min="-40000" max="40000" value={x} onChange={e => setX(e.target.value)}/></label>
      <label>Z m <input aria-label="Waypoint Z meters" type="number" min="-40000" max="40000" value={z} onChange={e => setZ(e.target.value)}/></label>
      <button disabled={!enabled || !x || !z || ![Number(x), Number(z)].every(n => Number.isFinite(n) && Math.abs(n) <= 40000)} onClick={() => send(() => session.moveShip?.(id, [Number(x), 0, Number(z)]), 'Waypoint ordered')}>Move</button>
    </div>
    <small>Engine or rudder changes resume manual steering. Other vessels retain their orders.</small>
    {notice && <p role="status">{notice}</p>}
  </details>;
}
