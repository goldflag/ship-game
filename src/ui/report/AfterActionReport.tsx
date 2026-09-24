import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Object3D } from 'three';
import type { BattleDebrief, BattleResult, DebriefShip } from '../../game/session/BattleSession';
import type { BattleOutcome } from '../../game/session/battleRules';
import { Button, Select, SelectOption } from '../components';
import { battleTime, damageRace, hitRows, plainName, reasonText, resultTitle, shipTitles, stackLabels, whole, type HitRow } from './afterAction';
import { BattlePlot } from './BattlePlot';
import { CaptainsLog } from './CaptainsLog';
import { FleetLedger } from './FleetLedger';
import { HitModel } from './HitModel';
import { SeaRail } from './SeaRail';
import type { XpReadout } from './battleAward';
import { XpProgress } from './XpAward';
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
  /** The battle's research XP; absent when it earns none. */
  xp?: XpReadout;
}

/** Shells still in flight when the battle is decided keep landing, so the debrief changes for a
 * few seconds. Hold one object until something a reader would see has changed. */
function useSettled(debrief: BattleDebrief): BattleDebrief {
  const held = useRef({ key: '', debrief });
  const key = debrief.ships.map(ship => `${ship.status}${ship.report.hits.length}:${Math.round(ship.damageDealt)}:${Math.round(ship.report.damageTaken)}`).join('|');
  if (held.current.key !== key) held.current = { key, debrief };
  return held.current.debrief;
}

type Tab = 'battle' | 'fleets' | 'plot' | 'hits';
const TABS: readonly [Tab, string][] = [['battle', 'Your battle'], ['fleets', 'Fleets'], ['plot', 'Battle plot'], ['hits', 'Hits']];

/** A decided battle's end screen. It opens on the sea with a rail of the result and what to do next; the full report
 * holds your battle, both fleets, the battle plot and every hit in 3D. */
export function AfterActionReport({ mode, result, outcome, debrief: latest, actions, loadModel, releasePointer, xp }: Props) {
  const debrief = useSettled(latest);
  const [view, setView] = useState<'sea' | 'report'>('sea');
  const [tab, setTab] = useState<Tab>('battle');
  const [busy, setBusy] = useState(''), [error, setError] = useState('');
  const own = debrief.ships.find(ship => ship.isPlayer) ?? debrief.ships.find(ship => ship.team === 'friendly') ?? debrief.ships[0];
  const [fleetShip, setFleetShip] = useState(own?.id ?? '');
  const [hits, setHits] = useState<{ ship: string; n?: number }>({ ship: own?.id ?? '' });
  const release = useRef(releasePointer);
  release.current = releasePointer;
  useEffect(() => release.current(), []);
  const run = async (action: ReportAction) => {
    if (busy) return;
    setBusy(action.label); setError('');
    try { await action.run(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(''); }
  };
  const inspect = (ship: string, n?: number) => { setHits({ ship, n }); setTab('hits'); };
  const openFleet = (ship: string) => { setFleetShip(ship); setTab('fleets'); };
  if (!own) return null;
  if (view === 'sea') return <section className="after-action" data-view="sea" aria-label="Battle result">
    <SeaRail mode={mode} result={result} outcome={outcome} debrief={debrief} own={own} xp={xp} actions={actions} busy={busy} error={error}
      onRun={action => void run(action)} onReport={() => setView('report')} />
  </section>;
  const subject = debrief.ships.find(ship => ship.id === hits.ship) ?? own;
  return <section className="after-action" data-view="report" data-tab={tab} aria-label="After-action report">
    <header className="aar-head">
      <div><span className="aar-eyebrow">{mode} · <span className="aar-num">{battleTime(outcome.finalTick)}</span> · {reasonText(result, outcome)}</span><h1>{resultTitle(result)}</h1></div>
      {xp && <XpProgress xp={xp} presetId={own.presetId} />}
    </header>
    <div className="aar-tabs" role="tablist" aria-label="Report">
      {TABS.map(([id, label]) => <button key={id} type="button" role="tab" id={`aar-tab-${id}`} aria-selected={tab === id} aria-controls="aar-panel" onClick={() => setTab(id)}>
        {label}{id === 'hits' && <small>{own.report.hits.length.toLocaleString('en-US')} on your ship</small>}
      </button>)}
    </div>
    <div className="aar-panel" id="aar-panel" role="tabpanel" aria-labelledby={`aar-tab-${tab}`}>
      {tab === 'battle' ? <CaptainsLog debrief={debrief} own={own} loadModel={loadModel} onHit={n => inspect(own.id, n)} onShip={openFleet} />
        : tab === 'fleets' ? <FleetLedger debrief={debrief} outcome={outcome} selected={fleetShip} onSelect={setFleetShip} loadModel={loadModel} onInspect={inspect} />
        : tab === 'plot' ? <BattlePlot debrief={debrief} outcome={outcome} />
        : <ShipHits key={subject.id} debrief={debrief} ship={subject} initialHit={hits.n} onShip={ship => setHits({ ship })} loadModel={loadModel} />}
    </div>
    <footer className="aar-foot">
      <button type="button" className="aar-link" onClick={() => setView('sea')}>‹ Back to the sea</button>
      <p role="status">{error || (busy && `${busy}…`)}</p>
      <div>{actions.map((action, index) => <Button key={action.label} variant={index ? 'secondary' : 'primary'} disabled={!!busy} onClick={() => void run(action)}>
        {action.label}{action.hint && <small>{action.hint}</small>}
      </Button>)}</div>
    </footer>
  </section>;
}

function ShipHits({ debrief, ship, initialHit, onShip, loadModel }: { debrief: BattleDebrief; ship: DebriefShip; initialHit?: number; onShip(id: string): void; loadModel: Props['loadModel'] }) {
  const rows = useMemo(() => hitRows(debrief, ship.id), [debrief, ship.id]);
  const titles = useMemo(() => shipTitles(debrief), [debrief]);
  const [selected, setSelected] = useState<number | undefined>(initialHit);
  const worst = useMemo(() => rows.reduce<HitRow | undefined>((best, row) => !best || row.hit.damage > best.hit.damage ? row : best, undefined), [rows]);
  const row = rows.find(candidate => candidate.n === selected) ?? worst;
  const blocked = rows.filter(candidate => candidate.tone === 'blocked').length;
  const step = (by: number) => row && setSelected(rows[(rows.indexOf(row) + by + rows.length) % rows.length].n);
  const condition = ship.status === 'sunk' ? 'Sunk' : ship.status === 'incapacitated' ? 'Out of action' : `Afloat at ${Math.round(ship.integrity * 100)}%`;
  // The first thing struck is usually the plate the shell met; name it once.
  const struck = row?.hit.struck && row.hit.struck !== row.hit.plate?.name ? plainName(row.hit.struck) : undefined;
  return <div className="aar-ship">
    <div className="aar-ship-head">
      <div>
        <Select aria-label="Ship" value={ship.id} onValueChange={onShip}>
          {debrief.ships.map(other => <SelectOption key={other.id} value={other.id}>{`${titles.get(other.id)}${other.isPlayer ? ' (you)' : other.team === 'enemy' ? ' · enemy' : ''}`}</SelectOption>)}
        </Select>
        <p className="aar-num">{condition} · {rows.length.toLocaleString('en-US')} {rows.length === 1 ? 'hit' : 'hits'}
          {blocked > 0 && ` · ${blocked} stopped by armor`} · {whole(ship.report.damageTaken)} damage{ship.report.hitsOmitted > 0 && ` · ${ship.report.hitsOmitted} lesser hits not shown`}</p>
      </div>
      <ul className="aar-legend" aria-label="Hit marks">
        <li data-tone="penetrated">Penetrated</li><li data-tone="explosive">High explosive</li><li data-tone="torpedo">Torpedo</li><li data-tone="blocked">Stopped by armor</li>
        <li>{rows.length > 40 ? 'Heavy hits numbered, the rest as dots' : 'Larger mark, more damage'}</li>
      </ul>
    </div>
    <HitModel load={() => ship.definition ? loadModel(ship) : Promise.reject(new Error('unavailable'))} rows={rows} selected={row?.n} onSelect={setSelected}
      label={`${titles.get(ship.id)}, hits received. Drag to turn the ship, scroll to zoom.`} />
    <p className="aar-hint">Drag to turn the ship · scroll to zoom</p>
    {row ? <article className="aar-hit" aria-live="polite">
      <div className="aar-hit-n"><strong className="aar-num">{row.n}</strong><span className="aar-num">{row.time}</span></div>
      <div className="aar-hit-what">
        <strong>{row.hit.weapon} from {row.from}</strong>
        {struck && <span>{struck}</span>}
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
  const marks = stackLabels(race.marks.map(mark => ({ ...mark, at: mark.tick / race.ticks })), .0068 * 1000 / 900);
  const rowsOfMarks = Math.max(1, ...marks.map(mark => mark.row + 1));
  return <div className="aar-timeline" role="group" aria-label="Hits over the battle" data-crowded={!numbered} style={{ '--mark-rows': rowsOfMarks } as CSSProperties}>
    <span className="aar-num">0:00</span>
    <div>
      {rows.map(row => <button key={row.n} type="button" className="aar-pin" data-tone={row.tone} data-size={row.size} aria-pressed={row.n === selected} style={{ left: `${row.hit.tick / race.ticks * 100}%` }}
        aria-label={`Hit ${row.n} at ${row.time}`} onClick={() => onSelect(row.n)}><span>{numbered || row.n === selected ? row.n : ''}</span></button>)}
      {marks.map(mark => <span key={`${mark.tick}${mark.label}`} className="aar-mark" data-team={mark.friendly ? 'enemy' : 'friendly'} data-flip={mark.flip}
        style={{ left: `${mark.at * 100}%`, '--row': mark.row } as CSSProperties}><i />{mark.label}</span>)}
    </div>
    <span className="aar-num">{battleTime(race.ticks)}</span>
  </div>;
}
