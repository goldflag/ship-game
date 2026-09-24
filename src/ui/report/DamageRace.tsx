import type { CSSProperties } from 'react';
import { battleTime, stackLabels, whole, type damageRace } from './afterAction';
import './DamageRace.css';

/** Both fleets' damage over the battle. Sinkings hang above it in rows that never overlap; the stretch after the
 * decision, while the last shells land, is shaded. */
export function DamageRace({ race, decided }: { race: ReturnType<typeof damageRace>; decided?: number }) {
  const x = (tick: number) => tick / race.ticks * 100, y = (value: number) => 100 - value / race.max * 100;
  const line = (side: 'own' | 'enemy') => race.samples.map((sample, index) => index ? `H${x(sample.tick).toFixed(2)} V${y(sample[side]).toFixed(2)}` : `M0 ${y(sample[side]).toFixed(2)}`).join(' ');
  const minutes = Math.max(1, Math.round(race.ticks / 3600 / 6));
  const labels = Array.from({ length: Math.floor(race.ticks / 3600 / minutes) + 1 }, (_, index) => index * minutes * 3600).filter(tick => race.ticks - tick > race.ticks * .06);
  const flags = stackLabels(race.marks.map(mark => ({ ...mark, at: mark.tick / race.ticks, label: `${mark.label} ${battleTime(mark.tick)}` })));
  const rows = Math.max(1, ...flags.map(flag => flag.row + 1));
  const hold = decided !== undefined && race.ticks - decided > 30 ? decided : undefined;
  return <section className="aar-race" aria-label="Damage dealt over the battle" style={{ '--flag-rows': rows } as CSSProperties}>
    <div className="aar-race-head"><span className="aar-eyebrow">Damage dealt over the battle</span>
      <span className="aar-num"><b data-team="friendly">Your fleet {whole(race.own)}</b><b data-team="enemy">Enemy {whole(race.enemy)}</b></span></div>
    <div className="aar-chart">
      {hold !== undefined && <span className="aar-hold" style={{ left: `${x(hold)}%` }}><small>Decided <span className="aar-num">{battleTime(hold)}</span></small></span>}
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <path className="aar-grid" d="M0 100 H100 M0 50 H100 M0 0 H100" />
        <path className="aar-area" data-team="enemy" d={`${line('enemy')} V100 H0 Z`} /><path className="aar-area" data-team="friendly" d={`${line('own')} V100 H0 Z`} />
        <path data-team="enemy" d={line('enemy')} /><path data-team="friendly" d={line('own')} />
      </svg>
      {flags.map(flag => <span key={`${flag.tick}${flag.label}`} className="aar-mark" data-team={flag.friendly ? 'enemy' : 'friendly'} data-flip={flag.flip}
        style={{ left: `${x(flag.tick)}%`, '--row': flag.row } as CSSProperties}><i />{flag.label}</span>)}
      <div className="aar-axis aar-num">{labels.map(tick => <span key={tick} style={{ left: `${x(tick)}%` }}>{battleTime(tick)}</span>)}<span style={{ left: '100%' }}>{battleTime(race.ticks)}</span></div>
    </div>
  </section>;
}
