import type { Formation } from './fleetFormations';

export interface RosterShip { id: string; name: string; hull: number; kn: number; damageDealt: number; frags: number; lost: boolean; warn?: boolean; aircraft?: { remaining: number; total: number } }
const glyph = 'M0 -12 5 -3 4 10 -4 10 -5 -3Z';
const compact = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n));

/** Every formation and every ship, always: a hull ring, speed and the score
 * each captain has run up. The header selects the formation; a token, one ship. */
export function FleetRoster({ formations, ships, selectedIds, hoverId, onHover, onSelectShip, onSelectFormation }: {
  formations: readonly Formation[]; ships: readonly RosterShip[]; selectedIds: readonly string[]; hoverId?: string;
  onHover(id: string | undefined): void; onSelectShip(id: string, additive: boolean): void; onSelectFormation(formation: Formation): void;
}) {
  const circumference = 2 * Math.PI * 17;
  return <nav className="fleet-command-roster" aria-label="Fleet roster">
    {formations.map(formation => {
      const members = formation.shipIds.map(id => ships.find(s => s.id === id)).filter((s): s is RosterShip => !!s);
      const carrier = members.find(s => s.aircraft?.total);
      return <div key={formation.index} className="fleet-command-formation" onMouseLeave={() => onHover(undefined)}>
        <button className="fleet-command-formation-name" aria-pressed={members.every(s => selectedIds.includes(s.id))} onClick={() => onSelectFormation(formation)} title={`Select every ship in ${formation.name} · ${formation.index}`}>
          <kbd>{formation.index}</kbd>{formation.name}<small>{members.length === 1 ? '1 ship' : `${members.length} ships`}{carrier ? ` · ${carrier.aircraft!.remaining}/${carrier.aircraft!.total} aircraft` : ` · ${compact(members.reduce((n, s) => n + s.damageDealt, 0))} dmg`}</small>
        </button>
        <div className="fleet-command-tokens">{members.map(ship => <button key={ship.id} className={`fleet-command-token ${ship.warn ? 'warn' : ''} ${ship.lost ? 'lost' : ''} ${hoverId === ship.id ? 'hovered' : ''}`} disabled={ship.lost}
          aria-pressed={selectedIds.includes(ship.id)} aria-label={`${ship.name} · ${Math.round(ship.hull * 100)}% hull · ${ship.kn} knots · ${Math.round(ship.damageDealt).toLocaleString()} damage dealt`}
          onMouseEnter={() => onHover(ship.id)} onFocus={() => onHover(ship.id)} onBlur={() => onHover(undefined)} onClick={e => onSelectShip(ship.id, e.shiftKey || e.ctrlKey || e.metaKey)}>
          <svg viewBox="0 0 42 42" aria-hidden="true"><circle className="fleet-command-token-ring" cx="21" cy="21" r="17"/><circle className="fleet-command-token-hull" cx="21" cy="21" r="17" strokeDasharray={`${circumference * Math.max(0, Math.min(1, ship.hull))} ${circumference}`} transform="rotate(-90 21 21)"/><path d={glyph} transform="translate(21 21) scale(.8)"/></svg>
          <span className="fleet-command-token-name">{ship.name}</span>
          <small>{ship.lost ? 'Lost' : `${Math.round(ship.hull * 100)}% · ${ship.kn} kn`}</small>
          <small className="fleet-command-token-score">{ship.damageDealt ? `${compact(ship.damageDealt)} dmg` : 'no hits'}{ship.frags ? ` · ${ship.frags} sunk` : ''}</small>
        </button>)}</div>
      </div>;
    })}
  </nav>;
}
