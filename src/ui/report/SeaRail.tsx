import type { BattleDebrief, BattleResult, DebriefShip } from '../../game/session/BattleSession';
import type { BattleOutcome } from '../../game/session/battleRules';
import { Button } from '../components';
import { battleTime, fleetRows, percent, reasonText, resultTitle, shipTitles, targetShares, whole } from './afterAction';
import type { ReportAction } from './AfterActionReport';
import type { XpReadout } from './battleAward';
import { XpProgress } from './XpAward';
import './SeaRail.css';

interface Props {
  mode: string;
  result: Exclude<BattleResult, 'active'>;
  outcome: BattleOutcome;
  debrief: BattleDebrief;
  own: DebriefShip;
  xp?: XpReadout;
  actions: readonly ReportAction[];
  busy: string;
  error: string;
  onRun(action: ReportAction): void;
  onReport(): void;
}

/** The end screen's first page: the sea stays in view while the camera circles your ship, and a rail on the right
 * gives the result, the XP, your ship's four numbers, both fleets' fate and what to do next. */
export function SeaRail({ mode, result, outcome, debrief, own, xp, actions, busy, error, onRun, onReport }: Props) {
  const titles = shipTitles(debrief), report = own.report;
  const [state] = fleetRows(debrief, own.team).filter(row => row.ship === own).map(row => row.state);
  const best = targetShares(debrief, own.id).filter(share => share.mine >= .5).sort((a, b) => b.mine - a.mine)[0];
  const blocked = report.hits.filter(hit => ['stopped', 'ricochet', 'dud'].includes(hit.outcome)).length;
  const readings: [string, string, string?][] = [
    ['Dealt', whole(own.damageDealt)], ['Taken', whole(report.damageTaken)],
    ['Hit rate', report.shotsFired ? percent(report.hitsLanded, report.shotsFired) : '—'],
    best ? [best.title, percent(best.mine, best.total), 'yours'] : ['Stopped by armor', blocked.toLocaleString('en-US'), `of ${report.hits.length}`],
  ];
  const losses = debrief.ships.filter(ship => ship.status === 'sunk' && ship.report.lostTick !== undefined).sort((a, b) => a.report.lostTick! - b.report.lostTick!);
  const [primary, ...others] = actions;
  return <aside className="aar-rail" aria-label="Battle result">
    <span className="aar-eyebrow">{mode} · <span className="aar-num">{battleTime(outcome.finalTick)}</span></span>
    <h1>{resultTitle(result)}</h1>
    <p className="aar-rail-reason">{reasonText(result, outcome)}</p>
    {xp && <XpProgress xp={xp} presetId={own.presetId} />}
    <div className="aar-rail-ship">
      <div className="aar-rail-name"><strong>{titles.get(own.id)}</strong>{own.isPlayer && <em>You</em>}<span>{state}</span></div>
      <span className="aar-hull" role="img" aria-label={`Hull ${Math.round(own.integrity * 100)}%`}><i style={{ width: `${own.integrity * 100}%` }} /></span>
    </div>
    <dl className="aar-rail-read aar-num">{readings.map(([label, value, unit]) => <div key={label}><dt>{label}</dt><dd>{value}{unit && <span> {unit}</span>}</dd></div>)}</dl>
    <div className="aar-rail-fleets">
      {(['friendly', 'enemy'] as const).map(team => {
        const ships = debrief.ships.filter(ship => ship.team === team), afloat = ships.filter(ship => ship.status === 'operational').length;
        const sunk = ships.filter(ship => ship.status === 'sunk').length;
        return <div key={team} data-team={team}>
          <span className="aar-eyebrow">{team === 'friendly' ? 'Your fleet' : 'Enemy fleet'}</span>
          <span className="aar-chips">{ships.map(ship => <i key={ship.id} data-lost={ship.status !== 'operational'} title={`${titles.get(ship.id)} · ${fleetRows(debrief, team).find(row => row.ship === ship)?.state}`} />)}</span>
          <span>{afloat === ships.length ? `All ${ships.length} afloat` : afloat ? `${afloat} of ${ships.length} afloat` : sunk === ships.length ? `All ${ships.length} sunk` : 'None afloat'}</span>
        </div>;
      })}
      {/* Coloured as the damage chart flags them: an enemy sunk is good news, a ship of yours lost is not. */}
      {losses.length > 0 && <p className="aar-rail-losses">{losses.map(ship => <span key={ship.id} data-team={ship.team === 'friendly' ? 'enemy' : 'friendly'}>
        {titles.get(ship.id)} <span className="aar-num">{battleTime(ship.report.lostTick!)}</span>
      </span>)}</p>}
    </div>
    <div className="aar-rail-actions">
      <p role="status">{error || (busy && `${busy}…`)}</p>
      {primary && <Button variant="primary" disabled={!!busy} onClick={() => onRun(primary)}>{primary.label}{primary.hint && <small>{primary.hint}</small>}</Button>}
      {others.length > 0 && <div>{others.map(action => <Button key={action.label} disabled={!!busy} onClick={() => onRun(action)}>{action.label}{action.hint && <small>{action.hint}</small>}</Button>)}</div>}
      <button type="button" className="aar-link" onClick={onReport}>Full report ›<small>Your battle, fleets, battle plot, hits</small></button>
    </div>
  </aside>;
}
