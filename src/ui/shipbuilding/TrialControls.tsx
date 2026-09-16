import { useState } from 'react';
import type { TrialAction } from '../../game/session/localConstruction';
import type { BattleSession } from '../../game/session/BattleSession';
import { Button } from '../components';
import './TrialControls.css';

/** The sea trial's hold on the game: the hulls under trial and the two trial verbs. */
export interface TrialSession { readonly simulation: Pick<BattleSession, 'actors' | 'player'>; trialAction(action: TrialAction): Promise<void>; resetTrial(): Promise<void> }
export function TrialControls({ game, onReturn }: { game: TrialSession; onReturn(): Promise<void> }) {
  const actor = game.simulation.actors.find(a => a.motion.id === 'player') ?? game.simulation.player;
  const definition = actor.definition;
  const [roomId, setRoomId] = useState(definition.compartments[0]?.id ?? '');
  const [moduleId, setModuleId] = useState(definition.modules[0]?.id ?? '');
  const [percent, setPercent] = useState(25);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const room = definition.compartments.find(c => c.id === roomId);
  const water = actor.damage.compartments.find(c => c.id === roomId)?.waterM3 ?? 0;
  const run = async (operation: () => Promise<void>) => {
    if (busy) return; setBusy(true); setError('');
    try { await operation(); } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  const act = (action: TrialAction) => void run(() => game.trialAction(action));
  return <details className="construction-trial-controls">
    <summary>Sea trial <span>{definition.name} · {Math.round(definition.hull.massKg / 1000).toLocaleString()} t</span></summary>
    <div className="construction-trial-body">
      <p>Use the normal helm and weapons controls. The target ship holds position. Damage affects this trial; your source design stays in the shipbuilder.</p>
      <div className="construction-trial-row">
        <label>Compartment<select value={roomId} onChange={e => setRoomId(e.target.value)}>{definition.compartments.map(c => <option value={c.id} key={c.id}>{c.name}</option>)}</select></label>
        <label>Fill %<input type="number" min="0" max="100" step="5" value={percent} onChange={e => setPercent(Math.max(0, Math.min(100, Number(e.target.value))))}/></label>
        <Button disabled={busy || !room} onClick={() => room && act({ kind: 'flood', actorId: actor.motion.id, compartmentId: room.id, amount: room.capacityM3 * percent / 100 })}>Set flooding</Button>
      </div>
      <p className="construction-trial-reading">Water {water.toFixed(1)} / {(room?.capacityM3 ?? 0).toFixed(1)} m³ · Roll {(actor.motion.roll * 180 / Math.PI).toFixed(1)}° · Trim {(actor.motion.pitch * 180 / Math.PI).toFixed(1)}° · Hull HP {actor.damage.integrity.toFixed(0)}</p>
      <div className="construction-trial-row">
        <label>Equipment<select value={moduleId} onChange={e => setModuleId(e.target.value)}>{definition.modules.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
        <Button disabled={busy || !moduleId} onClick={() => act({ kind: 'module-damage', actorId: actor.motion.id, moduleId, amount: 1e9 })}>Disable equipment</Button>
        <Button disabled={busy || actor.damage.sunk} onClick={() => act({ kind: 'damage', actorId: actor.motion.id, amount: actor.damage.integrity * .25 })}>Damage hull 25%</Button>
      </div>
      <div className="construction-trial-row"><Button disabled={busy} onClick={() => void run(() => game.resetTrial())}>Reset trial</Button><Button variant="primary" disabled={busy} onClick={() => void run(onReturn)}>Return to shipbuilder</Button></div>
      {error && <p role="alert">{error}</p>}
    </div>
  </details>;
}
