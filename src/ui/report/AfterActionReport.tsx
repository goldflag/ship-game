import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Object3D } from 'three';
import type { BattleDebrief, BattleResult, DebriefShip } from '../../game/session/BattleSession';
import type { BattleOutcome } from '../../game/session/battleRules';
import { Button, Select, SelectOption } from '../components';
import { battleTime, damageRace, fleetRows, hitRows, plainName, shipTitles, whole, type FleetRow, type HitRow } from './afterAction';
import { HitModel } from './HitModel';
import './AfterActionReport.css';

export interface ReportAction { label: string; hint?: string; run(): Promise<void> | void }
interface Props {
  /** "Custom battle", "Fleet command", "Online battle". */
  mode: string;
  result: Exclude<BattleResult, 'active'>;
  outcome: BattleOutcome;
  debrief: BattleDebrief;
  /** The first action is the primary one. */
  actions: readonly ReportAction[];
  loadModel(ship: DebriefShip): Promise<Object3D>;
  /** Give the cursor back without the pause menu an unexpected unlock opens. */
  releasePointer(): void;
}

/** Shells still in flight when the battle is decided keep landing, so the debrief changes for a
 * few seconds. Hold one object until something a reader would see has changed. */
function useSettled(debrief: BattleDebrief): BattleDebrief {
  const held = useRef({ key: '', debrief });
  const key = debrief.ships.map(ship => `${ship.status}${ship.report.hits.length}:${Math.round(ship.damageDealt)}:${Math.round(ship.report.damageTaken)}`).join('|');
  if (held.current.key !== key) held.current = { key, debrief };
  return held.current.debrief;
}

const reasonText = (result: Props['result'], outcome: BattleOutcome) => outcome.reason === 'time-limit' ? 'The time limit was reached'
  : outcome.reason === 'forfeit' ? (result === 'victory' ? 'The enemy struck their colors' : 'Your fleet struck its colors')
  : result === 'victory' ? 'The enemy fleet can no longer fight' : result === 'defeat' ? 'Your fleet can no longer fight' : 'Neither fleet can fight on';

export function AfterActionReport({ mode, result, outcome, debrief: latest, actions, loadModel, releasePointer }: Props) {
  const debrief = useSettled(latest);
  const [tab, setTab] = useState<'results' | 'ship'>('results');
  const [busy, setBusy] = useState(''), [error, setError] = useState('');
  const own = debrief.ships.find(ship => ship.isPlayer) ?? debrief.ships.find(ship => ship.team === 'friendly') ?? debrief.ships[0];
  const [shipId, setShipId] = useState(own?.id ?? '');
  const subject = debrief.ships.find(ship => ship.id === shipId) ?? own;
  const release = useRef(releasePointer);
  release.current = releasePointer;
  useEffect(() => release.current(), []);
  const run = async (action: ReportAction) => {
    if (busy) return;
    setBusy(action.label); setError('');
    try { await action.run(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(''); }
  };
  const inspect = (id: string) => { setShipId(id); setTab('ship'); };
  if (!subject) return null;
  return <section className="after-action" data-tab={tab} aria-label="After-action report">
    <header className="aar-head">
      <span className="aar-eyebrow">{mode} · Battle complete</span>
      <h1>{result === 'victory' ? 'Victory' : result === 'defeat' ? 'Defeat' : 'Draw'}</h1>
      <p>{reasonText(result, outcome)} · <span className="aar-num">{battleTime(outcome.finalTick)}</span> elapsed</p>
    </header>
    <div className="aar-tabs" role="tablist" aria-label="Report">
      <button type="button" role="tab" id="aar-tab-results" aria-selected={tab === 'results'} aria-controls="aar-panel" onClick={() => setTab('results')}>Battle results</button>
      <button type="button" role="tab" id="aar-tab-ship" aria-selected={tab === 'ship'} aria-controls="aar-panel" onClick={() => setTab('ship')}>
        Your ship<small>{own.report.hits.length.toLocaleString('en-US')} {own.report.hits.length === 1 ? 'hit' : 'hits'} · {whole(own.report.damageTaken)} damage</small>
      </button>
    </div>
    <div className="aar-panel" id="aar-panel" role="tabpanel" aria-labelledby={`aar-tab-${tab}`}>
      {tab === 'results' ? <Results debrief={debrief} onInspect={inspect} />
        : <ShipHits key={subject.id} debrief={debrief} ship={subject} onShip={setShipId} loadModel={loadModel} />}
    </div>
    <footer className="aar-foot">
      <p role="status">{error || (busy && `${busy}…`)}</p>
      <div>{actions.map((action, index) => <Button key={action.label} variant={index ? 'secondary' : 'primary'} disabled={!!busy} onClick={() => void run(action)}>
        {action.label}{action.hint && <small>{action.hint}</small>}
      </Button>)}</div>
    </footer>
  </section>;
}

function Results({ debrief, onInspect }: { debrief: BattleDebrief; onInspect(id: string): void }) {
  const race = useMemo(() => damageRace(debrief), [debrief]);
  return <div className="aar-results">
    {(['friendly', 'enemy'] as const).map(team => {
      const rows = fleetRows(debrief, team), lost = rows.filter(row => row.lost).length;
      return <section key={team} className="aar-fleet" data-team={team} data-dense={rows.length > 4}>
        <span className="aar-eyebrow">{team === 'friendly' ? 'Your fleet' : 'Enemy fleet'} · {lost} of {rows.length} lost</span>
        <div className="aar-total"><strong className="aar-num">{whole(team === 'friendly' ? race.own : race.enemy)}</strong><span>damage dealt</span></div>
        <ul>{rows.map(row => <FleetShip key={row.ship.id} row={row} best={Math.max(...debrief.ships.map(ship => ship.damageDealt), 1)} onInspect={onInspect} />)}</ul>
      </section>;
    })}
    <DamageRace race={race} />
  </div>;
}

function FleetShip({ row, best, onInspect }: { row: FleetRow; best: number; onInspect(id: string): void }) {
  const { ship } = row;
  const stats: [string, string][] = [['Dealt', whole(ship.damageDealt)], ['Taken', whole(ship.report.damageTaken)], ['Armor blocked', ship.armorBlocked >= 1 ? whole(ship.armorBlocked) : '—'],
    ['Hits / fired', row.hits], ['Sank', row.sank]];
  return <li data-lost={row.lost}>
    <div className="aar-ship-name">
      <button type="button" onClick={() => onInspect(ship.id)} title="Show where this ship was hit">{row.title}</button>
      {ship.isPlayer && <em>You</em>}
      <span>{row.state}{ship.definition?.airWing ? ` · ${ship.aircraftRemaining} aircraft left` : ''}</span>
    </div>
    <dl className="aar-num">{stats.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    {row.byWeapon.length > 0 && <div className="aar-weapons">
      <div className="aar-bar" style={{ width: `${10 + ship.damageDealt / best * 90}%` }}>{row.byWeapon.map(weapon => <i key={weapon.label} style={{ flexGrow: weapon.damage }} />)}</div>
      <p className="aar-num">{row.byWeapon.map(weapon => <span key={weapon.label}>{weapon.label} <b>{whole(weapon.damage)}</b></span>)}</p>
    </div>}
  </li>;
}

function DamageRace({ race }: { race: ReturnType<typeof damageRace> }) {
  const x = (tick: number) => tick / race.ticks * 100, y = (value: number) => 100 - value / race.max * 100;
  const line = (side: 'own' | 'enemy') => race.samples.map((sample, index) => index ? `H${x(sample.tick).toFixed(2)} V${y(sample[side]).toFixed(2)}` : `M0 ${y(sample[side]).toFixed(2)}`).join(' ');
  const minutes = Math.max(1, Math.round(race.ticks / 3600 / 4)) ;
  const labels = Array.from({ length: Math.floor(race.ticks / 3600 / minutes) + 1 }, (_, index) => index * minutes * 3600).filter(tick => race.ticks - tick > race.ticks * .06);
  return <section className="aar-race" aria-label="Damage dealt over the battle">
    <div className="aar-race-head"><span className="aar-eyebrow">Damage dealt over the battle</span>
      <span className="aar-num"><b data-team="friendly">Your fleet {whole(race.own)}</b><b data-team="enemy">Enemy {whole(race.enemy)}</b></span></div>
    <div className="aar-chart">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <path className="aar-grid" d="M0 100 H100 M0 50 H100 M0 0 H100" /><path data-team="enemy" d={line('enemy')} /><path data-team="friendly" d={line('own')} />
      </svg>
      {race.marks.map((mark, index) => <span key={`${mark.tick}${mark.label}`} className="aar-mark" data-team={mark.friendly ? 'enemy' : 'friendly'} data-flip={x(mark.tick) > 78}
        style={{ left: `${x(mark.tick)}%`, '--row': index % 3 } as CSSProperties}><i />{mark.label}</span>)}
      <div className="aar-axis aar-num">{labels.map(tick => <span key={tick} style={{ left: `${x(tick)}%` }}>{battleTime(tick)}</span>)}<span style={{ left: '100%' }}>{battleTime(race.ticks)}</span></div>
    </div>
  </section>;
}

function ShipHits({ debrief, ship, onShip, loadModel }: { debrief: BattleDebrief; ship: DebriefShip; onShip(id: string): void; loadModel: Props['loadModel'] }) {
  const rows = useMemo(() => hitRows(debrief, ship.id), [debrief, ship.id]);
  const titles = useMemo(() => shipTitles(debrief), [debrief]);
  const [selected, setSelected] = useState<number>();
  const worst = useMemo(() => rows.reduce<HitRow | undefined>((best, row) => !best || row.hit.damage > best.hit.damage ? row : best, undefined), [rows]);
  const row = rows.find(candidate => candidate.n === selected) ?? worst;
  const blocked = rows.filter(candidate => candidate.tone === 'blocked').length;
  const step = (by: number) => row && setSelected(rows[(rows.indexOf(row) + by + rows.length) % rows.length].n);
  return <div className="aar-ship">
    <div className="aar-ship-head">
      <div>
        <Select aria-label="Ship" value={ship.id} onValueChange={onShip}>
          {debrief.ships.map(other => <SelectOption key={other.id} value={other.id}>{`${titles.get(other.id)}${other.isPlayer ? ' (you)' : other.team === 'enemy' ? ' · enemy' : ''}`}</SelectOption>)}
        </Select>
        <p className="aar-num">{ship.status === 'sunk' ? 'Sunk' : ship.status === 'incapacitated' ? 'Out of action' : `Afloat at ${Math.round(ship.integrity * 100)}%`} · {rows.length.toLocaleString('en-US')} {rows.length === 1 ? 'hit' : 'hits'}
          {blocked > 0 && ` · ${blocked} stopped by armor`} · {whole(ship.report.damageTaken)} damage{ship.report.hitsOmitted > 0 && ` · ${ship.report.hitsOmitted} lesser hits not shown`}</p>
      </div>
      <ul className="aar-legend" aria-label="Hit marks">
        <li data-tone="penetrated">Penetrated</li><li data-tone="explosive">High explosive</li><li data-tone="torpedo">Torpedo</li><li data-tone="blocked">Stopped by armor</li><li>Larger mark, more damage</li>
      </ul>
    </div>
    <HitModel load={() => ship.definition ? loadModel(ship) : Promise.reject(new Error('unavailable'))} rows={rows} selected={row?.n} onSelect={setSelected} label={`${titles.get(ship.id)}, hits received. Drag to turn the ship, scroll to zoom.`} />
    <p className="aar-hint">Drag to turn the ship · scroll to zoom</p>
    {row ? <article className="aar-hit" aria-live="polite">
      <div className="aar-hit-n"><strong className="aar-num">{row.n}</strong><span className="aar-num">{row.time}</span></div>
      <div className="aar-hit-what">
        <strong>{row.hit.weapon} from {row.from}</strong>
        {row.hit.struck && <span>{plainName(row.hit.struck)}</span>}
        {row.plate && <span className="aar-muted">{row.plate}</span>}
      </div>
      <div className="aar-hit-effect">
        <div><b data-tone={row.tone}>{row.outcome}</b><span><strong className="aar-num">{whole(row.hit.damage)}</strong> {row.hit.damage >= .5 ? 'damage' : 'no damage'}</span></div>
        {row.effects.length ? <ul>{row.effects.map(effect => <li key={effect.name + effect.effect}><strong>{effect.name}</strong><span>{effect.effect}</span></li>)}</ul>
          : <p className="aar-muted">No modules affected</p>}
      </div>
      <div className="aar-hit-step">
        <Button variant="icon" aria-label="Previous hit" onClick={() => step(-1)}>‹</Button>
        <Button variant="icon" aria-label="Next hit" onClick={() => step(1)}>›</Button>
      </div>
    </article> : <p className="aar-unhit">{titles.get(ship.id)} was not hit.</p>}
    <HitTimeline debrief={debrief} rows={rows} selected={row?.n} onSelect={setSelected} />
  </div>;
}

function HitTimeline({ debrief, rows, selected, onSelect }: { debrief: BattleDebrief; rows: readonly HitRow[]; selected?: number; onSelect(n: number): void }) {
  const race = useMemo(() => damageRace(debrief), [debrief]);
  const numbered = rows.length <= 40;
  return <div className="aar-timeline" role="group" aria-label="Hits over the battle">
    <span className="aar-num">0:00</span>
    <div>
      {rows.map(row => <button key={row.n} type="button" className="aar-pin" data-tone={row.tone} data-size={row.size} aria-pressed={row.n === selected} style={{ left: `${row.hit.tick / race.ticks * 100}%` }}
        aria-label={`Hit ${row.n} at ${row.time}`} onClick={() => onSelect(row.n)}><span>{numbered || row.n === selected ? row.n : ''}</span></button>)}
      {race.marks.map(mark => <span key={`${mark.tick}${mark.label}`} className="aar-mark" data-team={mark.friendly ? 'enemy' : 'friendly'} style={{ left: `${mark.tick / race.ticks * 100}%` }}><i />{mark.label}</span>)}
    </div>
    <span className="aar-num">{battleTime(race.ticks)}</span>
  </div>;
}
