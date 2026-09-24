import { useMemo } from 'react';
import type { Object3D } from 'three';
import type { BattleDebrief, DebriefShip } from '../../game/session/BattleSession';
import { fleetRows, hitRows, hurtBy, percent, shipTitles, shortState, targetShares, whole } from './afterAction';
import { ShipDrawing } from './ShipDrawing';
import './CaptainsLog.css';

interface Props {
  debrief: BattleDebrief;
  own: DebriefShip;
  loadModel(ship: DebriefShip): Promise<Object3D>;
  /** Open this hit of your ship in the 3D view. */
  onHit(n: number): void;
  /** Open a ship in the fleet ledger. */
  onShip(id: string): void;
}
const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;
const count = (n: number) => n.toLocaleString('en-US');

/** The report's first tab: your ship and your share of the battle. Readings with a comparison each, the ship drawn with
 * her heavy hits, what hurt her most, where her shells went, and both fleets in a line a ship. */
export function CaptainsLog({ debrief, own, loadModel, onHit, onShip }: Props) {
  const titles = useMemo(() => shipTitles(debrief), [debrief]);
  const rows = useMemo(() => hitRows(debrief, own.id), [debrief, own.id]);
  const shares = useMemo(() => targetShares(debrief, own.id), [debrief, own.id]);
  const hurt = useMemo(() => hurtBy(debrief, own.id), [debrief, own.id]);
  const report = own.report;
  const fleet = debrief.ships.filter(ship => ship.team === own.team);
  const fleetDealt = fleet.reduce((sum, ship) => sum + ship.damageDealt, 0);
  const rank = [...fleet].sort((a, b) => b.damageDealt - a.damageDealt).indexOf(own);
  const worst = debrief.ships.filter(ship => ship.team !== own.team).map(ship => ({ title: titles.get(ship.id)!, damage: ship.report.dealtTo[own.id] ?? 0 }))
    .sort((a, b) => b.damage - a.damage)[0];
  const blocked = rows.filter(row => row.tone === 'blocked').length;
  const sank = debrief.ships.filter(ship => ship.status === 'sunk' && ship.report.sunkBy === own.id).map(ship => titles.get(ship.id)!);
  const readings: { label: string; value: string; unit?: string; note: string }[] = [
    { label: 'Damage dealt', value: whole(own.damageDealt), note: fleet.length > 1 && fleetDealt >= 1
      ? `${percent(own.damageDealt, fleetDealt)} of your fleet’s · ${rank ? `${ordinal(rank + 1)} in the fleet` : 'most in the fleet'}` : sank.length ? `Sank ${sank.join(', ')}` : 'Across the battle' },
    { label: 'Damage taken', value: whole(report.damageTaken), note: report.damageTaken >= 1 && worst?.damage >= 1 ? `${percent(worst.damage, report.damageTaken)} of it from ${worst.title}` : 'Nothing got through' },
    { label: 'Stopped by armor', value: count(blocked), unit: `of ${count(rows.length)} hits`, note: own.armorBlocked >= 1 ? `${whole(own.armorBlocked)} damage turned away` : 'No shell was turned away' },
    { label: 'Hit rate', value: report.shotsFired ? percent(report.hitsLanded, report.shotsFired) : '—', note: `${count(report.hitsLanded)} of ${count(report.shotsFired)} fired` },
  ];
  return <div className="aar-log">
    <section className="aar-log-ship" aria-label="Your ship">
      <div className="aar-log-name"><strong>{titles.get(own.id)}</strong>{own.isPlayer && <em>You</em>}<span>{fleetRows(debrief, own.team).find(row => row.ship === own)?.state}</span>
        <span className="aar-hull" role="img" aria-label={`Hull ${Math.round(own.integrity * 100)}%`}><i style={{ width: `${own.integrity * 100}%` }} /></span></div>
      <dl className="aar-log-read">{readings.map(reading => <div key={reading.label}>
        <dt>{reading.label}</dt><dd className="aar-num">{reading.value}{reading.unit && <span> {reading.unit}</span>}</dd><small>{reading.note}</small>
      </div>)}</dl>
      {own.definition && <ShipDrawing key={own.id} load={() => loadModel(own)} rows={rows} taken={report.damageTaken} strip onSelect={onHit}
        label={`${titles.get(own.id)} in profile and plan, every hit marked. Select a heavy hit to see it in 3D.`} />}
      {hurt.length > 0 && <div className="aar-log-hurt"><span className="aar-eyebrow">What hurt most</span>
        <ul>{hurt.map(item => <li key={item.from + item.weapon}>
          <b className="aar-num">{whole(item.damage)}</b><span>{item.weapon} × {item.hits}<small>from {item.from}</small></span><i style={{ width: `${item.share * 100}%` }} />
        </li>)}</ul></div>}
    </section>
    <aside className="aar-log-side">
      <span className="aar-eyebrow">Where your shells went</span>
      <ul className="aar-went">{shares.map(share => {
        const rest = share.total - share.by.reduce((sum, part) => sum + part.damage, 0);
        return <li key={share.target.id}>
          <div className="aar-went-head"><button type="button" onClick={() => onShip(share.target.id)}>{share.title}</button>
            <span>{share.state}{share.finalBlow && ` · final blow ${share.finalBlow}`}</span></div>
          <div className="aar-went-bar" role="img" aria-label={share.by.map(part => `${part.title} ${whole(part.damage)}`).join(', ') || 'No damage'}>
            {share.by.map(part => <i key={part.id} data-you={part.id === own.id} style={{ flexGrow: part.damage }} title={`${part.title} ${whole(part.damage)}`} />)}
            {rest >= 1 && <i style={{ flexGrow: rest }} title={`Other ${whole(rest)}`} />}
          </div>
          <div className="aar-went-foot aar-num"><span><b>{whole(share.mine)}</b> yours · {percent(share.mine, share.total)}</span><span>of {whole(share.total)}</span></div>
        </li>;
      })}</ul>
      {(['friendly', 'enemy'] as const).map(team => {
        const ships = debrief.ships.filter(ship => ship.team === team), lost = ships.filter(ship => ship.status !== 'operational').length;
        return <div key={team} className="aar-roster" data-team={team}>
          <span className="aar-eyebrow">{team === 'friendly' ? 'Your fleet' : 'Enemy fleet'} · {lost} of {ships.length} lost · {whole(ships.reduce((sum, ship) => sum + ship.damageDealt, 0))} dealt</span>
          <ul>{ships.map(ship => <li key={ship.id} data-lost={ship.status !== 'operational'} data-you={ship.id === own.id || undefined}>
            <button type="button" onClick={() => onShip(ship.id)}>{titles.get(ship.id)}</button><span>{shortState(ship)}</span><b className="aar-num">{whole(ship.damageDealt)}</b>
          </li>)}</ul>
        </div>;
      })}
    </aside>
  </div>;
}
