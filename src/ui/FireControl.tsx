import { Select, SelectOption } from './components';
import { useState } from 'react';
import type { Game } from '../game/Game';
import type { CombatTelemetry } from '../simulation/combat';
import type { ControlPriority } from '../simulation/damageControl';
import './FireControl.css';

/** Existing CPU crew orders, exposed without interrupting the battle. */
export function FireControl({ combat, game, observedName }: { combat: CombatTelemetry; game: Game | null; observedName?: string }) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState(false);
  const ownBurning = combat.playerFires.filter(f => f.intensity > 0).length;
  const ownCooling = combat.playerFires.length - ownBurning;
  const fires = target ? combat.targetFireDetails : combat.playerFires;
  const control = combat.control;
  const canOrder = !observedName && !combat.playerSunk;
  const priority = canOrder ? game?.controlPriority ?? control.priority : control.priority;
  const focus = canOrder ? game?.controlFocus ?? control.focus : control.focus;
  const order = (value: ControlPriority, id = '') => {
    if (game && canOrder) { game.controlPriority = value; game.controlFocus = id; }
  };
  return <section className="fleet-fire-control" aria-label="Damage control">
    <button className="fleet-fire-toggle" aria-expanded={open} aria-controls="fire-control-detail" data-burning={ownBurning > 0} onClick={() => setOpen(!open)}>
      <strong>{ownBurning ? `${ownBurning} ${ownBurning === 1 ? 'fire' : 'fires'} ${observedName ? '· Observed ship' : 'aboard'}` : ownCooling ? `${ownCooling} ${ownCooling === 1 ? 'space' : 'spaces'} cooling` : 'Damage control'}</strong>
      <span>{open ? 'Close' : 'View crews'}</span>
    </button>
    {!open && ownBurning > 0 && <p className="fleet-fire-location">{combat.playerFires[0].name}{ownBurning > 1 ? ` +${ownBurning - 1}` : ''}</p>}
    {open && <div id="fire-control-detail" className="fleet-fire-detail">
      <div className="fleet-fire-tabs" role="group" aria-label="Fire report ship">
        <button aria-pressed={!target} onClick={() => setTarget(false)}>{observedName ? 'Observed ship' : 'Own ship'}</button>
        <button aria-pressed={target} onClick={() => setTarget(true)}>Target · {combat.targetFires} fires</button>
      </div>
      {target ? <p className="fleet-fire-note">{combat.targetName}{combat.targetSunk ? ' · Sunk' : ''}</p> : <>
        {observedName ? <p className="fleet-fire-note">{observedName} · Automatic crew orders</p> : <label className="fleet-fire-priority">Crew priority<Select value={priority} disabled={!canOrder} onValueChange={value => order(value as ControlPriority)}>
          <SelectOption value="balanced">Automatic · balanced</SelectOption><SelectOption value="fires">Fight fires first</SelectOption><SelectOption value="flooding">Flooding first</SelectOption><SelectOption value="repairs">Repairs first</SelectOption>
        </Select></label>}
        <p className="fleet-fire-note">{combat.playerSunk && !observedName ? 'Crews unavailable' : `${control.teams.filter(Boolean).length}/${control.teams.length} crews assigned · Fires, flooding and repairs`}</p>
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
