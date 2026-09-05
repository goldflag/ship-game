import type { ShipDefinition } from '../ships/blueprint';
import { entriesForMode, inspectionEntries, INSPECTION_COLORS, type InspectionMode } from '../ships/inspection';

export function ModelViewControls({ mode, onChange, ready }: { mode: InspectionMode; onChange(mode: InspectionMode): void; ready: boolean }) {
  return <div className="port-model-views" role="group" aria-label="Ship model view">
    {(['exterior', 'armor', 'internals'] as const).map(value => <button key={value} disabled={!ready} aria-pressed={mode === value} onClick={() => onChange(value)}>{value === 'exterior' ? 'Exterior' : value === 'armor' ? 'Armor' : 'Internals'}</button>)}
  </div>;
}

export function PortInspection({ definition, mode, selectedId, onSelect }: { definition: ShipDefinition; mode: Exclude<InspectionMode, 'exterior'>; selectedId?: string; onSelect(id?: string): void }) {
  const entries = entriesForMode(inspectionEntries(definition), mode);
  const selected = entries.find(entry => entry.id === selectedId);
  return <section className="port-inspector" aria-label={mode === 'armor' ? 'Ship armor model' : 'Ship internal modules'}>
    <div className="port-inspection-scroll">
    <div className="port-inspector-heading"><h2>{mode === 'armor' ? 'Armor model' : 'Internal layout'}</h2><span>{entries.length} {mode === 'armor' ? 'volumes' : 'spaces'}</span></div>
    <p className="port-inspector-intro">Provisional layout. Select {mode === 'armor' ? 'an armor volume' : 'a module or compartment'} to isolate it.</p>
    <div className="port-volume-list" aria-label={mode === 'armor' ? 'Armor volumes' : 'Modules and compartments'}>
      {entries.map(entry => <button key={entry.id} aria-pressed={selectedId === entry.id} onClick={() => onSelect(selectedId === entry.id ? undefined : entry.id)}>
        <i aria-hidden="true" style={{ background: INSPECTION_COLORS[entry.kind] }}/><span>{entry.name}<small>{entry.kind === 'armor' ? entry.mountIndex === undefined ? 'Hull armor' : 'Gunhouse armor' : entry.kind === 'engine' ? 'Machinery' : entry.kind === 'steering' ? 'Steering gear' : entry.kind === 'magazine' ? 'Magazine' : 'Compartment'}</small></span>
        <strong>{entry.thicknessMm !== undefined ? `${entry.thicknessMm} mm` : entry.capacityM3 !== undefined ? `${Math.round(entry.capacityM3).toLocaleString()} m³` : `${entry.hp} HP`}</strong>
      </button>)}
    </div>
    <p className="port-inspection-note">{mode === 'armor' ? 'Thickness is uniform within each volume.' : 'Outlines show compartments; blue fill shows floodwater.'}</p>
    </div>
    {selected && <div className="port-volume-detail" role="status"><div><strong>{selected.name}</strong><span>{selected.size.map(n => n.toFixed(1)).join(' × ')} m</span></div><button onClick={() => onSelect(undefined)}>Clear selection</button></div>}
  </section>;
}
