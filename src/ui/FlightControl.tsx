import type { Game } from '../game/Game';
import type { CombatTelemetry } from '../simulation/combat';
import { AIR_STATUS_LABELS } from '../simulation/airTelemetry';
import { bindingLabel, type Keybindings } from '../game/keybindings';
import './FlightControl.css';

export function FlightControl({ combat, game, bindings }: { combat: CombatTelemetry; game: Game | null; bindings: Keybindings }) {
  const wing = combat.airWing;
  if (!wing) return null;
  return <section className="fleet-flight" aria-label="Carrier aircraft operations">
    <h2><button className="fleet-flight-open" aria-label={`Open air operations map · ${bindingLabel(bindings, 'airOperations')}`} title="Open air operations map" onClick={e => { game?.setAirOperationsOpen(true); e.currentTarget.blur(); }}>
      <span>Air wing</span><span className="fleet-wing-total">{wing.total - wing.counts.lost} / {wing.total}</span><kbd>{bindingLabel(bindings, 'airOperations')}</kbd>
    </button></h2>
    <dl className="fleet-wing-counts">{Object.entries(AIR_STATUS_LABELS).filter(([status]) => wing.counts[status as keyof typeof wing.counts] > 0).map(([status, label]) => <div key={status}><dt>{label}</dt><dd>{wing.counts[status as keyof typeof wing.counts]}</dd></div>)}</dl>
    {!wing.available && combat.result === 'active' && !combat.playerSunk && <p className="fleet-flight-warning">Deck operations suspended</p>}
  </section>;
}
