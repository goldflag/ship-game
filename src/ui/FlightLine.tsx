import { Fragment, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { Aircraft } from '../simulation/aircraft';
import { FIGHTER_AMMO_BURSTS } from '../simulation/aircraft';
import type { DeckServiceAction } from '../game/session/BattleSession';
import type { DeckPolicy } from '../multiplayer/generated/DeckPolicy';
import type { SearchAltitude } from '../multiplayer/generated/SearchAltitude';
import type { SearchPolicy } from '../multiplayer/generated/SearchPolicy';
import { AIR_STATUS_LABELS, airStatus, type AirWingTelemetry, type FlightSummary } from '../simulation/airTelemetry';
import { assetUrl } from '../assetUrl';
import { AirGroupService, CarrierDeck } from './CarrierDeck';
import { actionAvailable, SQUADRON_ACTIONS } from './airCommands';
import { duration, groupArmament, mission } from './airFormat';
import { Select, SelectOption } from './components';
import { Icon } from './Icons';
import { PLANE_GLYPHS } from './planeGlyphs';
import './AirWingManifest.css';
import './FlightLine.css';

export type AirVerb = 'patrol' | 'attack' | 'defend' | 'intercept' | 'escort' | 'return' | 'search';
export interface FlightLineCarrier { id: string; name: string; hull: number; kn: number; order: string; wing: AirWingTelemetry }
export type FlightLineFlight = FlightSummary & { ownerId: string; carrierName: string };
export interface FlightLineProps {
  carriers: readonly FlightLineCarrier[];
  flights: readonly FlightLineFlight[];
  planesOf(flight: FlightLineFlight): Aircraft[];
  selectedIds: readonly string[]; hoverId?: string;
  armed?: AirVerb;
  actionable: boolean;
  hasBoundary: boolean;
  search: { radius: number; altitude: SearchAltitude; policy: SearchPolicy; setRadius(v: number): void; setAltitude(v: SearchAltitude): void; setPolicy(v: SearchPolicy): void };
  /** Carrier whose flight deck popover is open. */
  deckOpen?: string;
  onHover(id: string | undefined): void;
  onSelect(id: string, additive: boolean): void;
  onVerb(verb: AirVerb): void;
  onFollowLead(flight: FlightLineFlight): void; canFollow(flight: FlightLineFlight): boolean;
  onCentre(flight: FlightLineFlight): void;
  onService(flights: FlightSummary[], action: DeckServiceAction): void;
  onDeckPolicy(carrierId: string, policy: DeckPolicy): void; onPrioritize(carrierId: string, requestId: number): void; onCancelTask(carrierId: string, requestId: number): void;
  onToggleDeck(carrierId: string | undefined): void;
  onClose(): void;
}

const VERBS: Record<AirVerb, { label: string; key: string }> = {
  patrol: { label: 'Loiter', key: 'L' }, attack: { label: 'Strike', key: 'A' }, defend: { label: 'Defend', key: 'D' },
  intercept: { label: 'Intercept', key: 'I' }, escort: { label: 'Escort', key: 'E' }, return: { label: 'Return', key: 'R' }, search: { label: 'Search', key: 'S' },
};
/** The order kind in the words the buttons use, so the report and the verb match. */
const ORDER_LABELS: Record<string, string> = { patrol: 'Loiter', attack: 'Strike', strike: 'Strike', defend: 'Defend', intercept: 'Intercept', 'intercept-contact': 'Intercept', escort: 'Escort', 'search-area': 'Search', return: 'Return' };
const POLICY_LABELS: Record<DeckPolicy, string> = { balanced: 'Balanced', 'launch-first': 'Launch first', 'recover-first': 'Recover first' };
const CARD_WIDTH = 300, DECK_WIDTH = 320;
const lost = (p: Aircraft) => p.hp <= 0 || ['lost', 'withdrawn'].includes(p.phase);
const loaded = (p: Aircraft) => p.role === 'fighter' ? p.ammo > 0 : p.payload;
/** Armament left as 0–1: gun bursts for fighters, the single bomb or torpedo for bombers. */
const armament = (p: Aircraft) => lost(p) ? 0 : p.role === 'fighter' ? Math.max(0, Math.min(1, p.ammo / FIGHTER_AMMO_BURSTS)) : p.payload ? 1 : 0;
const condition = (p: Aircraft) => lost(p) ? 'lost' : p.hp < 25 ? 'critical' : p.hp < 50 ? 'damaged' : undefined;
const planeTitle = (p: Aircraft) => `${p.id.split('/').at(-1)} · ${Math.ceil(Math.max(0, p.hp))}% · ${p.lossReason ?? p.phase}${loaded(p) ? ' · armed' : p.role === 'fighter' ? ' · no ammunition' : ' · no payload'}`;
/** A group with a deck record has to be raised and cleared before it can fly again. */
const grounded = (f: FlightSummary) => !!f.deck && !f.active && !f.deck.canLaunch;
const statusLabel = (f: FlightSummary) => f.status === 'on-mission' ? f.activity : AIR_STATUS_LABELS[f.status];
const sortie = (f: FlightSummary) => ['on-mission', 'launching'].includes(f.status);
/** Endurance for a flight in the air; otherwise where the group waits. */
const whereabouts = (f: FlightSummary) => f.airborne > 0 ? f.enduranceSeconds !== null ? duration(f.enduranceSeconds) : 'airborne' : (f.deck?.onDeck ?? 0) > 0 ? 'on deck' : 'in hangar';
const orderLine = (f: FlightSummary) => sortie(f) ? <><b>{ORDER_LABELS[f.order.kind] ?? f.activity}</b> · {mission(f)}</> : <b>{f.activity}</b>;

/** Air groups live on one line at the foot of the chart, the way the carrier's
 * own M view shows them: a chip per carrier, a box per group with the aircraft
 * picture, the verbs for the selection in a bar above, a detail card while a
 * box is hovered, and the flight deck as a popover from the chip. */
export function FlightLine({ carriers, flights, planesOf, selectedIds, hoverId, armed, actionable, hasBoundary, search, deckOpen,
  onHover, onSelect, onVerb, onFollowLead, canFollow, onCentre, onService, onDeckPolicy, onPrioritize, onCancelTask, onToggleDeck, onClose }: FlightLineProps) {
  const selected = flights.filter(f => selectedIds.includes(f.id));
  const hovered = hoverId ? flights.find(f => f.id === hoverId) : undefined;
  const deckCarrier = deckOpen ? carriers.find(c => c.id === deckOpen && c.wing.deck) : undefined;
  const line = useRef<HTMLElement>(null);
  const [cardLeft, setCardLeft] = useState(0);
  const [deckLeft, setDeckLeft] = useState(0);
  // Popovers hang from the box or chip they belong to, clamped inside the line.
  useLayoutEffect(() => {
    const root = line.current;
    if (!root) return;
    const place = (selector: string, width: number, set: (left: number) => void) => {
      const element = root.querySelector<HTMLElement>(selector);
      if (!element) return;
      const bounds = root.getBoundingClientRect(), box = element.getBoundingClientRect();
      set(Math.max(0, Math.min(box.left - bounds.left, bounds.width - width)));
    };
    if (hovered) place(`[data-flight-id="${hovered.id}"]`, CARD_WIDTH, setCardLeft);
    if (deckCarrier) place(`[data-carrier-id="${deckCarrier.id}"]`, DECK_WIDTH, setDeckLeft);
  }, [hovered?.id, deckCarrier?.id]);

  const canVerb = (flight: FlightSummary, verb: AirVerb) => {
    if (verb === 'return') return flight.active;
    if (verb === 'search') return hasBoundary && !grounded(flight) && !(flight.role === 'fighter' && search.policy === 'strike');
    const action = SQUADRON_ACTIONS.find(a => a.kind === verb);
    return !!action && actionAvailable(action, flight.role) && !grounded(flight);
  };
  const verbs: AirVerb[] = selected.length ? ['patrol', ...(selected.some(f => f.role === 'fighter') ? ['defend' as const] : []), ...(selected.some(f => f.role !== 'fighter') ? ['attack' as const] : []),
    'intercept', 'escort', 'return', ...(hasBoundary ? ['search' as const] : [])] : [];
  const verbDisabled = (verb: AirVerb) => !actionable || !selected.some(f => canVerb(f, verb));
  const decked = selected.filter(f => f.deck && !f.active);
  const hint = selected.length === 0 ? <>Select a group · <kbd>1</kbd>–<kbd>9</kbd> · or click its planes on the chart</>
    : selected.length === 1 ? <><b>{selected[0].name}</b> · {selected[0].active ? mission(selected[0]) : selected[0].activity} · {groupArmament(planesOf(selected[0])).label}{selected[0].notice ? ` · ${selected[0].notice}` : ''}</>
    : <><b>{selected.length} air groups</b> · {[...new Set(selected.map(f => f.carrierName))].join(', ')}</>;

  const bar = <div className="flight-line-bar" role="group" aria-label="Air group orders">
    {selected.length > 0 && <>
      {verbs.map(verb => <button key={verb} disabled={verbDisabled(verb)} aria-pressed={armed === verb} onClick={() => onVerb(verb)}>{VERBS[verb].label}<kbd>{VERBS[verb].key}</kbd></button>)}
      <span className="flight-line-sep"/>
      <button disabled={!canFollow(selected[0])} onClick={() => onFollowLead(selected[0])}><Icon name="camera" size={13}/>Follow lead</button>
      <button onClick={() => onCentre(selected[0])}><Icon name="target" size={13}/>Centre</button>
      {decked.length > 0 && <><span className="flight-line-sep"/><AirGroupService flights={decked} enabled={actionable} command={onService} compact/></>}
    </>}
    <span className="flight-line-hint">{hint}</span>
  </div>;

  const searchRow = armed === 'search' && hasBoundary && <div className="flight-line-search" role="group" aria-label="Search settings">
    <label>Radius<Select value={search.radius} disabled={!actionable} onValueChange={v => search.setRadius(Number(v))}>{[2000, 4000, 6000].map(v => <SelectOption key={v} value={v}>{v / 1000} km</SelectOption>)}</Select></label>
    <label>Altitude<Select value={search.altitude} disabled={!actionable} onValueChange={v => search.setAltitude(v as SearchAltitude)}><SelectOption value="low">Low · 200 m</SelectOption><SelectOption value="medium">Medium · 850 m</SelectOption><SelectOption value="high">High · 1,500 m</SelectOption></Select></label>
    <label>On contact<Select value={search.policy} disabled={!actionable} onValueChange={v => search.setPolicy(v as SearchPolicy)}><SelectOption value="report">Report only</SelectOption><SelectOption value="shadow">Shadow and report</SelectOption><SelectOption value="strike">Search and strike</SelectOption></Select></label>
  </div>;

  const chip = (carrier: FlightLineCarrier) => {
    const wing = carrier.wing, deck = wing.deck;
    const flying = flights.filter(f => f.ownerId === carrier.id).reduce((n, f) => n + f.airborne, 0);
    const current = wing.groups.find(f => f.aircraftIds.includes(deck?.currentPlaneId ?? ''));
    const waiting = deck?.queue.length ? deck.queue.every(r => r.action === 'raise') && deck.occupied >= deck.capacity ? 'Waiting for deck space' : 'Handling tasks queued' : 'Deck crew ready';
    const closed = wing.recovery?.kind === 'closed' ? wing.recovery.reason : undefined;
    const task = closed ?? (deck ? deck.suspended ? 'Deck operations suspended' : `${deck.task ?? waiting}${current ? ` · ${current.name}` : ''}` : carrier.order);
    const open = deckCarrier?.id === carrier.id;
    return <div key={carrier.id} className="flight-line-carrier" data-carrier-id={carrier.id} role="group" aria-label={`${carrier.name} air wing`}>
      <div className="flight-line-carrier-name"><b>{carrier.name}</b><span className={carrier.hull < .5 ? 'warn' : undefined}>{Math.round(carrier.hull * 100)}% · {carrier.kn} kn</span></div>
      <div className="flight-line-figures">
        <span><b>{wing.onDeck}<i>/{wing.deckCapacity}</i></b><small>deck</small></span>
        <span><b>{wing.inHangar}</b><small>hangar</small></span>
        <span><b>{flying}</b><small>airborne</small></span>
      </div>
      <p className="flight-line-task" data-suspended={!!closed || deck?.suspended || undefined} title={task}>{task}</p>
      {deck && <button className="flight-line-deck-toggle" aria-expanded={open} onClick={() => onToggleDeck(open ? undefined : carrier.id)}>
        Deck · <b>{POLICY_LABELS[deck.policy]}</b>{deck.queue.length ? ` · queue ${deck.queue.length}` : ''}<Icon name="chevron" size={11} style={{ transform: open ? 'rotate(180deg)' : undefined }}/>
      </button>}
    </div>;
  };

  const box = (flight: FlightLineFlight) => {
    const index = flights.indexOf(flight);
    const planes = planesOf(flight);
    const model = (planes.find(p => !lost(p)) ?? planes[0])?.modelId;
    const onDeck = flight.airborne === 0;
    const on = selectedIds.includes(flight.id);
    const armament = groupArmament(planes);
    return <button key={flight.id} className={['flight-line-box', onDeck && 'decked', hoverId === flight.id && 'hovered'].filter(Boolean).join(' ')} data-flight-id={flight.id} aria-pressed={on}
      aria-label={`${flight.name} · ${flight.surviving} of ${flight.total} aircraft · ${flight.armed} armed · ${statusLabel(flight)}${index < 9 ? ` · key ${index + 1}` : ''}`}
      title={`${flight.carrierName} · ${flight.active ? mission(flight) : flight.activity}${flight.notice ? ` · ${flight.notice}` : ''}`}
      onMouseEnter={() => onHover(flight.id)} onMouseLeave={() => onHover(undefined)} onFocus={() => onHover(flight.id)} onBlur={() => onHover(undefined)}
      onClick={event => onSelect(flight.id, event.shiftKey || event.ctrlKey || event.metaKey)}>
      <span className="flight-line-box-head"><strong>{flight.name}</strong>{index < 9 && <kbd>{index + 1}</kbd>}</span>
      {model ? <img className="flight-line-aircraft" src={assetUrl(`models/aircraft/${model}-thumbnail.png`)} alt="" width="76" height="34" draggable={false} onError={e => { e.currentTarget.style.visibility = 'hidden'; }}/> : <span className="flight-line-aircraft"/>}
      <span className="flight-line-count">{flight.surviving}<small>/{flight.total}</small></span>
      <span className={`flight-line-status ${flight.notice ? 'notice' : onDeck ? 'decked' : ''}`}><svg viewBox="-12 -12 24 24" aria-hidden="true"><path d={PLANE_GLYPHS[flight.role]} transform="scale(1.1)"/></svg><span>{flight.notice ?? statusLabel(flight)}</span></span>
      <span className="flight-line-ticks" aria-hidden="true">{planes.map(p => <i key={p.id} className={lost(p) ? 'lost' : p.hp < 50 ? 'hurt' : loaded(p) ? 'armed' : 'empty'} title={planeTitle(p)}/>)}</span>
      <span className="flight-line-foot"><b className={armament.empty ? 'dim' : armament.low ? 'low' : undefined}>{armament.label}</b><span>{whereabouts(flight).replace('in hangar', 'hangar').replace('on deck', 'deck')}</span></span>
    </button>;
  };

  const card = hovered && (() => {
    const planes = planesOf(hovered), alive = planes.filter(p => !lost(p));
    return <div className="flight-line-card" role="tooltip" style={{ '--left': `${cardLeft}px` } as CSSProperties}>
      <div className="flight-line-card-head"><b>{hovered.name}</b><span>{hovered.surviving}/{hovered.total}<small>{groupArmament(planes).label} · {whereabouts(hovered)}{hovered.airborne > 0 && hovered.enduranceSeconds !== null ? ' endurance' : ''}</small></span></div>
      <p className="flight-line-order">{orderLine(hovered)}</p>
      <div className="flight-line-planes">
        <span className="flight-line-cells">{planes.map(p => <i key={p.id} className="air-manifest-cell" data-status={airStatus(p)} data-condition={condition(p)} title={planeTitle(p)}
          style={{ '--condition': lost(p) ? 0 : Math.max(0, Math.min(1, p.hp / 100)), '--armament': armament(p) } as CSSProperties}/>)}</span>
        {alive.length > 0 && <span>{alive.map((p, i) => { const hp = Math.round(Math.max(0, p.hp)); return <Fragment key={p.id}>{i > 0 ? ' · ' : ''}{hp < 50 ? <b>{hp}%</b> : `${hp}%`}</Fragment>; })}</span>}
      </div>
      {hovered.notice && <p className="flight-line-notice">{hovered.notice}</p>}
    </div>;
  })();

  const deck = deckCarrier && <div className="flight-line-deck" style={{ '--left': `${deckLeft}px` } as CSSProperties}>
    <div className="flight-line-deck-head"><b>{deckCarrier.name} · flight deck</b><button onClick={() => onToggleDeck(undefined)}>Close<kbd>Esc</kbd></button></div>
    <CarrierDeck name={deckCarrier.name} wing={deckCarrier.wing} enabled={actionable}
      setPolicy={policy => onDeckPolicy(deckCarrier.id, policy)} prioritize={id => onPrioritize(deckCarrier.id, id)} cancel={id => onCancelTask(deckCarrier.id, id)}/>
  </div>;

  return <section ref={line} className="flight-line" aria-label="Air groups">
    {bar}
    {searchRow}
    <div className="flight-line-row">
      {carriers.map(carrier => <div key={carrier.id} className="flight-line-wing" style={{ display: 'contents' }}>{chip(carrier)}{flights.filter(f => f.ownerId === carrier.id).map(box)}</div>)}
      <button className="flight-line-hide" onClick={onClose}>Hide<kbd>Esc</kbd></button>
    </div>
    {card}
    {deck}
  </section>;
}
