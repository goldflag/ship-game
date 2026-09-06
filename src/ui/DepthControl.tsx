import type { Game } from '../game/Game';
import type { CombatTelemetry } from '../simulation/combat';
import { bindingLabel, type Keybindings } from '../game/keybindings';
import './DepthControl.css';

export function DepthControl({ combat, game, bindings }: { combat: CombatTelemetry; game: Game | null; bindings: Keybindings }) {
  const dive = combat.submarine;
  if (!dive) return null;
  const moving = Math.abs(dive.verticalSpeed) > .08;
  const state = combat.playerSunk ? 'Sinking' : dive.emergencyBlow ? 'Emergency blow' : moving ? dive.verticalSpeed < 0 ? 'Diving' : 'Rising' : dive.depthM < .5 ? 'Surfaced' : 'Holding depth';
  const order = (depth: number, emergency = false) => game?.setDepth(depth, emergency);
  return <section className="fleet-depth" aria-label="Depth and ballast">
    <div className="fleet-depth-reading"><h2>Depth</h2><strong>{dive.depthM.toFixed(1)} <small>m</small></strong></div>
    <p className="fleet-depth-order">Ordered {dive.targetDepthM} m <span>{state}</span></p>
    <div className="fleet-depth-scale" role="meter" aria-label="Depth below surface" aria-valuenow={Number(dive.depthM.toFixed(1))} aria-valuemin={0} aria-valuemax={Math.max(dive.maxDepthM, dive.depthM)}>
      <i style={{ width: `${Math.min(100, dive.depthM / dive.maxDepthM * 100)}%` }}/><b title={`Ordered ${dive.targetDepthM} m`} style={{ left: `${dive.targetDepthM / dive.maxDepthM * 100}%` }}/>
    </div>
    <p className="fleet-depth-machinery"><span>Ballast {Math.round(dive.ballastFraction * 100)}%</span><span>{dive.propulsion} · {Math.abs(dive.verticalSpeed).toFixed(1)} m/s</span></p>
    <fieldset disabled={combat.playerSunk}>
      <legend className="visually-hidden">Depth orders</legend>
      <div className="fleet-depth-presets">{[[0, 'Surface'], [dive.periscopeDepthM, 'Periscope'], [Math.min(50, dive.maxDepthM), 'Dive 50 m']].map(([depth, label]) => <button key={label} aria-pressed={!dive.emergencyBlow && dive.targetDepthM === depth} onClick={e => { order(Number(depth)); e.currentTarget.blur(); }}>{label}</button>)}</div>
      <div className="fleet-depth-adjust"><button disabled={dive.targetDepthM <= 0} title={`Rise 10 m · ${bindingLabel(bindings, 'rise')}`} onClick={e => { order(dive.targetDepthM - 10); e.currentTarget.blur(); }}>Rise 10 m <kbd>{bindingLabel(bindings, 'rise')}</kbd></button><button disabled={dive.targetDepthM >= dive.maxDepthM} title={`Dive 10 m · ${bindingLabel(bindings, 'dive')}`} onClick={e => { order(dive.targetDepthM + 10); e.currentTarget.blur(); }}>Dive 10 m <kbd>{bindingLabel(bindings, 'dive')}</kbd></button></div>
      <button className="fleet-depth-blow" aria-pressed={dive.emergencyBlow} onClick={e => { order(0, true); e.currentTarget.blur(); }}>Emergency blow <kbd>{bindingLabel(bindings, 'emergencyBlow')}</kbd></button>
    </fieldset>
    {dive.depthM >= dive.maxDepthM - 5 && <p className="fleet-depth-warning" role="status">Depth limit {dive.maxDepthM} m · Rise to reduce pressure</p>}
    {(combat.battery !== 'torpedo' && dive.depthM > .5 || combat.battery === 'torpedo' && dive.depthM > dive.maxTorpedoDepthM) && <p className="fleet-depth-warning">{combat.battery === 'torpedo' ? `Torpedoes: rise to ${dive.maxTorpedoDepthM} m or less` : 'Guns secured · Surface to fire'}</p>}
  </section>;
}
