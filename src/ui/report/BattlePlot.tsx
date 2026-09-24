import { useMemo, type CSSProperties } from 'react';
import type { BattleDebrief } from '../../game/session/BattleSession';
import type { BattleOutcome } from '../../game/session/battleRules';
import { battleTime, damageRace, hitLanes, whole } from './afterAction';
import { DamageRace } from './DamageRace';
import './BattlePlot.css';

/** The battle as it happened: the damage race over one lane per ship, each hit it took a tick as tall as its damage,
 * until the ship went down. The stretch after the decision is shaded in both. */
export function BattlePlot({ debrief, outcome }: { debrief: BattleDebrief; outcome: BattleOutcome }) {
  const race = useMemo(() => damageRace(debrief), [debrief]);
  const lanes = useMemo(() => hitLanes(debrief), [debrief]);
  const heaviest = Math.max(1, ...lanes.flatMap(lane => lane.rows.map(row => row.hit.damage)));
  const at = (tick: number) => `${Math.min(100, tick / race.ticks * 100).toFixed(2)}%`;
  const decided = race.ticks - outcome.finalTick > 30 ? at(outcome.finalTick) : undefined;
  return <div className="aar-plot" style={decided ? { '--decided': decided } as CSSProperties : undefined}>
    <div className="aar-plot-race"><DamageRace race={race} decided={outcome.finalTick} /></div>
    <p className="aar-plot-legend"><span className="aar-eyebrow">Hits each ship took</span>
      <span><i data-tone="penetrated" />Penetrated</span><span><i data-tone="explosive" />High explosive</span><span><i data-tone="torpedo" />Torpedo</span>
      <span><i data-tone="blocked" />Stopped by armor</span><span className="aar-muted">Taller tick, more damage</span></p>
    {(['friendly', 'enemy'] as const).map(team => <div key={team} className="aar-plot-fleet" data-team={team} role="group" aria-label={team === 'friendly' ? 'Your fleet' : 'Enemy fleet'}>
      <span className="aar-eyebrow">{team === 'friendly' ? 'Your fleet' : 'Enemy fleet'}</span>
      {lanes.filter(lane => lane.ship.team === team).map(lane => <div key={lane.ship.id} className="aar-lane" data-lost={lane.lostTick !== undefined}>
        <div className="aar-lane-name"><strong>{lane.title}</strong>{lane.ship.isPlayer && <em>You</em>}</div>
        <div className="aar-lane-track" role="img" aria-label={`${lane.title}: ${lane.rows.length} hits${lane.lostTick === undefined ? '' : `, sunk at ${battleTime(lane.lostTick)}`}`}>
          {lane.rows.map(row => row.tone === 'blocked'
            ? <i key={row.n} className="aar-tick" data-tone="blocked" style={{ left: at(row.hit.tick) }} />
            : <i key={row.n} className="aar-tick" data-tone={row.tone} style={{ left: at(row.hit.tick), height: `${3 + 24 * Math.sqrt(row.hit.damage / heaviest)}px` }}
              title={`${row.time} · ${row.hit.weapon} from ${row.from} · ${whole(row.hit.damage)} damage`} />)}
          {lane.lostTick !== undefined && <><span className="aar-lane-after" style={{ left: at(lane.lostTick) }} />
            <span className="aar-lane-lost" style={{ left: at(lane.lostTick) }} title={`Sunk ${battleTime(lane.lostTick)}`} /></>}
        </div>
        <div className="aar-lane-fate"><span>{lane.state}</span><b className="aar-num">{whole(lane.ship.damageDealt)}</b></div>
      </div>)}
    </div>)}
  </div>;
}
