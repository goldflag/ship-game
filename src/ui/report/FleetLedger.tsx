import { useMemo, type CSSProperties } from 'react';
import type { Object3D } from 'three';
import type { BattleDebrief, DebriefShip } from '../../game/session/BattleSession';
import type { BattleOutcome } from '../../game/session/battleRules';
import { presetPlace } from '../../progression/techTree';
import { battleTime, damageRace, fleetRows, hitRows, hurtBy, magazineFloods, pairDamage, percent, shipTitles, whole, type PairDamage } from './afterAction';
import { DamageRace } from './DamageRace';
import { ShipDrawing } from './ShipDrawing';
import './FleetLedger.css';

interface Props {
  debrief: BattleDebrief;
  outcome: BattleOutcome;
  /** The ship whose card shows beside the table. */
  selected: string;
  onSelect(id: string): void;
  loadModel(ship: DebriefShip): Promise<Object3D>;
  /** Open a ship, and one of its hits, in the 3D view. */
  onInspect(id: string, hit?: number): void;
}

const COLUMNS = ['Ship', 'Fate', 'Damage dealt', 'Taken', 'Armor stopped', 'Hits / fired', 'Final blows'];

/** Both fleets in one table, the damage race under it, who hit whom beside it, and the selected ship's hits. */
export function FleetLedger({ debrief, outcome, selected, onSelect, loadModel, onInspect }: Props) {
  const race = useMemo(() => damageRace(debrief), [debrief]);
  const best = Math.max(1, ...debrief.ships.map(ship => ship.damageDealt));
  const ship = debrief.ships.find(candidate => candidate.id === selected) ?? debrief.ships[0];
  return <div className="aar-ledger">
    <div className="aar-ledger-main">
      <table className="aar-ledger-table">
        <thead><tr>{COLUMNS.map(column => <th key={column} scope="col">{column}</th>)}</tr></thead>
        {(['friendly', 'enemy'] as const).map(team => {
          const rows = fleetRows(debrief, team), lost = rows.filter(row => row.lost).length;
          return <tbody key={team} data-team={team}>
            <tr className="aar-ledger-group"><td colSpan={COLUMNS.length}>{team === 'friendly' ? 'Your fleet' : 'Enemy fleet'} · {lost} of {rows.length} lost ·{' '}
              <b className="aar-num">{whole(rows.reduce((sum, row) => sum + row.ship.damageDealt, 0))}</b> dealt</td></tr>
            {rows.map(row => {
              const blows = debrief.ships.filter(other => other.status === 'sunk' && other.report.sunkBy === row.ship.id).length;
              const place = presetPlace(row.ship.presetId), chosen = row.ship.id === ship.id;
              return <tr key={row.ship.id} data-selected={chosen} data-lost={row.lost} onClick={() => onSelect(row.ship.id)}>
                <th scope="row"><button type="button" className="aar-ledger-ship" aria-pressed={chosen} title="Show where this ship was hit">{row.title}</button>
                  {row.ship.isPlayer && <em>You</em>}{place && <small>{place.node.type}</small>}</th>
                <td className="aar-ledger-fate">{row.state}</td>
                <td><span className="aar-ledger-dealt">
                  <span className="aar-ledger-bar"><i style={{ width: `${Math.max(1, row.ship.damageDealt / best * 100)}%` }} /></span><b className="aar-num">{whole(row.ship.damageDealt)}</b>
                </span></td>
                <td className="aar-num">{whole(row.ship.report.damageTaken)}</td>
                <td className="aar-num">{row.ship.armorBlocked >= 1 ? whole(row.ship.armorBlocked) : '—'}</td>
                <td className="aar-num">{row.hits}{row.ship.report.shotsFired > 0 && <small>{percent(row.ship.report.hitsLanded, row.ship.report.shotsFired)}</small>}</td>
                <td className="aar-num">{blows || '—'}</td>
              </tr>;
            })}
          </tbody>;
        })}
      </table>
      <DamageRace race={race} decided={outcome.finalTick} />
    </div>
    <aside className="aar-ledger-side">
      <div className="aar-pairs"><span className="aar-eyebrow">Who hit whom · damage</span>
        <PairGrid pairs={pairDamage(debrief, 'friendly')} caption="Your fleet → enemy" team="friendly" />
        <PairGrid pairs={pairDamage(debrief, 'enemy')} caption="Enemy → your fleet" team="enemy" />
      </div>
      <ShipCard key={ship.id} debrief={debrief} ship={ship} loadModel={loadModel} onInspect={onInspect} />
    </aside>
  </div>;
}

const short = (title: string) => title.replace(/^(USS|HMS|HMCS|HMAS|IJN|KMS) /, '');
function PairGrid({ pairs, caption, team }: { pairs: PairDamage; caption: string; team: DebriefShip['team'] }) {
  return <figure className="aar-pair" data-team={team}>
    <figcaption>{caption}</figcaption>
    <table>
      <thead><tr><td />{pairs.columns.map(column => <th key={column.id} scope="col" title={column.title}>{short(column.title)}</th>)}</tr></thead>
      <tbody>{pairs.rows.map((row, r) => <tr key={row.id}><th scope="row" title={row.title}>{short(row.title)}</th>
        {pairs.cells[r].map((value, c) => <td key={pairs.columns[c].id} className="aar-num" style={{ '--share': value / pairs.max } as CSSProperties}
          title={`${row.title} → ${pairs.columns[c].title}: ${whole(value)}`}>{value >= .5 ? whole(value) : '·'}</td>)}
      </tr>)}</tbody>
    </table>
  </figure>;
}

function ShipCard({ debrief, ship, loadModel, onInspect }: { debrief: BattleDebrief; ship: DebriefShip; loadModel: Props['loadModel']; onInspect: Props['onInspect'] }) {
  const titles = useMemo(() => shipTitles(debrief), [debrief]);
  const rows = useMemo(() => hitRows(debrief, ship.id), [debrief, ship.id]);
  const hurt = useMemo(() => hurtBy(debrief, ship.id), [debrief, ship.id]);
  const floods = magazineFloods(ship).slice(0, 2);
  const blocked = rows.filter(row => row.tone === 'blocked').length;
  const by = debrief.ships.filter(other => other.team !== ship.team).map(other => ({ title: titles.get(other.id)!, damage: other.report.dealtTo[ship.id] ?? 0 }))
    .filter(part => part.damage >= .5).sort((a, b) => b.damage - a.damage);
  const state = fleetRows(debrief, ship.team).find(row => row.ship === ship)?.state;
  return <section className="aar-card" aria-label={`${titles.get(ship.id)}, hits received`}>
    <div className="aar-card-head"><strong>{titles.get(ship.id)}</strong>
      <span className="aar-num">{state} · {rows.length.toLocaleString('en-US')} {rows.length === 1 ? 'hit' : 'hits'} · {blocked} stopped by armor · {whole(ship.report.damageTaken)} damage</span></div>
    {ship.definition && <ShipDrawing load={() => loadModel(ship)} rows={rows} taken={ship.report.damageTaken} views={['profile']} onSelect={n => onInspect(ship.id, n)}
      label={`${titles.get(ship.id)} in profile, every hit marked`} />}
    <p className="aar-card-by"><span className="aar-eyebrow">Taken from</span>{by.length ? by.map(part => `${part.title} ${whole(part.damage)}`).join(' · ') : 'Nothing got through'}</p>
    {hurt.length > 0 && <ul className="aar-card-hurt">{hurt.map(item => <li key={item.from + item.weapon}><span>{item.weapon}<small> from {item.from}</small></span>
      <b className="aar-num">{item.hits} {item.hits === 1 ? 'hit' : 'hits'} · {whole(item.damage)}</b></li>)}</ul>}
    {floods.length > 0 && <p className="aar-card-flood"><span className="aar-eyebrow">Magazines flooded</span>{floods.map(flood => `${flood.room} ${battleTime(flood.tick)}`).join(' · ')}</p>}
    <button type="button" className="aar-link" onClick={() => onInspect(ship.id)}>Turn the ship in 3D ›</button>
  </section>;
}
