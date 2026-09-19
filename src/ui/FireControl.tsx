import { useState } from 'react';
import type { FleetDesk } from './fleet/fleetDesk';
import './FireControl.css';
import type { ControlPriority } from '../multiplayer/generated/ControlPriority';
import { hasFullTarget, type CombatTelemetry } from '../game/session/telemetry';

const PRIORITIES: readonly { value: ControlPriority; label: string; title: string }[] = [
  { value: 'balanced', label: 'Auto', title: 'Automatic · balanced' }, { value: 'fires', label: 'Fires', title: 'Fight fires first' },
  { value: 'flooding', label: 'Flooding', title: 'Flooding first' }, { value: 'repairs', label: 'Repairs', title: 'Repairs first' },
];

/** Existing CPU crew orders, exposed without interrupting the battle. They are the ship's own
 * state, so they ride on the ship card: one quiet line that turns amber and names the space
 * when something burns, and a panel that opens beside the card, below the horizon. */
export function FireControl({ combat, desk, observedName }: { combat: CombatTelemetry; desk: FleetDesk | null; observedName?: string }) {
  const [open, setOpen] = useState(false);
  const [targetRequested, setTarget] = useState(false);
  const target = targetRequested && hasFullTarget(combat);
  const ownBurning = combat.playerFires.filter(f => f.intensity > 0).length;
  const ownCooling = combat.playerFires.length - ownBurning;
  const fires = target ? combat.targetFireDetails ?? [] : combat.playerFires;
  const control = combat.control;
  const canOrder = !observedName && !combat.playerSunk;
  const priority = canOrder ? desk?.damageControl.priority ?? control.priority : control.priority;
  const focus = canOrder ? desk?.damageControl.focus ?? control.focus : control.focus;
  const order = (value: ControlPriority, id = '') => {
    if (desk && canOrder) desk.issue({ kind: 'damage-control', priority: value, focus: id });
  };
  const crews = `${control.teams.filter(Boolean).length}/${control.teams.length}`;
  const priorityLabel = PRIORITIES.find(p => p.value === priority)?.title ?? 'Automatic · balanced';
  return <section className="fleet-fire-control" aria-label="Damage control">
    <button className="fleet-fire-toggle" aria-expanded={open} aria-controls="fire-control-detail" data-burning={ownBurning > 0} onClick={event => { setOpen(!open); event.currentTarget.blur(); }}>
      <strong>{ownBurning ? `${ownBurning} ${ownBurning === 1 ? 'fire' : 'fires'}${observedName ? ' · Observed ship' : ''} · ${combat.playerFires.find(f => f.intensity > 0)!.name}${ownBurning > 1 ? ` +${ownBurning - 1}` : ''}` : ownCooling ? `${ownCooling} ${ownCooling === 1 ? 'space' : 'spaces'} cooling` : 'Damage control'}</strong>
      <span>{ownBurning ? `crews ${crews}` : observedName ? 'Automatic' : priorityLabel}</span>
    </button>
    {open && <div id="fire-control-detail" className="fleet-fire-detail">
      <div className="fleet-fire-head"><h2>Damage control</h2><button onClick={() => setOpen(false)}>Close</button></div>
      {hasFullTarget(combat) && <div className="fleet-fire-tabs" role="group" aria-label="Fire report ship">
        <button aria-pressed={!target} onClick={() => setTarget(false)}>{observedName ? 'Observed ship' : 'Own ship'}</button>
        <button aria-pressed={target} onClick={() => setTarget(true)}>Target · {combat.targetFires} fires</button>
      </div>}
      {target ? <p className="fleet-fire-note">{combat.targetName}{combat.targetSunk ? ' · Sunk' : ''}</p> : <>
        {observedName ? <p className="fleet-fire-note">{observedName} · Automatic crew orders</p> : <div className="fleet-fire-priority" role="group" aria-label="Crew priority">
          {PRIORITIES.map(option => <button key={option.value} title={option.title} disabled={!canOrder} aria-pressed={priority === option.value} onClick={event => { order(option.value); event.currentTarget.blur(); }}>{option.label}</button>)}
        </div>}
        <p className="fleet-fire-note">{combat.playerSunk && !observedName ? 'Crews unavailable' : `${crews} crews assigned · Fires, flooding and repairs`}</p>
        {focus && canOrder && <button className="fleet-fire-release" onClick={() => order(priority)}>Release focus · {combat.controlTargets.find(t => t.id === focus)?.name ?? focus}</button>}
      </>}
      <div className="fleet-fire-list" tabIndex={0} aria-label={target ? 'Target fires' : observedName ? 'Observed ship fires' : 'Own fires'}>
        {fires.length === 0 ? <p className="fleet-fire-empty">{target ? 'No active fires on target.' : 'No active fires. Crews manage damage automatically.'}</p> : fires.map(fire => <article key={fire.id} className="fleet-fire-row">
          <div className="fleet-fire-heading"><strong>{fire.name}</strong><span>{fire.location} · {fire.status}</span></div>
          <div className="fleet-fire-intensity"><span>Fire intensity</span><strong>{Math.round(fire.intensity * 100)}%</strong></div>
          <meter min={0} max={1} value={fire.intensity} aria-label={`${fire.name} fire intensity`}/>
          <p>{Math.round(fire.fuelFraction * 100)}% combustible load left</p>
          {fire.threat && <p className="fleet-fire-threat">At risk: {fire.threat}</p>}
          <div className="fleet-fire-crew"><span>{fire.crew}{fire.setupSeconds > 0 ? ` · ${Math.ceil(fire.setupSeconds)}s` : ''}</span>
            {!target && !observedName && <button disabled={!canOrder} aria-pressed={focus === fire.id} aria-label={`${focus === fire.id ? 'Release crew focus on' : 'Focus crews on'} ${fire.name}`} onClick={() => order('fires', focus === fire.id ? '' : fire.id)}>{focus === fire.id ? 'Focused' : 'Focus crews'}</button>}
          </div>
        </article>)}
      </div>
    </div>}
  </section>;
}
