import { Select, SelectOption } from './components';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Game } from '../game/Game';
import type { Telemetry } from '../game/types';
import type { Keybindings } from '../game/keybindings';
import type { FleetOrderState } from '../multiplayer/generated/FleetOrderState';
import type { ContactTrack } from '../multiplayer/generated/ContactTrack';
import type { CombatTelemetry } from '../simulation/combat';
import type { SearchAltitude } from '../multiplayer/generated/SearchAltitude';
import type { SearchPolicy } from '../multiplayer/generated/SearchPolicy';
import type { Vec3 } from '../ships/blueprint';
import { airWingTelemetry } from '../simulation/airTelemetry';
import { AirGroupService, CarrierDeck } from './CarrierDeck';
import { KNOTS_PER_MPS } from '../simulation/ship';
import { SquadronLabels, useMapProjection } from './AirOperations';
import { AirMapNavigation } from './airMapNavigation';
import { actionAvailable, SQUADRON_ACTIONS, squadronTargetOrder, type SquadronAction, type SquadronTarget } from './airCommands';
import { duration, mission, roleIcon, roleLabel } from './airFormat';
import { Icon } from './Icons';
import { assetUrl } from '../assetUrl';
import { shipPreset } from '../ships/presets';
import './FleetCommand.css';

type Contact = CombatTelemetry['contacts'][number];
type ArmedOrder = 'search' | 'move' | 'escort' | 'focus' | SquadronAction;
const circlePoints = (x: number, z: number, radius: number): Vec3[] => Array.from({ length: 65 }, (_, i) => [x + Math.sin(i / 64 * Math.PI * 2) * radius, 0, z + Math.cos(i / 64 * Math.PI * 2) * radius]);
const reportName = (track: ContactTrack) => track.identifiedPresetId ? shipPreset(track.identifiedPresetId).name : track.classification ?? (track.kind === 'aircraft' ? 'Aircraft contact' : 'Surface contact');
const reportAge = (track: ContactTrack, tick: number) => `${Math.max(0, Math.floor((tick - track.lastObservedTick) / 60))}s ago`;
const reportUncertainty = (track: ContactTrack) => track.uncertaintyM >= 1000 ? `${(track.uncertaintyM / 1000).toFixed(1)} km` : `${Math.round(track.uncertaintyM)} m`;
export function standingOrder(order?: FleetOrderState, nameFor: (id: string) => string = id => id): string {
  if (!order) return 'Awaiting order report';
  const task = order.movement;
  const status = order.navigation?.status;
  if (status === 'leader-lost') return 'Leader lost · Holding locally';
  if (status === 'blocked') return 'Route blocked · Reassign destination';
  if (status === 'immobile') return 'Unable to maneuver · Check damage';
  const label = task.type === 'route' ? `${task.looped ? 'Patrol' : 'Route'} · ${(task.speedMps * KNOTS_PER_MPS).toFixed(0)} kn · Waypoint ${(order.navigation?.waypoint ?? 0) + 1}/${task.waypoints.length}`
    : task.type === 'escort' ? `Escort ${nameFor(task.leaderId)} · ${status?.replaceAll('-', ' ') ?? 'Assigned'}`
    : task.type === 'hold-area' ? `Hold area · ${(task.radiusM / 1000).toFixed(1)} km`
    : task.type === 'move' ? 'Move to waypoint' : task.type === 'hold' ? 'Stop' : 'Autonomous movement';
  return order.manual ? `${label} · Saved while at helm` : label;
}
function routePoints(ship: Contact, order?: FleetOrderState, contacts: Contact[] = []): Vec3[] {
  const task = order?.movement;
  const origin: Vec3 = [ship.x, 0, ship.z];
  if (task?.type === 'route') return [origin, ...task.waypoints.slice(order?.navigation?.waypoint ?? 0).map(([x, z]): Vec3 => [x, 0, z])];
  if (task?.type === 'hold-area') {
    return Array.from({ length: 65 }, (_, i): Vec3 => [task.position[0] + Math.sin(i / 64 * Math.PI * 2) * task.radiusM, 0, task.position[1] + Math.cos(i / 64 * Math.PI * 2) * task.radiusM]);
  }
  if (task?.type === 'escort') {
    const leader = contacts.find(c => c.id === task.leaderId);
    if (leader) return [origin, [leader.x + Math.cos(leader.heading) * task.offset[0] - Math.sin(leader.heading) * task.offset[1], 0, leader.z + Math.sin(leader.heading) * task.offset[0] + Math.cos(leader.heading) * task.offset[1]]];
  }
  return [];
}

/** Variation D: selection changes the card; follow changes the camera; only
 * Take helm transfers manual control. Every actual order travels through Rust. */
export function FleetCommand({ data, game, bindings }: { data: Telemetry; game: Game; bindings: Keybindings }) {
  const combat = data.combat!;
  const mapOpen = !!data.airOperationsOpen;
  const owned = combat.contacts.filter(c => c.team === 'friendly');
  const ships = owned.map(s => {
    const same = owned.filter(other => other.name === s.name);
    return same.length > 1 ? { ...s, name: `${s.name} ${same.findIndex(other => other.id === s.id) + 1}` } : s;
  });
  const nameFor = (id: string) => ships.find(s => s.id === id)?.name ?? 'assigned leader';
  const observations = game.simulation.observationTracks ?? [];
  const enemies = [...combat.contacts.filter(c => c.team === 'enemy' && !c.physicalLost), ...observations.map(c => ({ id: c.id, name: reportName(c), x: c.estimatedPosition[0], z: c.estimatedPosition[2] }))];
  const boundary = game.simulation.missionRules?.area;
  const ids = data.selectedShipIds ?? [];
  const selected = ships.filter(s => ids.includes(s.id) && !s.physicalLost);
  const [rosterOpen, setRosterOpen] = useState(() => typeof window === 'undefined' || window.innerWidth >= 900);
  const [contactsOpen, setContactsOpen] = useState(false);
  const [airOpen, setAirOpen] = useState(false);
  const [filter, setFilter] = useState<'ships' | 'aircraft'>('ships');
  const [carrier, setCarrier] = useState('all');
  const [speedKn, setSpeedKn] = useState(20);
  const [formation, setFormation] = useState<'column' | 'screen'>('column');
  const [searchRadius, setSearchRadius] = useState(4000);
  const [searchAltitude, setSearchAltitude] = useState<SearchAltitude>('medium');
  const [searchPolicy, setSearchPolicy] = useState<SearchPolicy>('report');
  const [armed, setArmed] = useState<ArmedOrder>();
  const [feedback, setFeedback] = useState('');
  const [groupSlot, setGroupSlot] = useState(1);
  const [groupName, setGroupName] = useState('Task group');
  const [groupsOpen, setGroupsOpen] = useState(false);
  const [contactId, setContactId] = useState<string>();
  const map = useRef<SVGSVGElement>(null);
  const nav = useRef(new AirMapNavigation());
  const drag = useRef<{ x: number; y: number; lastX: number; lastY: number; pan: boolean; additive: boolean; moved: boolean } | undefined>(undefined);
  const [box, setBox] = useState<{ x: number; y: number; width: number; height: number }>();
  const ignoreClick = useRef(false);
  useMapProjection(map, game, mapOpen);
  const wings = game.simulation.actors.filter(a => a.team === 'friendly' && a.airWing).map(a => ({ owner: a, wing: airWingTelemetry(a, game.simulation.actors)! }));
  const flights = wings.flatMap(({ owner, wing }) => wing.groups.map(f => ({ ...f, ownerId: owner.motion.id, carrierName: nameFor(owner.motion.id) })));
  const selectedFlights = flights.filter(f => game.selectedFlightIds.includes(f.id));
  const subject = !mapOpen ? ships.find(s => s.id === data.spectatedShipId || s.id === data.controlledShipId) : selected.length === 1 ? selected[0] : undefined;
  const recipients = !mapOpen && subject ? [subject] : selected;
  const orders = game.simulation.fleetOrders ?? {};
  const actionable = combat.result === 'active' && game.simulation.phase === 'running';
  const selectedContact = enemies.find(c => c.id === contactId);
  const selectedReport = observations.find(c => c.id === contactId);
  const current = useRef({ data, armed, filter, selected, selectedFlights, actionable });
  current.current = { data, armed, filter, selected, selectedFlights, actionable };
  const selectShips = (shipIds: string[]) => { game.selectFleetShips(shipIds); game.selectFlights([]); setContactId(undefined); setArmed(undefined); };
  const selectShip = (id: string, additive: boolean) => selectShips(additive ? ids.includes(id) ? ids.filter(s => s !== id) : [...ids, id] : [id]);
  const selectAir = (id: string, additive = false) => { game.selectFlight(id, additive); game.selectFleetShips([]); setContactId(undefined); setArmed(undefined); setAirOpen(true); };
  const issueAir = (target: SquadronTarget) => {
    if (current.current.armed === 'search') { setFeedback('Choose water for the center of the search area.'); return; }
    const action = typeof current.current.armed === 'object' ? current.current.armed.kind : undefined;
    const order = squadronTargetOrder(action, target);
    if (!order) { setFeedback(`Choose ${typeof armed === 'object' ? armed.target : 'a compatible target'}.`); return; }
    const command = SQUADRON_ACTIONS.find(a => a.kind === order.kind);
    const selected = current.current.selectedFlights;
    const compatible = selected.filter(f => !command || actionAvailable(command, f.role));
    const ready = compatible.filter(f => !f.deck || f.active || f.deck.canLaunch);
    const queued = ready.filter(f => game.commandSquadron(f.id, order));
    setFeedback([`${queued.length} air group orders queued`,
      compatible.length < selected.length && `${selected.length - compatible.length} incompatible groups skipped`,
      ready.length < compatible.length && `${compatible.length - ready.length} groups not ready to launch`,
      queued.length < ready.length && `${ready.length - queued.length} groups unavailable`,
    ].filter(Boolean).join(' · '));
    setArmed(undefined);
  };
  const escort = (leader: string) => {
    const followers = recipients.filter(s => s.id !== leader);
    followers.forEach((s, i) => game.simulation.escortShip?.(s.id, leader, formation === 'column' ? [0, 500 + i * 400] : [i % 2 ? 650 : -650, 450 + Math.floor(i / 2) * 600], 160));
    setFeedback(followers.length ? `${followers.length} escort orders queued · ${formation}` : 'Choose a leader outside the selection.');
    setArmed(undefined);
  };
  const move = (point: [number, number], append: boolean) => {
    const lead = recipients[0];
    if (!lead) { setFeedback('Select ships before giving a destination.'); return; }
    game.simulation.routeShip?.(lead.id, [point], speedKn / KNOTS_PER_MPS, false, append);
    if (recipients.length > 1) escort(lead.id);
    setArmed(undefined); setFeedback(`${append ? 'Waypoint appended' : 'Route queued'} · ${speedKn} kn${recipients.length > 1 ? ` · ${formation}` : ''}`);
  };
  const targetShip = (ship: Pick<Contact, 'id' | 'team'>, right: boolean, additive: boolean) => {
    if (armed === 'search') { setFeedback('Choose water for the center of the search area.'); return; }
    const report = observations.find(c => c.id === ship.id);
    if (!current.current.selectedFlights.length && report?.status === 'stale' && (right || armed)) { setFeedback('Report is stale. Search its last reported area before attacking.'); return; }
    if (current.current.selectedFlights.length && (right || typeof armed === 'object')) { issueAir({ kind: 'ship', id: ship.id, team: ship.team }); return; }
    if (ship.team === 'friendly') {
      if (right || armed === 'escort') escort(ship.id);
      else selectShip(ship.id, additive);
    } else if (right || armed === 'focus') {
      recipients.forEach(s => game.simulation.focusShip?.(s.id, ship.id));
      setArmed(undefined); setFeedback(`${recipients.length} focus orders queued · Movement unchanged`);
    } else { selectShips([]); setContactId(ship.id); game.selectTarget(ship.id); }
  };
  const selectReport = (report: ContactTrack, right = false) => {
    if (armed === 'search') { setFeedback('Choose water for the center of the search area.'); return; }
    if (report.kind === 'surface') { targetShip({ id: report.id, team: 'enemy' }, right, false); return; }
    if (current.current.selectedFlights.length && (right || typeof armed === 'object')) { issueAir({ kind: 'squadron', id: report.id, team: 'enemy' }); return; }
    if (right || armed) { setFeedback('Select a fighter group and Intercept, then choose an aircraft contact.'); return; }
    selectShips([]); setContactId(report.id);
  };
  const issueSearch = (point: [number, number]) => {
    if (boundary && Math.hypot(...point) + searchRadius + 1500 > boundary.radiusM) {
      setFeedback('The search area needs 1.5 km of turning room inside the battle boundary.'); return;
    }
    const compatible = selectedFlights.filter(f => searchPolicy !== 'strike' || f.role !== 'fighter');
    const ready = compatible.filter(f => !f.deck || f.active || f.deck.canLaunch);
    const queued = ready.filter(f => game.commandSquadron(f.id, { kind: 'search-area', center: point, radiusM: searchRadius, altitude: searchAltitude, policy: searchPolicy }));
    setFeedback([`${queued.length} search orders queued`, compatible.length < selectedFlights.length && `${selectedFlights.length - compatible.length} fighter groups skipped`, ready.length < compatible.length && `${compatible.length - ready.length} groups not ready`, queued.length < ready.length && `${ready.length - queued.length} groups unavailable`].filter(Boolean).join(' · '));
    setArmed(undefined);
  };
  const water = (event: { clientX: number; clientY: number; shiftKey: boolean }, right: boolean) => {
    const rect = map.current?.getBoundingClientRect();
    if (!rect || !actionable) return;
    const point = game.airMapWater(event.clientX - rect.left, event.clientY - rect.top);
    if (!point) return;
    if (selectedFlights.length && armed === 'search') issueSearch(point);
    else if (selectedFlights.length && (right || typeof armed === 'object')) issueAir({ kind: 'water', point: [point[0], 0, point[1]] });
    else if (right || armed === 'move') move(point, event.shiftKey);
    else if (!armed) { selectShips([]); game.selectFlights([]); }
  };
  const saveGroup = (slot = groupSlot) => {
    if (!game.selectedShipIds.length) return;
    game.controlGroups.set(slot, { name: groupName.trim() || `Task group ${slot}`, shipIds: [...game.selectedShipIds] });
    setFeedback(`Task group ${slot} saved · ${game.selectedShipIds.length} ships`);
  };
  const handlers = useRef({ saveGroup }); handlers.current = { saveGroup };
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (document.querySelector('dialog[open]') || event.altKey) return;
      const element = event.target as HTMLElement;
      if (element?.matches('input, textarea, select') || element?.closest('[role=combobox], [role=listbox]') || element?.isContentEditable || (element?.closest('button, [role=button]') && event.code === 'Space')) return;
      const digit = /^Digit[1-9]$/.test(event.code) ? Number(event.code.at(-1)) : 0;
      const mapActive = !!current.current.data.airOperationsOpen;
      const toggle = bindings.airOperations.includes(event.code);
      const pan = mapActive && !event.ctrlKey && !event.metaKey && nav.current.key(event.code, true);
      const handled = toggle || event.code === 'Space' || (mapActive && (digit || pan || event.code === 'Escape'));
      if (!handled) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (event.repeat) return;
      if (toggle) { if (mapActive) game.followFleetShip(game.selectedShipIds[0] ?? game.simulation.ship.id); else game.enterFleetCommand(); }
      else if (event.code === 'Space') game.toggleTacticalPause();
      else if (digit && (event.ctrlKey || event.metaKey)) handlers.current.saveGroup(digit);
      else if (digit) { const group = game.controlGroups.get(digit); if (group) { game.selectFleetShips(group.shipIds); game.selectFlights([]); } }
      else if (event.code === 'Escape') { if (current.current.armed) setArmed(undefined); else game.setPaused(true); }
    };
    const keyup = (event: KeyboardEvent) => { nav.current.key(event.code, false); };
    const clear = () => { nav.current.clear(); drag.current = undefined; setBox(undefined); };
    window.addEventListener('keydown', keydown, true); window.addEventListener('keyup', keyup); window.addEventListener('blur', clear);
    return () => { window.removeEventListener('keydown', keydown, true); window.removeEventListener('keyup', keyup); window.removeEventListener('blur', clear); nav.current.clear(); };
  }, [game, bindings]);
  useEffect(() => {
    if (!mapOpen) { nav.current.clear(); setBox(undefined); setArmed(undefined); return; }
    let previous = performance.now(), frame = 0;
    const animate = (now: number) => {
      const dt = (now - previous) / 1000; previous = now;
      const rect = map.current?.getBoundingClientRect();
      if (rect && !drag.current && !document.querySelector('dialog[open]')) { const [dx, dy] = nav.current.step(dt, rect.width, rect.height); if (dx || dy) game.panAirMap(dx, dy); }
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate); return () => cancelAnimationFrame(frame);
  }, [mapOpen, game]);
  const startDrag = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button === 2 || (event.target as Element).closest('[data-ship-marker]')) return;
    drag.current = { x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY, pan: event.button === 1 || event.altKey, additive: event.shiftKey || event.ctrlKey || event.metaKey, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const dragMap = (event: ReactPointerEvent<SVGSVGElement>) => {
    const d = drag.current; if (!d) return;
    d.moved ||= Math.hypot(event.clientX - d.x, event.clientY - d.y) > 5;
    if (d.pan) game.panAirMap(event.clientX - d.lastX, event.clientY - d.lastY);
    else if (d.moved && !armed) { const rect = event.currentTarget.getBoundingClientRect(); setBox({ x: Math.min(d.x, event.clientX) - rect.left, y: Math.min(d.y, event.clientY) - rect.top, width: Math.abs(event.clientX - d.x), height: Math.abs(event.clientY - d.y) }); }
    d.lastX = event.clientX; d.lastY = event.clientY;
  };
  const endDrag = (event: ReactPointerEvent<SVGSVGElement>) => {
    const d = drag.current; drag.current = undefined; setBox(undefined);
    if (!d?.moved) return;
    ignoreClick.current = event.button === 0;
    if (d.pan || armed) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const inside = (x: number, y: number) => x + rect.left >= Math.min(d.x, event.clientX) && x + rect.left <= Math.max(d.x, event.clientX) && y + rect.top >= Math.min(d.y, event.clientY) && y + rect.top <= Math.max(d.y, event.clientY);
    const scaleX = rect.width / event.currentTarget.clientWidth, scaleY = rect.height / event.currentTarget.clientHeight;
    if (filter === 'ships') selectShips([...(d.additive ? game.selectedShipIds : []), ...ships.filter(s => { const p = game.projectAirMap(s.x, s.z); return !s.physicalLost && p && inside(p[0] * scaleX, p[1] * scaleY); }).map(s => s.id)]);
    else { game.selectFlights([...(d.additive ? game.selectedFlightIds : []), ...flights.filter(f => { const p = game.projectAirMap(f.position[0], f.position[2], f.position[1]); return f.airborne > 0 && p && inside(p[0] * scaleX, p[1] * scaleY); }).map(f => f.id)]); game.selectFleetShips([]); }
  };
  const arm = (order: ArmedOrder) => { if (!mapOpen) game.enterFleetCommand(); setArmed(order); setFeedback(''); };
  const receipts = game.simulation.orderReceipts?.filter(r => r.command !== 'damage-control').slice(-3) ?? [];
  return <div className={`fleet-command ${mapOpen ? 'fleet-command-map' : 'fleet-command-follow'}`}>
    {mapOpen && <>
      <svg ref={map} className="fleet-command-chart" tabIndex={0} aria-label="Fleet command chart" data-armed={armed ? true : undefined}
        onKeyDown={e => { if (armed === 'search' && e.key === 'Enter') { e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); water({ clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, shiftKey: false }, false); } }}
        onPointerDown={startDrag} onPointerMove={dragMap} onPointerUp={endDrag} onPointerCancel={() => { drag.current = undefined; setBox(undefined); }}
        onClick={e => { if (ignoreClick.current) { ignoreClick.current = false; return; } water(e, false); }}
        onContextMenu={e => { e.preventDefault(); water(e, true); }} onWheel={e => { const r = e.currentTarget.getBoundingClientRect(); game.zoomAirMap(e.deltaY, e.clientX - r.left, e.clientY - r.top); }}>
        {armed === 'search' && <svg x="50%" y="50%" width="1" height="1" overflow="visible" className="fleet-command-search-center" aria-hidden="true"><path d="M-12 0H12M0-12V12"/></svg>}
        {boundary && <path className="fleet-command-boundary" data-map-path={JSON.stringify(circlePoints(0, 0, boundary.radiusM))} data-closed="true"/>}
        {boundary && <path className="fleet-command-boundary-warning" data-map-path={JSON.stringify(circlePoints(0, 0, boundary.radiusM - boundary.warningMarginM))} data-closed="true"/>}
        {observations.filter(c => c.id === contactId || c.status === 'lost' || c.status === 'stale').map(c => <path key={`area-${c.id}`} className={`fleet-command-uncertainty ${c.status}`} data-map-path={JSON.stringify(circlePoints(c.estimatedPosition[0], c.estimatedPosition[2], c.uncertaintyM))} data-closed="true"/>)}
        {selectedFlights.filter(f => f.route.length > 1).map(f => <path key={`air-route-${f.id}`} className="fleet-command-route" data-map-path={JSON.stringify(f.route)}/>)}
        {selectedFlights.filter(f => f.order.kind === 'search-area').map(f => f.order.kind === 'search-area' && <path key={`search-${f.id}`} className="fleet-command-route" data-map-path={JSON.stringify(circlePoints(f.order.center[0], f.order.center[1], f.order.radiusM))} data-closed="true"/>)}
        {selectedFlights.flatMap(f => f.search?.trail.slice(1).flatMap((sample, i) => { const age = (game.simulation.tick - sample.tick) / 60; return age <= 90 ? [<path key={`trail-${f.id}-${sample.tick}`} className="fleet-command-search-trail" opacity={Math.max(.15, 1 - age / 90)} data-map-path={JSON.stringify([f.search!.trail[i].position, sample.position])}/>] : []; }) ?? [])}
        {selected.map(s => <path key={s.id} className="fleet-command-route" data-map-path={JSON.stringify(routePoints(s, orders[s.id], ships))}/>)}
        {combat.contacts.filter(c => !c.physicalLost).map(s => <g key={s.id} data-map-position={JSON.stringify([s.x, 0, s.z])} data-ship-marker={s.id} className={`fleet-command-marker ${s.team} ${ids.includes(s.id) || s.id === contactId ? 'selected' : ''}`}
          role="button" tabIndex={0} aria-label={`${s.name} · ${s.team}`} onPointerDown={e => e.stopPropagation()}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); targetShip(s, false, e.shiftKey); } }}
          onClick={e => { e.stopPropagation(); targetShip(s, false, e.shiftKey || e.ctrlKey || e.metaKey); }}
          onContextMenu={e => { e.preventDefault(); e.stopPropagation(); targetShip(s, true, false); }}>
          <circle r="18" className="fleet-command-hitbox"/>
          <path d="M0 -12 5 -3 4 10 -4 10 -5 -3Z" transform={`rotate(${s.heading * 180 / Math.PI})`}/>
          <text x="12" y="1">{s.name}</text><text className="fleet-command-marker-order" x="12" y="15">{s.team === 'friendly' ? standingOrder(orders[s.id], nameFor) : ''}</text>
        </g>)}
        {observations.map(c => <g key={c.id} data-map-position={JSON.stringify([c.estimatedPosition[0], 0, c.estimatedPosition[2]])} data-contact-marker={c.id} className={`fleet-command-marker ${c.affiliation === 'hostile' ? 'enemy' : 'unidentified'} report ${c.status} ${contactId === c.id ? 'selected' : ''}`}
          role="button" tabIndex={0} aria-label={`${reportName(c)} · ${c.status} · observed ${reportAge(c, game.simulation.tick)} · uncertainty ${reportUncertainty(c)}`} onPointerDown={e => e.stopPropagation()}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); selectReport(c); } }}
          onClick={e => { e.stopPropagation(); selectReport(c); }} onContextMenu={e => { e.preventDefault(); e.stopPropagation(); selectReport(c, true); }}>
          <circle r="18" className="fleet-command-hitbox"/>
          <path d={c.kind === 'aircraft' ? 'M0 -12 4 -2 11 4 11 7 3 5 3 10 -3 10 -3 5 -11 7 -11 4 -4 -2Z' : 'M0 -12 9 0 0 12 -9 0Z'}/>
          <text x="16" y="1">{reportName(c)}</text><text className="fleet-command-marker-order" x="16" y="15">{c.affiliation === 'unknown' ? 'Affiliation unknown' : c.status} · {reportAge(c, game.simulation.tick)}</text>
        </g>)}
      </svg>
      {boundary && <p className="fleet-command-boundary-label">Battle area · {(boundary.radiusM / 1000).toFixed(0)} km radius · Captains turn back at the edge</p>}
      {box && <div className="fleet-command-box" style={{ left: box.x, top: box.y, width: box.width, height: box.height }}/>}
      <SquadronLabels data={data} game={game} onSelect={(id, additive) => { if (filter === 'aircraft') selectAir(id, additive); }} onTarget={(id, team) => { if (armed === 'search') { setFeedback('Choose water for the center of the search area.'); return true; } if (typeof armed !== 'object') return false; issueAir({ kind: 'squadron', id, team }); return true; }} onOrder={(id, team) => issueAir({ kind: 'squadron', id, team })}/>
      <section className="fleet-command-roster" aria-label="Fleet roster">
        <header><h2>Fleet <span>{ships.filter(s => !s.physicalLost).length}/{ships.length}</span></h2><button onClick={() => setRosterOpen(!rosterOpen)} aria-expanded={rosterOpen}>{rosterOpen ? 'Hide' : 'Show'}</button></header>
        {rosterOpen && <div className="fleet-command-roster-list">{ships.map(s => <button key={s.id} disabled={s.physicalLost} aria-pressed={ids.includes(s.id)} onClick={e => selectShip(s.id, e.shiftKey || e.ctrlKey || e.metaKey)}><span><strong>{s.name}</strong><b>{s.physicalLost ? 'Lost' : `${Math.round(s.integrity * 100)}%`}</b></span><small>{s.physicalLost ? s.status : standingOrder(orders[s.id], nameFor)}</small></button>)}</div>}
        <nav aria-label="Task groups">{[...game.controlGroups].map(([slot, group]) => <button key={slot} title={group.shipIds.join(', ')} onClick={() => selectShips(group.shipIds)}><kbd>{slot}</kbd>{group.name}</button>)}<button onClick={() => setGroupsOpen(!groupsOpen)} aria-expanded={groupsOpen}>Groups</button></nav>
        {groupsOpen && <form onSubmit={e => { e.preventDefault(); saveGroup(); }}><label>Group name<input value={groupName} maxLength={32} onChange={e => setGroupName(e.target.value)}/></label><label>Shortcut<Select value={groupSlot} onValueChange={value => setGroupSlot(Number(value))}>{Array.from({ length: 9 }, (_, i) => <SelectOption key={i} value={i + 1}>{i + 1}</SelectOption>)}</Select></label><button disabled={!selected.length} type="submit">Save selection</button><small>Ctrl + number saves; number recalls. Orders stay with each ship.</small></form>}
      </section>
    </>}
    <header className="fleet-command-top">
      <div><strong>{mapOpen ? 'Fleet command' : data.controlledShipId ? 'At the helm' : 'Following ship'}</strong><time>{duration(game.simulation.tick / 60)}</time></div>
      <nav aria-label="Fleet views">
        {mapOpen && <><button aria-pressed={filter === 'ships'} onClick={() => setFilter('ships')}>Ships</button>{wings.length > 0 && <button aria-pressed={filter === 'aircraft'} onClick={() => { setFilter('aircraft'); setAirOpen(true); }}>Aircraft</button>}<button onClick={() => game.fitAirMap()} title="Fit reported fleet">Fit chart</button></>}
        {mapOpen && <button aria-expanded={contactsOpen} onClick={() => setContactsOpen(!contactsOpen)}>Contacts {enemies.length}</button>}
        {mapOpen && wings.length > 0 && <button aria-expanded={airOpen} onClick={() => setAirOpen(!airOpen)}>Air</button>}
        {!game.simulation.networked && <button onClick={() => game.toggleTacticalPause()} aria-pressed={data.tacticalPaused}><Icon name={data.tacticalPaused ? 'play' : 'pause'} size={14}/>{data.tacticalPaused ? 'Resume' : 'Pause'} <kbd>Space</kbd></button>}
        <button onClick={() => game.setPaused(true)} aria-label="Battle menu"><Icon name="settings" size={16}/></button>
      </nav>
    </header>
    {mapOpen && contactsOpen && <section className="fleet-command-contacts" aria-label="Contacts"><header><h2>Contacts</h2><button onClick={() => setContactsOpen(false)}>Hide</button></header>{enemies.length ? enemies.map(c => { const report = observations.find(r => r.id === c.id); return <button key={c.id} aria-pressed={contactId === c.id} onClick={() => report ? selectReport(report) : targetShip({ id: c.id, team: 'enemy' }, false, false)}><strong>{c.name}</strong><small>{(c.x / 1000).toFixed(1)} km E · {(-c.z / 1000).toFixed(1)} km N</small>{report && <small>{report.status} · {reportAge(report, game.simulation.tick)} · ±{reportUncertainty(report)}</small>}</button>; }) : <p>No contacts reported. Send ships or aircraft forward to search.</p>}</section>}
    {data.tacticalPaused && <p className="fleet-command-paused" role="status">Tactical pause · Both fleets stopped · {game.simulation.queuedOrderCount ?? 0} orders queued for resume</p>}
    <section className={`fleet-command-card ${airOpen && mapOpen ? 'raised' : ''}`} aria-label="Command card">
      <div className="fleet-command-identity">
        <h2>{mapOpen && selectedFlights.length ? selectedFlights.length === 1 ? selectedFlights[0].name : `${selectedFlights.length} air groups` : subject?.name ?? (selected.length ? `${selected.length} ships` : (mapOpen ? selectedContact?.name : undefined) ?? 'Fleet command')}</h2>
        {subject && <img className="fleet-command-thumbnail" src={assetUrl(`models/${subject.shipId}-thumbnail.png`)} width="160" height="48" alt=""/>}
        {subject && <><p>{Math.round(subject.integrity * 100)}% hull · {data.controlledShipId === subject.id ? 'Manual helm' : 'Captain in command'}</p><div><button onClick={() => game.followFleetShip(subject.id)}><Icon name="camera" size={14}/>Follow</button>{data.controlledShipId === subject.id ? <button onClick={() => game.followFleetShip(subject.id)}>Give back helm</button> : <button disabled={!actionable || subject.physicalLost} onClick={() => game.takeFleetHelm(subject.id)}>Take helm</button>}</div></>}
        {!mapOpen && <button className="fleet-command-return" onClick={() => game.enterFleetCommand()}><Icon name="compass" size={16}/>Fleet command <kbd>M</kbd></button>}
        {mapOpen && !subject && selected.length === 0 && selectedFlights.length === 0 && !selectedContact && <p>Select a ship on the chart or in the roster. Captains execute your orders.</p>}
      </div>
      <div className="fleet-command-orders">
        {mapOpen && selectedFlights.length > 0 ? <>
          <div className="fleet-command-buttons">{SQUADRON_ACTIONS.filter(a => selectedFlights.some(f => actionAvailable(a, f.role))).map(a => <button key={a.kind}
            disabled={!actionable || !selectedFlights.some(f => actionAvailable(a, f.role) && (!f.deck || f.active || f.deck.canLaunch))}
            aria-pressed={typeof armed === 'object' && armed.kind === a.kind} onClick={() => arm(a)}>{a.label}</button>)}
            <button disabled={!actionable || !selectedFlights.some(f => f.active)} onClick={() => selectedFlights.filter(f => f.active).forEach(f => game.commandSquadron(f.id, { kind: 'return' }))}>Return to carrier</button>
          </div>
          {boundary && <div className="fleet-command-search">
            <div className="fleet-command-buttons">
              <label>Search radius<Select value={searchRadius} onValueChange={v => setSearchRadius(Number(v))}>{[2000, 4000, 6000].map(v => <SelectOption key={v} value={v}>{v / 1000} km</SelectOption>)}</Select></label>
              <label>Altitude<Select value={searchAltitude} onValueChange={v => setSearchAltitude(v as SearchAltitude)}><SelectOption value="low">Low · 200 m</SelectOption><SelectOption value="medium">Medium · 850 m</SelectOption><SelectOption value="high">High · 1,500 m</SelectOption></Select></label>
              <label>On contact<Select value={searchPolicy} onValueChange={v => setSearchPolicy(v as SearchPolicy)}><SelectOption value="report">Report only</SelectOption><SelectOption value="shadow">Shadow and report</SelectOption><SelectOption value="strike">Search and strike</SelectOption></Select></label>
              <button disabled={!actionable || !selectedFlights.some(f => (searchPolicy !== 'strike' || f.role !== 'fighter') && (!f.deck || f.active || f.deck.canLaunch))} aria-pressed={armed === 'search'} onClick={() => { arm('search'); map.current?.focus(); }}>Search area</button>
            </div>
            <p>{searchPolicy === 'strike' ? 'Armed bombers attack locally sighted ships within this area.' : searchPolicy === 'shadow' ? 'Follow a locally sighted ship for up to 2 minutes; withdraw from aircraft threats.' : 'Fly one sweep, report contacts and return with weapons retained.'} Higher searches cover more water and are easier to detect. The fading track shows the last 90 seconds flown; it does not mark water clear.</p>
          </div>}
          <AirGroupService flights={selectedFlights} enabled={actionable} command={(groups, action) => {
            const accepted = groups.filter(f => game.commandDeck(f.id, action));
            setArmed(undefined); setFeedback(`${accepted.length} group service orders queued`);
          }}/>
          <p>{selectedFlights.map(f => `${f.carrierName} · ${f.surviving}/${f.total} · ${f.active ? mission(f) : f.activity}`).join(' / ')}</p>
        </>
          : recipients.length > 0 ? <><div className="fleet-command-buttons"><button disabled={!actionable} aria-pressed={armed === 'move'} onClick={() => arm('move')}>Move</button><button disabled={!actionable} onClick={() => { recipients.forEach(s => game.simulation.holdShipArea?.(s.id, [s.x, s.z], 500)); setFeedback('Hold orders queued · 500 m station area'); }}>Hold area</button><button disabled={!actionable} aria-pressed={armed === 'escort'} onClick={() => arm('escort')}>Escort</button><button disabled={!actionable} aria-pressed={armed === 'focus'} onClick={() => arm('focus')}>Focus fire</button>
            <label>Speed<Select value={speedKn} onValueChange={value => setSpeedKn(Number(value))}>{[8, 12, 16, 20, 24, 28, 30].map(v => <SelectOption key={v} value={v}>{v} kn</SelectOption>)}</Select></label><label>Formation<Select value={formation} onValueChange={value => setFormation(value as typeof formation)}><SelectOption value="column">Column</SelectOption><SelectOption value="screen">Escort screen</SelectOption></Select></label></div>
            <div className="fleet-command-weapons">{(['guns', 'aa', 'torpedoes'] as const).map(kind => { const free = recipients.every(s => orders[s.id]?.weapons[kind]); return <button key={kind} disabled={!actionable} aria-pressed={free} onClick={() => recipients.forEach(s => game.simulation.setShipWeapons?.(s.id, { ...(orders[s.id]?.weapons ?? { guns: true, aa: true, torpedoes: false }), [kind]: !free }))}>{kind === 'aa' ? 'AA' : kind === 'guns' ? 'Guns' : 'Torpedoes'}: {free ? 'Free' : 'Held'}</button>; })}</div>
            <div className="fleet-command-standing">{recipients.map(s => <p key={s.id}>{recipients.length > 1 && <strong>{s.name} · </strong>}{standingOrder(orders[s.id], nameFor)}</p>)}</div></>
          : mapOpen && selectedContact ? <div className="fleet-command-report"><p>Reported position {(selectedContact.x / 1000).toFixed(1)} km E, {(-selectedContact.z / 1000).toFixed(1)} km N.</p>{selectedReport && <><p>{selectedReport.status} · Observed {reportAge(selectedReport, game.simulation.tick)} · Uncertainty ±{reportUncertainty(selectedReport)}</p><p>Reported by {selectedReport.sources.map(source => ships.find(s => s.id === source.observerId)?.name ?? 'Friendly aircraft').filter((name, i, names) => names.indexOf(name) === i).join(', ') || 'Fleet lookouts'}.</p></>}<p>{selectedReport?.status === 'stale' ? 'Search the reported area to reacquire this contact.' : selectedReport?.kind === 'aircraft' ? 'Aircraft movements are estimates from your observers.' : 'Select friendly ships to assign focus fire.'}</p></div>
          : <p>Right-click water to move, a friendly ship to escort, or an enemy to focus fire. Shift appends waypoints. Middle-drag pans; scroll zooms.</p>}
        {armed && <p className="fleet-command-armed">{typeof armed === 'object' ? `Choose ${armed.target}` : armed === 'search' ? 'Choose the area center on water, or pan with arrow keys and press Enter at chart center' : armed === 'move' ? 'Choose water · Shift appends a waypoint' : armed === 'escort' ? 'Choose a friendly leader' : 'Choose an enemy contact'}<button onClick={() => setArmed(undefined)}>Cancel <kbd>Esc</kbd></button></p>}
        <div className="fleet-command-feedback" role="status">{feedback && <p>{feedback}</p>}{receipts.map(r => <p key={r.sequence} data-state={r.state}>{ships.find(s => s.id === r.shipId)?.name ?? r.shipId} · {r.command.replaceAll('-', ' ')} · {r.state}{r.message ? `: ${r.message}` : ''}</p>)}</div>
      </div>
    </section>
    {mapOpen && airOpen && <section className="fleet-command-air" aria-label="Air operations across all carriers"><header><h2>Air operations</h2><label>Carrier<Select value={carrier} onValueChange={setCarrier}><SelectOption value="all">All carriers</SelectOption>{wings.map(({ owner }) => <SelectOption key={owner.motion.id} value={owner.motion.id}>{nameFor(owner.motion.id)}</SelectOption>)}</Select></label><button onClick={() => setAirOpen(false)}>Hide</button></header><div className="fleet-command-air-body"><div className="fleet-command-flights" aria-label="Air groups">{flights.filter(f => carrier === 'all' || f.ownerId === carrier).map(f => <button key={f.id} disabled={!f.surviving} aria-pressed={game.selectedFlightIds.includes(f.id)} onClick={e => selectAir(f.id, e.ctrlKey || e.metaKey || e.shiftKey)}><span><Icon name={roleIcon(f.role)} size={20}/><strong>{f.name}</strong><b>{f.surviving}/{f.total}</b></span><small>{f.carrierName} · {roleLabel(f.role)}</small><small>{f.activity} · {f.armed} armed</small>{f.notice && <small>{f.notice}</small>}</button>)}</div><div className="fleet-command-decks">{wings.filter(({ owner }) => carrier === 'all' || owner.motion.id === carrier).map(({ owner, wing }) =>
      <CarrierDeck key={owner.motion.id} name={nameFor(owner.motion.id)} wing={wing} enabled={actionable} setPolicy={policy => {
        if (game.setDeckPolicy(owner.motion.id, policy)) setFeedback(`${nameFor(owner.motion.id)} · Deck policy order queued`);
      }} prioritize={id => {
        if (game.prioritizeDeckTask(owner.motion.id, id)) setFeedback(`${nameFor(owner.motion.id)} · Next deck task requested`);
      }} cancel={id => {
        if (game.cancelDeckTask(owner.motion.id, id)) setFeedback(`${nameFor(owner.motion.id)} · Deck cancellation queued`);
      }}/>
    )}</div></div></section>}
  </div>;
}
