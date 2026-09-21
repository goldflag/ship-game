import { useState, type CSSProperties } from 'react';
import type { Telemetry } from '../game/types';
import { bindingLabel, type Keybindings } from '../game/keybindings';
import { DAMAGE_COLORS, type ShipDamagePart } from '../game/session/shipDamageReadout';
import type { FleetDesk } from './fleet/fleetDesk';
import { Button } from './components';
import './ShipDamage.css';

const percent = (fraction: number) => `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`;
function PartDetail({ part }: { part: ShipDamagePart }) {
  return <>
    {part.condition !== undefined && <span>{percent(part.condition)} condition</span>}
    {part.waterM3 !== undefined && <span>{percent(part.floodFraction ?? 0)} flooded · {part.waterM3.toLocaleString(undefined, { maximumFractionDigits: 1 })} m³</span>}
    {!!part.breachM2 && <span>{part.breachM2.toLocaleString(undefined, { maximumFractionDigits: 3 })} m² open breach</span>}
    {part.fire > 0 && <span>Fire intensity {percent(part.fire)}</span>}
  </>;
}

/** The HUD's live ship report and the existing 3D inspection share stable part ids. */
export function ShipDamage({ data, desk, bindings }: { data: Telemetry; desk: FleetDesk | null; bindings: Keybindings }) {
  const [showAll, setShowAll] = useState(false);
  const combat = data.combat, report = combat?.playerDamageReport;
  if (!combat || !report) return null;
  const affected = report.parts.filter(part => part.affected);
  const parts = showAll ? report.parts : affected;
  const selected = report.parts.find(part => part.id === data.inspectedPartId);
  const close = () => desk?.issue({ kind: 'ship-damage' });
  const inspect = (id?: string) => desk?.issue({ kind: 'inspect-part', id });
  return <section className="ship-damage" aria-label="Ship damage view">
    <header className="ship-damage-heading">
      <h2>Ship damage</h2>
      <Button variant="icon" onClick={event => { close(); event.currentTarget.blur(); }} aria-label="Close ship damage view">
        Close <kbd>{bindingLabel(bindings, 'shipDamage')}</kbd>
      </Button>
    </header>
    <p className="ship-damage-instructions">Live view · Battle continues<br/>Drag the ship to rotate · Scroll to zoom</p>
    <dl className="ship-damage-summary">
      <div><dt>Propulsion</dt><dd>{percent(report.propulsion)}</dd></div>
      <div><dt>Steering</dt><dd>{percent(report.steering)}</dd></div>
      <div><dt>Floodwater</dt><dd>{Math.round(combat.playerWater).toLocaleString()} m³</dd></div>
      <div><dt>List</dt><dd>{Math.abs(combat.playerList).toFixed(1)}° {Math.abs(combat.playerList) < .05 ? '' : combat.playerList < 0 ? 'starboard' : 'port'}</dd></div>
      <div><dt>Trim</dt><dd>{Math.abs(combat.playerTrim).toFixed(1)}° {Math.abs(combat.playerTrim) < .05 ? '' : combat.playerTrim < 0 ? 'bow down' : 'stern down'}</dd></div>
      <div><dt>Repair supplies</dt><dd>{Math.floor(combat.control.spares).toLocaleString()}</dd></div>
    </dl>
    <ul className="ship-damage-legend" aria-label="Internal damage colors">
      {Object.entries(DAMAGE_COLORS).map(([tone, color]) => <li key={tone} style={{ '--damage-color': color } as CSSProperties}><i/>{tone === 'fire' ? 'Fire' : tone[0].toUpperCase() + tone.slice(1)}</li>)}
    </ul>
    <div className="ship-damage-filters" role="group" aria-label="Parts shown">
      <Button aria-pressed={!showAll} onClick={event => { setShowAll(false); event.currentTarget.blur(); }}>Needs attention · {affected.length}</Button>
      <Button aria-pressed={showAll} onClick={event => { setShowAll(true); event.currentTarget.blur(); }}>All parts · {report.parts.length}</Button>
    </div>
    <div className="ship-damage-selection">
      <span>{selected ? `Isolated: ${selected.name}` : 'Select a part to isolate it in the ship'}</span>
      {selected && <Button onClick={event => { inspect(); event.currentTarget.blur(); }}>Show whole ship</Button>}
    </div>
    <div className="ship-damage-list" tabIndex={0} aria-label="Ship parts and compartments">
      {!parts.length && <p className="ship-damage-empty">No equipment damage, fires or flooding reported. Use All parts to inspect the internal layout.</p>}
      {parts.map(part => <Button key={part.id} className="ship-damage-part" aria-pressed={part.id === selected?.id}
        style={{ '--damage-color': DAMAGE_COLORS[part.tone] } as CSSProperties}
        onClick={event => { inspect(part.id === selected?.id ? undefined : part.id); event.currentTarget.blur(); }}>
        <span className="ship-damage-part-title"><strong>{part.name}</strong><b>{part.status}</b></span>
        <span className="ship-damage-location">{part.location} · {part.kind === 'equipment' ? 'Equipment' : 'Compartment'}</span>
        <span className="ship-damage-values"><PartDetail part={part}/></span>
        {part.crew && <span className="ship-damage-crew">Crew: {part.crew}</span>}
      </Button>)}
      {report.regions.length > 0 && <div className="ship-damage-structure">
        <h3>Hull & structure</h3>
        {report.regions.map(region => <div key={region.id}><span>{region.name}</span><strong>{percent(region.condition)}</strong></div>)}
      </div>}
    </div>
  </section>;
}
