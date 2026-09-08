import { useState, type CSSProperties } from 'react';
import type { AircraftRole } from '../ships/blueprint';
import { FIGHTER_AMMO_BURSTS } from '../simulation/aircraft';
import type { AirWingTelemetry, FlightSummary } from '../simulation/airTelemetry';
import { duration, mission, roleIcon, roleLabel } from './airFormat';
import { Icon } from './Icons';
import './AirWingManifest.css';

export type WingAircraft = AirWingTelemetry['flights'][number];
const ROLES: AircraftRole[] = ['fighter', 'dive-bomber', 'torpedo-bomber'];
const PHASES: Record<WingAircraft['phase'], string> = { ready: 'Ready', queued: 'Queued', taxi: 'Taxiing', takeoff: 'Taking off', outbound: 'Outbound', attack: 'Attacking', returning: 'Returning', landing: 'Landing', rollout: 'Rollout', parking: 'Parking', rearming: 'Rearming', lost: 'Lost' };

/** Armament left as 0–1: gun bursts for fighters, the single bomb or torpedo for bombers. */
export const armamentFraction = (p: WingAircraft) => p.status === 'lost' ? 0 : p.role === 'fighter' ? p.ammo / FIGHTER_AMMO_BURSTS : p.payload ? 1 : 0;
export const armamentLabel = (p: WingAircraft) => p.role === 'fighter' ? (p.ammo ? `${p.ammo} bursts` : 'Guns empty')
  : p.role === 'dive-bomber' ? (p.payload ? 'Bomb' : 'Released') : (p.payload ? 'Torpedo' : 'Dropped');
/** Condition band that recolors a cell below 50 HP; undefined while healthy. */
export const conditionLevel = (p: WingAircraft) => p.status === 'lost' ? 'lost' : p.hp < 25 ? 'critical' : p.hp < 50 ? 'damaged' : undefined;
export const aircraftState = (p: WingAircraft) => p.lossReason ?? PHASES[p.phase];

/** Every squadron and every aircraft of the wing, docked at the right edge of the M view. Rows select squadrons. */
export function AirWingManifest({ wing, selectedId, selectedIds, onSelect }: { wing: AirWingTelemetry; selectedId?: string; selectedIds?: string[]; onSelect(flight: FlightSummary, additive?: boolean): void }) {
  const [open, setOpen] = useState(true);
  const byId = new Map(wing.flights.map(p => [p.id, p]));
  return <aside className={`air-manifest ${open ? '' : 'air-manifest-collapsed'}`} aria-label="Air wing manifest">
    <header className="air-manifest-header">
      <h3>Air wing <strong>{wing.total - wing.counts.lost}<small>/{wing.total}</small></strong></h3>
      <button aria-expanded={open} aria-controls="air-manifest-body" onClick={e => { setOpen(value => !value); e.currentTarget.blur(); }}>{open ? 'Hide' : 'Show'}</button>
      <p>Flights {wing.activeFlights}/{wing.maxActiveFlights} · Deck {wing.onDeck}/{wing.deckCapacity} · Hangar {wing.inHangar}{wing.recoveryCount ? ` · Recovering ${wing.recoveryCount}` : ''}</p>
      {!wing.available && <p className="air-manifest-warning">Deck operations suspended</p>}
    </header>
    {open && <div id="air-manifest-body">
      {ROLES.map(role => {
        const groups = wing.groups.filter(f => f.role === role);
        if (!groups.length) return null;
        const planes = wing.flights.filter(p => p.role === role);
        const lost = planes.filter(p => p.status === 'lost').length;
        return <section key={role} aria-label={roleLabel(role)}>
          <h4><span className="air-role-icon"><Icon name={roleIcon(role)} size={14}/></span>{roleLabel(role)}
            <span>{planes.filter(p => p.status === 'ready').length} ready · {planes.filter(p => p.location === 'Airborne').length} airborne · {planes.filter(p => armamentFraction(p) > 0).length} armed{lost ? ` · ${lost} lost` : ''}</span></h4>
          {groups.map(f => {
            const index = wing.groups.indexOf(f);
            const aircraft = f.aircraftIds.flatMap(id => byId.get(id) ?? []);
            const detail = f.active ? `${mission(f)} · ${duration(f.enduranceSeconds)}` : f.queuePosition ? `Recovery #${f.queuePosition}` : `${f.armed} armed`;
            return <button key={f.id} className={`air-manifest-row air-manifest-${f.status}`} aria-pressed={selectedIds ? selectedIds.includes(f.id) : selectedId === f.id}
              aria-label={`${f.name}, ${roleLabel(f.role)}, ${f.surviving} of ${f.total} aircraft, ${f.activity}, ${f.armed} armed, ${f.hp}% condition`}
              title={`${roleLabel(f.role)} · ${f.active ? mission(f) : f.activity} · ${f.hp}% condition · ${f.armed} armed`}
              onClick={e => { onSelect(f, e.metaKey || e.ctrlKey); e.currentTarget.blur(); }}>
              {index < 10 && <kbd>{(index + 1) % 10}</kbd>}
              <span className="air-manifest-name">{f.name}</span>
              <span className="air-manifest-info"><span>{f.rearmSeconds ? `Rearm ${duration(f.rearmSeconds)}` : f.activity}</span><small>{detail}</small></span>
              <span className="air-manifest-cells" aria-hidden="true">{aircraft.map(p => <i key={p.id} className="air-manifest-cell" data-status={p.status} data-condition={conditionLevel(p)}
                title={`Aircraft ${p.id.split('/').at(-1)} · ${Math.ceil(p.hp)}% · ${armamentLabel(p)} · ${aircraftState(p)}`}
                style={{ '--condition': p.status === 'lost' ? 0 : Math.max(0, Math.min(1, p.hp / 100)), '--armament': armamentFraction(p) } as CSSProperties}/>)}</span>
              <span className="air-manifest-count">{f.surviving}<small>/{f.total}</small></span>
            </button>;
          })}
        </section>;
      })}
      <footer><span><i className="air-manifest-legend-condition"/>Bar · condition</span><span><i className="air-manifest-legend-armament"/>Underline · payload or ammunition</span></footer>
    </div>}
  </aside>;
}
