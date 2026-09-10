import { Fragment } from 'react';
import type { Aircraft } from '../simulation/aircraft';
import type { DeckServiceAction } from '../game/session/BattleSession';
import type { DeckPolicy } from '../multiplayer/generated/DeckPolicy';
import type { SearchAltitude } from '../multiplayer/generated/SearchAltitude';
import type { SearchPolicy } from '../multiplayer/generated/SearchPolicy';
import { AIR_STATUS_LABELS, type AirWingTelemetry, type FlightSummary } from '../simulation/airTelemetry';
import { AirGroupService, CarrierDeck } from './CarrierDeck';
import { actionAvailable, SQUADRON_ACTIONS } from './airCommands';
import { duration, mission } from './airFormat';
import { Select, SelectOption } from './components';
import { Icon } from './Icons';
import { PLANE_GLYPHS } from './planeGlyphs';
import './AirRail.css';

export type AirVerb = 'patrol' | 'attack' | 'defend' | 'intercept' | 'escort' | 'return' | 'search';
export interface AirRailCarrier { id: string; name: string; hull: number; kn: number; order: string; wing: AirWingTelemetry }
export type AirRailFlight = FlightSummary & { ownerId: string; carrierName: string };
export interface AirRailProps {
  carriers: readonly AirRailCarrier[];
  flights: readonly AirRailFlight[];
  planesOf(flight: AirRailFlight): Aircraft[];
  selectedIds: readonly string[]; hoverId?: string;
  armed?: AirVerb;
  actionable: boolean;
  hasBoundary: boolean;
  search: { radius: number; altitude: SearchAltitude; policy: SearchPolicy; setRadius(v: number): void; setAltitude(v: SearchAltitude): void; setPolicy(v: SearchPolicy): void };
  onHover(id: string | undefined): void;
  onSelect(id: string, additive: boolean): void;
  onVerb(verb: AirVerb): void;
  onFollowLead(flight: AirRailFlight): void; canFollow(flight: AirRailFlight): boolean;
  onCentre(flight: AirRailFlight): void;
  onService(flights: FlightSummary[], action: DeckServiceAction): void;
  onDeckPolicy(carrierId: string, policy: DeckPolicy): void; onPrioritize(carrierId: string, requestId: number): void; onCancelTask(carrierId: string, requestId: number): void;
  onClose(): void;
}

const VERBS: Record<AirVerb, { label: string; key: string }> = {
  patrol: { label: 'Loiter', key: 'L' }, attack: { label: 'Strike', key: 'A' }, defend: { label: 'Defend', key: 'D' },
  intercept: { label: 'Intercept', key: 'I' }, escort: { label: 'Escort', key: 'E' }, return: { label: 'Return', key: 'R' }, search: { label: 'Search', key: 'S' },
};
/** The order kind in the words the buttons use, so the report and the verb match. */
const ORDER_LABELS: Record<string, string> = { patrol: 'Loiter', attack: 'Strike', strike: 'Strike', defend: 'Defend', intercept: 'Intercept', 'intercept-contact': 'Intercept', escort: 'Escort', 'search-area': 'Search', return: 'Return' };
const lost = (p: Aircraft) => p.hp <= 0 || ['lost', 'withdrawn'].includes(p.phase);
const loaded = (p: Aircraft) => p.role === 'fighter' ? p.ammo > 0 : p.payload;
const planeTitle = (p: Aircraft) => `${p.id.split('/').at(-1)} · ${Math.ceil(Math.max(0, p.hp))}% · ${p.lossReason ?? p.phase}${loaded(p) ? ' · armed' : p.role === 'fighter' ? ' · no ammunition' : ' · no payload'}`;
/** A group with a deck record has to be raised and cleared before it can fly again. */
const grounded = (f: FlightSummary) => !!f.deck && !f.active && !f.deck.canLaunch;
const statusLabel = (f: FlightSummary) => f.status === 'on-mission' ? f.activity : AIR_STATUS_LABELS[f.status];
/** The detail after the status is dropped when it only repeats it ("Ready · Ready"). */
const detail = (f: FlightSummary) => { const text = f.active ? mission(f) : f.activity; return text === statusLabel(f) ? '' : text; };

/** Air groups live on one rail: every group of every carrier, the selected one
 * expanded in place with its verbs, and the flight deck pinned at the foot. */
export function AirRail({ carriers, flights, planesOf, selectedIds, hoverId, armed, actionable, hasBoundary, search,
  onHover, onSelect, onVerb, onFollowLead, canFollow, onCentre, onService, onDeckPolicy, onPrioritize, onCancelTask, onClose }: AirRailProps) {
  const totals = carriers.reduce((sum, { wing }) => {
    const all = Object.values(wing.counts).reduce((n, v) => n + v, 0);
    return { total: sum.total + all, remaining: sum.remaining + all - wing.counts.lost - wing.counts.withdrawn, deck: sum.deck + wing.onDeck, hangar: sum.hangar + wing.inHangar };
  }, { total: 0, remaining: 0, deck: 0, hangar: 0 });
  const airborne = flights.reduce((n, f) => n + f.airborne, 0);
  const decked = carriers.filter(c => c.wing.deck);

  const verbsFor = (flight: AirRailFlight): AirVerb[] => ['patrol', flight.role === 'fighter' ? 'defend' : 'attack', 'intercept', 'escort', 'return', ...(hasBoundary ? ['search' as const] : [])];
  const verbDisabled = (flight: AirRailFlight, verb: AirVerb) => {
    if (!actionable) return true;
    if (verb === 'return') return !flight.active;
    if (verb === 'search') return grounded(flight) || (flight.role === 'fighter' && search.policy === 'strike');
    const action = SQUADRON_ACTIONS.find(a => a.kind === verb);
    return !action || !actionAvailable(action, flight.role) || grounded(flight);
  };

  const expanded = (flight: AirRailFlight) => {
    const planes = planesOf(flight);
    const alive = planes.filter(p => !lost(p));
    return <div className="air-rail-expanded">
      <div className="air-rail-line"><span>{flight.surviving}/{flight.total} planes · {flight.total - flight.surviving} lost</span>
        <span className="air-rail-bars">{planes.map(p => <i key={p.id} className={lost(p) ? 'lost' : p.hp < 50 ? 'hurt' : undefined} title={planeTitle(p)}
          style={{ ['--hp' as string]: `${Math.max(0, Math.min(100, p.hp))}%` }}/>)}</span></div>
      {alive.length > 0 && <div className="air-rail-line"><span>HP</span><span className="air-rail-hp">{alive.map((p, i) => {
        const hp = Math.round(Math.max(0, p.hp));
        return <Fragment key={p.id}>{i > 0 ? ' · ' : ''}{hp < 50 ? <b>{hp}%</b> : `${hp}%`}</Fragment>;
      })}</span></div>}
      <p className="air-rail-order">{['on-mission', 'launching'].includes(flight.status) ? <><b>{ORDER_LABELS[flight.order.kind] ?? flight.activity}</b> · {mission(flight)}</> : <b>{flight.activity}</b>}</p>
      <div className="air-rail-row air-rail-verbs" role="group" aria-label={`${flight.name} orders`}>{verbsFor(flight).map(verb =>
        <button key={verb} disabled={verbDisabled(flight, verb)} aria-pressed={armed === verb} onClick={() => onVerb(verb)}>{VERBS[verb].label}<kbd>{VERBS[verb].key}</kbd></button>)}</div>
      {hasBoundary && <div className="air-rail-search">
        <label>Radius<Select value={search.radius} disabled={!actionable} onValueChange={v => search.setRadius(Number(v))}>{[2000, 4000, 6000].map(v => <SelectOption key={v} value={v}>{v / 1000} km</SelectOption>)}</Select></label>
        <label>Altitude<Select value={search.altitude} disabled={!actionable} onValueChange={v => search.setAltitude(v as SearchAltitude)}><SelectOption value="low">Low · 200 m</SelectOption><SelectOption value="medium">Medium · 850 m</SelectOption><SelectOption value="high">High · 1,500 m</SelectOption></Select></label>
        <label>On contact<Select value={search.policy} disabled={!actionable} onValueChange={v => search.setPolicy(v as SearchPolicy)}><SelectOption value="report">Report only</SelectOption><SelectOption value="shadow">Shadow and report</SelectOption><SelectOption value="strike">Search and strike</SelectOption></Select></label>
      </div>}
      <div className="air-rail-row">
        <button disabled={!canFollow(flight)} onClick={() => onFollowLead(flight)}><Icon name="camera" size={13}/>Follow lead</button>
        <button onClick={() => onCentre(flight)}><Icon name="target" size={13}/>Centre on chart</button>
      </div>
      <AirGroupService flights={[flight]} enabled={actionable} command={onService}/>
    </div>;
  };

  const row = (flight: AirRailFlight) => {
    const selected = selectedIds.includes(flight.id);
    const planes = planesOf(flight);
    const foot = flight.airborne > 0 ? flight.enduranceSeconds !== null ? duration(flight.enduranceSeconds) : 'airborne'
      : (flight.deck?.onDeck ?? 0) > 0 ? 'on deck' : 'in hangar';
    return <div key={flight.id}>
      <button className={['air-rail-group', hoverId === flight.id && 'hovered', flight.airborne === 0 && 'deckd'].filter(Boolean).join(' ')} aria-pressed={selected}
        onMouseEnter={() => onHover(flight.id)} onMouseLeave={() => onHover(undefined)} onFocus={() => onHover(flight.id)} onBlur={() => onHover(undefined)}
        onClick={event => onSelect(flight.id, event.shiftKey || event.ctrlKey || event.metaKey)}>
        <svg className="air-rail-glyph" viewBox="-12 -12 24 24" aria-hidden="true"><path d={PLANE_GLYPHS[flight.role]} transform="scale(1.1)"/></svg>
        <span className="air-rail-name">{flight.name}</span>
        <span className={flight.armed ? 'air-rail-armed' : 'air-rail-armed dim'}>{flight.armed}/{flight.surviving} armed<small>{foot}</small></span>
        <span className="air-rail-status"><b>{statusLabel(flight)}</b>{detail(flight) && ` · ${detail(flight)}`}</span>
        <span className="air-rail-dots">{planes.map(p => <i key={p.id} className={lost(p) ? 'lost' : p.hp < 50 ? 'hurt' : loaded(p) ? undefined : 'empty'} title={planeTitle(p)}/>)}</span>
        {flight.notice && <span className="air-rail-notice">{flight.notice}</span>}
      </button>
      {selected && expanded(flight)}
    </div>;
  };

  return <section className="air-rail" aria-label="Air groups">
    <header className="air-rail-title">
      <h2>Air groups</h2>
      <p>{totals.remaining} of {totals.total} · {airborne} airborne · {totals.deck} deck · {totals.hangar} hangar</p>
      <button className="air-rail-hide" onClick={onClose}>Hide<kbd>Esc</kbd></button>
    </header>
    <div className="air-rail-list">{carriers.map(carrier => {
      const wing = carrier.wing, deck = wing.deck;
      const current = wing.groups.find(f => f.aircraftIds.includes(deck?.currentPlaneId ?? ''));
      const waiting = deck?.queue.length ? deck.queue.every(r => r.action === 'raise') && deck.occupied >= deck.capacity
        ? 'Waiting for deck space' : 'Handling tasks queued' : 'Deck crew ready';
      const flying = flights.filter(f => f.ownerId === carrier.id).reduce((n, f) => n + f.airborne, 0);
      return <div key={carrier.id} className="air-rail-block">
        <div className="air-rail-carrier">
          <div className="air-rail-carrier-name"><b>{carrier.name}</b><span>{Math.round(carrier.hull * 100)}%<small>{carrier.kn} kn · {carrier.order}</small></span></div>
          <div className="air-rail-stats">
            <div><small>Deck</small><b>{wing.onDeck}<i>/{wing.deckCapacity}</i></b></div>
            <div><small>Hangar</small><b>{wing.inHangar}</b></div>
            <div><small>Airborne</small><b>{flying}</b></div>
            {deck && <div><small>Policy</small><Select value={deck.policy} disabled={!actionable} aria-label={`${carrier.name} deck policy`} onValueChange={value => onDeckPolicy(carrier.id, value as DeckPolicy)}>
              <SelectOption value="balanced">Balanced</SelectOption><SelectOption value="launch-first">Launch first</SelectOption><SelectOption value="recover-first">Recover first</SelectOption>
            </Select></div>}
          </div>
          {deck && <p className="air-rail-task" data-suspended={deck.suspended || undefined}>{deck.suspended ? 'Deck operations suspended' : deck.task ?? waiting}{current && ` · ${current.name}`}</p>}
          {wing.recovery?.kind === 'closed' && <p className="air-rail-task" data-suspended>{wing.recovery.reason}</p>}
        </div>
        {flights.filter(f => f.ownerId === carrier.id).map(row)}
      </div>;
    })}</div>
    {decked.length > 0 && <footer className="air-rail-deck">{decked.map(carrier =>
      <CarrierDeck key={carrier.id} name={carrier.name} wing={carrier.wing} enabled={actionable}
        prioritize={id => onPrioritize(carrier.id, id)} cancel={id => onCancelTask(carrier.id, id)}/>)}</footer>}
  </section>;
}
