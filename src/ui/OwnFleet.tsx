import './FleetCards.css';
import { Icon } from './Icons';
import type { Formation } from './fleetFormations';
import { SHIP_GLYPHS, type ShipClass } from './shipGlyphs';

export interface OwnFleetShip {
  id: string; name: string; shipClass: ShipClass;
  /** 0..1 */
  hull: number; kn: number;
  /** Standing order text, e.g. "Route · 20 kn · Waypoint 2/4". */
  order: string;
  damageDealt: number; frags: number; lost: boolean; warn: boolean; massKg: number;
  /** Only a carrier reports a wing; the formation header shows it instead of damage. */
  aircraft?: { remaining: number; total: number };
}
export interface OwnFleetAircraft { remaining: number; total: number; airborne: number; onDeck: number; inHangar: number }
export interface OwnFleetCardProps {
  formations: readonly Formation[]; ships: readonly OwnFleetShip[]; selectedIds: readonly string[]; hoverId?: string;
  /** Undefined when the fleet has no carrier. */
  aircraft?: OwnFleetAircraft;
  airOpen?: boolean;
  onHover(id: string | undefined): void; onSelectShip(id: string, additive: boolean): void; onSelectFormation(formation: Formation): void;
  onOpenAir?(): void;
}

const compact = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n));
const shipCount = (n: number) => n === 1 ? '1 ship' : `${n} ships`;
const tonnes = (kg: number) => `${Math.round(kg / 1000).toLocaleString()} t`;

/** Our own order of battle in the top-left corner: every formation, every ship,
 * the order it is running and the score its captain has run up. The rows carry
 * the same hover id as the chart markers, so pointing at either lights both. */
export function OwnFleetCard({ formations, ships, selectedIds, hoverId, aircraft, airOpen, onHover, onSelectShip, onSelectFormation, onOpenAir }: OwnFleetCardProps) {
  const afloat = ships.filter(s => !s.lost);
  const assigned = new Set(formations.flatMap(f => f.shipIds));
  const orphans = ships.filter(s => !assigned.has(s.id));
  const row = (ship: OwnFleetShip) => {
    const glyph = SHIP_GLYPHS[ship.shipClass];
    return <button key={ship.id} className={`fleet-card-row ${ship.warn ? 'warn' : ''} ${ship.lost ? 'lost' : ''} ${hoverId === ship.id ? 'hovered' : ''}`}
      aria-pressed={selectedIds.includes(ship.id)} title={`${ship.name} · ${ship.order}`}
      onMouseEnter={() => onHover(ship.id)} onMouseLeave={() => onHover(undefined)} onFocus={() => onHover(ship.id)} onBlur={() => onHover(undefined)}
      onClick={e => onSelectShip(ship.id, e.shiftKey || e.ctrlKey || e.metaKey)}>
      <svg className="fleet-card-glyph" viewBox="-13 -13 26 26" aria-hidden="true"><path className="fleet-card-hull" d={glyph.hull}/><path className="fleet-card-mark" d={glyph.mark}/></svg>
      <span className="fleet-card-name">{ship.name}<small className={ship.warn ? 'brass' : ''}>{ship.order}</small></span>
      <span className="fleet-card-value">{ship.lost ? 'Lost' : `${Math.round(ship.hull * 100)}%`}
        <small>{ship.kn} kn · {ship.damageDealt ? `${compact(ship.damageDealt)} dmg` : 'no hits'}{ship.frags ? ` · ${ship.frags} sunk` : ''}</small></span>
    </button>;
  };
  return <section className="fleet-card own" aria-label="Own fleet">
    <h2>Own fleet<span>{shipCount(afloat.length)} · {tonnes(afloat.reduce((n, s) => n + s.massKg, 0))} · {Math.round(ships.reduce((n, s) => n + s.damageDealt, 0)).toLocaleString()} dmg</span></h2>
    {formations.map(formation => {
      const members = formation.shipIds.map(id => ships.find(s => s.id === id)).filter((s): s is OwnFleetShip => !!s);
      const carrier = members.find(s => s.aircraft?.total);
      return <div key={formation.index}>
        <button className="fleet-card-head" aria-pressed={members.length > 0 && members.every(s => selectedIds.includes(s.id))}
          title={`Select every ship in ${formation.name} · ${formation.index}`} onClick={() => onSelectFormation(formation)}>
          <span><kbd>{formation.index}</kbd>{formation.name}</span>
          <small>{shipCount(members.length)}{carrier ? ` · ${carrier.aircraft!.remaining}/${carrier.aircraft!.total} aircraft` : ` · ${compact(members.reduce((n, s) => n + s.damageDealt, 0))} dmg`}</small>
        </button>
        {members.map(row)}
      </div>;
    })}
    {orphans.length > 0 && <div><h4 className="fleet-card-head"><span>Unassigned</span><small>{shipCount(orphans.length)}</small></h4>{orphans.map(row)}</div>}
    {aircraft && <div className="fleet-card-foot">
      <span>Aircraft {aircraft.remaining}/{aircraft.total} · {aircraft.airborne} airborne · {aircraft.onDeck} deck · {aircraft.inHangar} hangar</span>
      <button aria-expanded={airOpen} onClick={() => onOpenAir?.()}>Air<Icon name="chevron" size={12} style={{ transform: 'rotate(-90deg)' }}/></button>
    </div>}
  </section>;
}
