import { useState } from 'react';
import type { ShipDefinition } from '../ships/blueprint';
import { ARMOR_COLOR_STOPS, entriesForMode, inspectionColor, inspectionEntries, type InspectionMode } from '../ships/inspection';

const armorScaleMax = ARMOR_COLOR_STOPS[ARMOR_COLOR_STOPS.length - 1].thicknessMm;
const armorGradient = `linear-gradient(to right, ${ARMOR_COLOR_STOPS.map(stop => `${stop.color} ${stop.thicknessMm / armorScaleMax * 100}%`).join(', ')})`;

export function ModelViewControls({ mode, onChange, ready }: { mode: InspectionMode; onChange(mode: InspectionMode): void; ready: boolean }) {
  return <div className="port-model-views" role="group" aria-label="Ship model view">
    {(['exterior', 'armor', 'internals'] as const).map(value => <button key={value} disabled={!ready} aria-pressed={mode === value} onClick={() => onChange(value)}>{value === 'exterior' ? 'Exterior' : value === 'armor' ? 'Armor' : 'Internals'}</button>)}
  </div>;
}

export function PortInspection({ definition, mode, selectedId, onSelect }: { definition: ShipDefinition; mode: Exclude<InspectionMode, 'exterior'>; selectedId?: string; onSelect(id?: string): void }) {
  const [query, setQuery] = useState('');
  const entries = entriesForMode(inspectionEntries(definition), mode);
  const filtered = entries.filter(entry => entry.name.toLowerCase().includes(query.trim().toLowerCase()));
  const selected = entries.find(entry => entry.id === selectedId);
  return <section className="port-inspector" aria-label={mode === 'armor' ? 'Ship armor model' : 'Ship internal modules'}>
    <div className="port-inspection-scroll">
    <div className="port-inspector-heading"><h2>{mode === 'armor' ? 'Armor model' : 'Internal layout'}</h2><span>{entries.length} {mode === 'armor' ? 'volumes' : 'spaces'}</span></div>
    <p className="port-inspector-intro">{mode === 'armor' ? 'Hover a plate for details. Select a row to isolate it.' : 'Provisional layout. Select a module or compartment to isolate it.'}</p>
    {mode === 'armor' && <div className="port-armor-legend">
      <div className="port-armor-legend-labels"><span>Green · thinner</span><span>Red · thicker</span></div>
      <div className="port-armor-legend-ramp" aria-hidden="true" style={{ background: armorGradient }}/>
      <div className="port-armor-legend-labels">{ARMOR_COLOR_STOPS.map(stop => <span key={stop.thicknessMm}>{stop.thicknessMm}{stop.thicknessMm === armorScaleMax ? '+' : ''} mm</span>)}</div>
      {entries.some(entry => entry.plate?.material === 'teak') && <small>Teak backing is gray.</small>}
    </div>}
    <label className="port-volume-search">Find armor or space<input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Belt, boiler, Anton…" /></label>
    <div className="port-volume-list" aria-label={mode === 'armor' ? 'Armor volumes' : 'Modules and compartments'}>
      {filtered.map(entry => <button key={entry.id} aria-pressed={selectedId === entry.id} onClick={() => onSelect(selectedId === entry.id ? undefined : entry.id)}>
        <i aria-hidden="true" style={{ background: inspectionColor(entry) }}/><span>{entry.name}<small>{entry.kind === 'armor' ? entry.plate ? `${entry.plate.material} plate · ${entry.provenance?.basis ?? 'approximate'}` : entry.mountIndex === undefined ? 'Hull armor' : 'Gunhouse armor' : entry.kind === 'engine' ? 'Machinery' : entry.kind === 'steering' ? 'Steering gear' : entry.kind === 'magazine' ? 'Magazine' : 'Compartment'}</small></span>
        <strong>{entry.thicknessMm !== undefined ? `${entry.thicknessMm} mm` : entry.capacityM3 !== undefined ? `${Math.round(entry.capacityM3).toLocaleString()} m³` : `${entry.hp} HP`}</strong>
      </button>)}
    </div>
    {filtered.length === 0 && <p role="status" className="port-inspection-note">No matching entries. Try a shorter name or clear the search.</p>}
    <p className="port-inspection-note">{mode === 'armor' ? 'Provisional armor layout. Opaque plates hide the layers behind them; isolate a row to inspect an inner layer.' : 'Outlines show compartments; blue fill shows floodwater.'}</p>
    </div>
    {selected && <div className="port-volume-detail" role="status"><div><strong>{selected.name}</strong><span>{selected.size.map(n => n.toFixed(1)).join(' × ')} m</span>{selected.provenance && <small>{selected.provenance.note}</small>}</div><button onClick={() => onSelect(undefined)}>Clear selection</button></div>}
  </section>;
}
