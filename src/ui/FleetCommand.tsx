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
import { airborne } from '../simulation/aircraft';
import { AirGroupService } from './CarrierDeck';
import { KNOTS_PER_MPS } from '../simulation/ship';
import { SquadronLabels, useMapProjection } from './AirOperations';
import { AirMapNavigation } from './airMapNavigation';
import { actionAvailable, SQUADRON_ACTIONS, squadronTargetOrder, type SquadronAction, type SquadronTarget } from './airCommands';
import { duration, mission } from './airFormat';
import { Icon } from './Icons';
import { SimulationSpeed } from './SimulationSpeed';
import { ReconnaissanceCoverage, ReconnaissanceLegend } from './Reconnaissance';
import { reportState, reportPosition, conditionReport, observationAge } from './reconReports';
import { advancePendingRoute, type PendingRoute } from './pendingFleetRoute';
import { shipPreset } from '../ships/presets';
import { fleetFormations, type Formation } from './fleetFormations';
import { airClusters, battleComparison, reportedAircraftType } from './fleetStats';
import { PLANE_GLYPHS } from './planeGlyphs';
import { SHIP_GLYPHS, shipClassFromReport, shipClassOf } from './shipGlyphs';
import { EnemyFleet, bearingLabel, rangeLabel } from './EnemyFleet';
import { OwnFleetCard, type OwnFleetAircraft, type OwnFleetShip } from './OwnFleet';
import { AirRail } from './AirRail';
import { FleetRoster, type RosterShip } from './FleetRoster';
import { OrderWheel, type WheelItem } from './OrderWheel';
import './FleetCommand.css';

type Contact = CombatTelemetry['contacts'][number];
type ArmedOrder = 'search' | 'move' | 'escort' | 'focus' | SquadronAction;
const SPEEDS = [8, 12, 16, 20, 24, 28, 30];
const LOITER_RADIUS_M = 700;
/** Orders aimed at water preview a line from the unit to the cursor while armed. */
const previewArmed = (armed?: ArmedOrder) => armed === 'move' || armed === 'search' || (typeof armed === 'object' && armed.target === 'water');
const circlePoints = (x: number, z: number, radius: number): Vec3[] => Array.from({ length: 65 }, (_, i) => [x + Math.sin(i / 64 * Math.PI * 2) * radius, 0, z + Math.cos(i / 64 * Math.PI * 2) * radius]);
const reportName = (track: ContactTrack) => track.identifiedPresetId ? shipPreset(track.identifiedPresetId).name : track.classification ?? (track.kind === 'aircraft' ? 'Aircraft contact' : 'Surface contact');
const reportAge = (track: ContactTrack, tick: number) => observationAge(track.lastObservedTick, tick);
const reportUncertainty = (track: ContactTrack) => track.uncertaintyM >= 1000 ? `${(track.uncertaintyM / 1000).toFixed(1)} km` : `${Math.round(track.uncertaintyM)} m`;
export function standingOrder(order?: FleetOrderState, nameFor: (id: string) => string = id => id): string {
  if (!order) return 'Awaiting order report';
  const task = order.movement;
  const status = order.navigation?.status;
  const maneuver = status === 'evading-aircraft' ? 'Avoiding observed aircraft' : status === 'evading-torpedo' ? 'Avoiding spotted torpedoes' : status === 'straggling' ? 'Damaged stragglers · Decision needed' : status === 'slowing-for-stragglers' ? 'Slowing for stragglers' : undefined;
  if (status === 'leader-lost') return 'Leader lost · Holding locally';
  if (status === 'blocked') return 'Route blocked · Reassign destination';
  if (status === 'immobile') return 'Unable to maneuver · Check damage';
  const label = task.type === 'route' ? `${task.looped ? 'Patrol' : 'Route'} · ${(task.speedMps * KNOTS_PER_MPS).toFixed(0)} kn · Waypoint ${(order.navigation?.waypoint ?? 0) + 1}/${task.waypoints.length}`
    : task.type === 'escort' ? `Escort ${nameFor(task.leaderId)} · ${status?.replaceAll('-', ' ') ?? 'Assigned'}`
    : task.type === 'hold-area' ? `Hold area · ${(task.radiusM / 1000).toFixed(1)} km`
    : task.type === 'move' ? 'Move to waypoint' : task.type === 'hold' ? 'Stop' : 'Autonomous movement';
  const report = maneuver ? `${maneuver} · ${label}` : label;
  return order.manual ? `${report} · Saved while at helm` : report;
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
/** Axis-aligned frame around a formation, padded so the bracket clears the markers. */
function bracketPoints(members: { x: number; z: number }[], padM = 420): Vec3[] {
  const xs = members.map(m => m.x), zs = members.map(m => m.z);
  const minX = Math.min(...xs) - padM, maxX = Math.max(...xs) + padM, minZ = Math.min(...zs) - padM, maxZ = Math.max(...zs) + padM;
  return [[minX, 0, minZ], [maxX, 0, minZ], [maxX, 0, maxZ], [minX, 0, maxZ]];
}
const WEAPONS = ['guns', 'aa', 'torpedoes'] as const;
const weaponLabel = { guns: 'Guns', aa: 'AA', torpedoes: 'Torpedoes' } as const;

/** Orders live at the cursor: a wheel beside the selected ship, a bar beside
 * selected air groups, a popover on a report. Chrome stays at the edges. Every
 * actual order still travels through Rust. */
export function FleetCommand({ data, game, bindings }: { data: Telemetry; game: Game; bindings: Keybindings }) {
  const combat = data.combat!;
  const mapOpen = !!data.airOperationsOpen;
  const tick = game.simulation.tick;
  const actors = game.simulation.actors;
  const actorOf = (id: string) => actors.find(a => a.motion.id === id);
  const owned = combat.contacts.filter(c => c.team === 'friendly');
  const ships = owned.map(s => {
    const same = owned.filter(other => other.name === s.name);
    return same.length > 1 ? { ...s, name: `${s.name} ${same.findIndex(other => other.id === s.id) + 1}` } : s;
  });
  const nameFor = (id: string) => ships.find(s => s.id === id)?.name ?? 'assigned leader';
  const observations = game.simulation.observationTracks ?? [];
  const enemies = [...combat.contacts.filter(c => c.team === 'enemy' && !c.physicalLost), ...observations.map(c => ({ id: c.id, name: reportName(c), x: reportPosition(c, tick)[0], z: reportPosition(c, tick)[2] }))];
  const boundary = game.simulation.missionRules?.area;
  const ids = data.selectedShipIds ?? [];
  const selected = ships.filter(s => ids.includes(s.id) && !s.physicalLost);
  const orders = game.simulation.fleetOrders ?? {};
  const scores = game.simulation.shipScores ?? {};
  const formations = fleetFormations(ships.filter(s => !s.physicalLost), orders, game.controlGroups);
  const wings = actors.filter(a => a.team === 'friendly' && a.airWing).map(a => ({ owner: a, wing: airWingTelemetry(a, actors)! }));
  const flights = wings.flatMap(({ owner, wing }) => wing.groups.map(f => ({ ...f, ownerId: owner.motion.id, carrierName: nameFor(owner.motion.id) })));
  const selectedFlights = flights.filter(f => game.selectedFlightIds.includes(f.id));
  const ownPlanes = wings.flatMap(({ owner }) => owner.airWing!.planes.filter(airborne));
  const observedModels = game.simulation.observedAircraft ?? [];
  const enemyHealth = new Map([...(game.simulation.observedShips ?? []), ...observedModels]
    .filter(o => o.health !== undefined && Number.isFinite(o.health) && tick - o.observedTick <= 60)
    .map(o => [o.id, Math.max(0, Math.min(1, o.health!))]));
  const healthOf = (c: ContactTrack) => reportState(c, tick) === 'current' ? enemyHealth.get(c.id) : undefined;
  const healthMarker = (c: ContactTrack, x: number, y: number) => {
    const hp = healthOf(c);
    return hp === undefined ? null : <g className="fleet-command-enemy-health" aria-label={`${reportName(c)} · ${Math.round(hp * 100)}% HP`}>
      <rect className="fleet-command-hull-track" x={x} y={y} width="40" height="3"/>
      <rect className="fleet-command-hull-fill" x={x} y={y} width={40 * hp} height="3"/>
      <text x={x + 45} y={y + 5}>{Math.round(hp * 100)}% HP</text>
    </g>;
  };
  const clusters = airClusters(observations, tick, 900, observedModels);
  const [coveragePoint, setCoveragePoint] = useState<[number, number]>();
  const coverage = game.simulation.reconCoverage;
  const coverageTick = coveragePoint && coverage ? coverage.cells.find(c => Math.abs(c.x - coveragePoint[0]) <= coverage.cellSizeM / 2 && Math.abs(c.z - coveragePoint[1]) <= coverage.cellSizeM / 2)?.lastObservedTick : undefined;
  const [airOpen, setAirOpen] = useState(false);
  const [filter, setFilter] = useState<'ships' | 'aircraft'>('ships');
  const [speedKn, setSpeedKn] = useState(20);
  const [formation, setFormation] = useState<'column' | 'screen'>('column');
  const [searchRadius, setSearchRadius] = useState(4000);
  const [searchAltitude, setSearchAltitude] = useState<SearchAltitude>('medium');
  const [searchPolicy, setSearchPolicy] = useState<SearchPolicy>('report');
  const [armed, setArmed] = useState<ArmedOrder>();
  const [feedback, setFeedback] = useState('');
  const [contactId, setContactId] = useState<string>();
  const [hoverId, setHoverId] = useState<string>();
  const [hoverFlightId, setHoverFlightId] = useState<string>();
  const map = useRef<SVGSVGElement>(null);
  const anchors = useRef<HTMLDivElement>(null);
  const nav = useRef(new AirMapNavigation());
  const drag = useRef<{ x: number; y: number; lastX: number; lastY: number; mode: 'pan' | 'orbit' | 'select'; pointerId: number; additive: boolean; moved: boolean } | undefined>(undefined);
  const [box, setBox] = useState<{ x: number; y: number; width: number; height: number }>();
  const ignoreClick = useRef(false);
  const pointer = useRef<{ x: number; y: number } | undefined>(undefined);
  const [movePoint, setMovePoint] = useState<[number, number]>();
  const [pendingRoutes, setPendingRoutes] = useState<Record<string, PendingRoute>>({});
  useMapProjection(map, game, mapOpen);
  useMapProjection(anchors, game, mapOpen);
  const subject = !mapOpen ? ships.find(s => s.id === data.spectatedShipId || s.id === data.controlledShipId) : selected.length === 1 ? selected[0] : undefined;
  const recipients = !mapOpen && subject ? [subject] : selected;
  const lead = recipients[0];
  const actionable = combat.result === 'active' && game.simulation.phase === 'running';
  const selectedContact = enemies.find(c => c.id === contactId);
  const selectedReport = observations.find(c => c.id === contactId);
  const current = useRef({ data, armed, filter, selected, selectedFlights, actionable, contactId, airOpen });
  current.current = { data, armed, filter, selected, selectedFlights, actionable, contactId, airOpen };
  /** A unit chosen from a list may be off the chart; bring it into view without touching zoom. */
  const reveal = (x: number, z: number) => { if (map.current && !game.projectAirMap(x, z)) game.centerAirMapOn(x, z); };
  const selectShips = (shipIds: string[]) => { setFilter('ships'); game.selectFleetShips(shipIds); game.selectFlights([]); setContactId(undefined); setArmed(undefined); };
  const selectShip = (id: string, additive: boolean) => { selectShips(additive ? ids.includes(id) ? ids.filter(s => s !== id) : [...ids, id] : [id]); const ship = ships.find(s => s.id === id); if (ship && !additive) reveal(ship.x, ship.z); };
  const selectFormation = (f: Formation) => { selectShips(f.shipIds); const leader = ships.find(s => s.id === f.leaderId); if (leader) reveal(leader.x, leader.z); };
  const selectAir = (id: string, additive = false) => { setFilter('aircraft'); game.selectFlight(id, additive); game.selectFleetShips([]); setContactId(undefined); setArmed(undefined); const flight = flights.find(f => f.id === id); if (flight && !additive) reveal(flight.position[0], flight.position[2]); };
  const issueAir = (target: SquadronTarget) => {
    if (current.current.armed === 'search') { setFeedback('Choose water for the center of the search area.'); return; }
    const action = typeof current.current.armed === 'object' ? current.current.armed.kind : undefined;
    const order = squadronTargetOrder(action, target);
    if (!order) { setFeedback(`Choose ${typeof armed === 'object' ? armed.target : 'a compatible target'}.`); return; }
    const command = SQUADRON_ACTIONS.find(a => a.kind === order.kind);
    const chosen = current.current.selectedFlights;
    const compatible = chosen.filter(f => !command || actionAvailable(command, f.role));
    const ready = compatible.filter(f => !f.deck || f.active || f.deck.canLaunch);
    const queued = ready.filter(f => game.commandSquadron(f.id, order));
    setFeedback([`${queued.length} air group orders queued`,
      compatible.length < chosen.length && `${chosen.length - compatible.length} incompatible groups skipped`,
      ready.length < compatible.length && `${compatible.length - ready.length} groups not ready to launch`,
      queued.length < ready.length && `${ready.length - queued.length} groups unavailable`,
    ].filter(Boolean).join(' · '));
    setArmed(undefined);
  };
  const escort = (leaderId: string) => {
    const followers = recipients.filter(s => s.id !== leaderId);
    followers.forEach((s, i) => game.simulation.escortShip?.(s.id, leaderId, formation === 'column' ? [0, 500 + i * 400] : [i % 2 ? 650 : -650, 450 + Math.floor(i / 2) * 600], 160));
    setFeedback(followers.length ? `${followers.length} escort orders queued · ${formation}` : 'Choose a leader outside the selection.');
    setArmed(undefined);
  };
  const move = (point: [number, number], append: boolean) => {
    if (!lead) { setFeedback('Select ships before giving a destination.'); return; }
    const previous = pendingRoutes[lead.id]?.points ?? (orders[lead.id]?.movement.type === 'route' ? routePoints(lead, orders[lead.id], ships) : []);
    const points: Vec3[] = append && previous.length > 1 ? [...previous, [point[0], 0, point[1]]] : [[lead.x, 0, lead.z], [point[0], 0, point[1]]];
    const before = game.simulation.orderReceipts?.at(-1);
    game.simulation.routeShip?.(lead.id, [point], speedKn / KNOTS_PER_MPS, false, append);
    const receipt = game.simulation.orderReceipts?.at(-1);
    if (receipt && receipt !== before && receipt.shipId === lead.id && receipt.command === 'route') {
      // Capture the exact object now, outside React's deferred state updater.
      setPendingRoutes(routes => ({ ...routes, [lead.id]: { points, receipt } }));
    }
    if (recipients.length > 1) escort(lead.id);
    setArmed(undefined); setFeedback(`${append ? 'Waypoint appended' : 'Route queued'} · ${speedKn} kn${recipients.length > 1 ? ` · ${formation}` : ''}`);
  };
  const hold = () => { recipients.forEach(s => game.simulation.holdShipArea?.(s.id, [s.x, s.z], 500)); setArmed(undefined); setFeedback(`${recipients.length} hold orders queued · 500 m station area`); };
  const targetShip = (ship: Pick<Contact, 'id' | 'team'>, right: boolean, additive: boolean) => {
    if (armed === 'search') { setFeedback('Choose water for the center of the search area.'); return; }
    const report = observations.find(c => c.id === ship.id);
    if (report?.visibleCondition?.sinking && (right || armed)) { setFeedback('Sinking already confirmed.'); return; }
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
  const arm = (order: ArmedOrder) => {
    if (!mapOpen) game.enterFleetCommand(); setArmed(order); setFeedback('');
    if (previewArmed(order)) setMovePoint(pointer.current ? game.airMapWater(pointer.current.x, pointer.current.y) : undefined);
    if (order === 'search') map.current?.focus();
  };
  const adjustSpeed = (direction: number) => setSpeedKn(v => SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, SPEEDS.indexOf(v) + direction))]);
  const cycleFormation = () => setFormation(f => f === 'column' ? 'screen' : 'column');
  const airAction = (key: string) => {
    if (!current.current.selectedFlights.length || !current.current.actionable) return;
    if (key === 'R') { current.current.selectedFlights.filter(f => f.active).forEach(f => game.commandSquadron(f.id, { kind: 'return' })); setFeedback('Return orders queued'); return; }
    if (key === 'S') { if (boundary) arm('search'); return; }
    const action = SQUADRON_ACTIONS.find(a => a.key === key);
    if (action && current.current.selectedFlights.some(f => actionAvailable(action, f.role) && (!f.deck || f.active || f.deck.canLaunch))) arm(action);
  };
  const shipAction = (key: string) => {
    const chosen = current.current.selected;
    if (key === 'V' && chosen[0]) { game.followFleetShip(chosen[0].id); return; }
    if (key === 'T' && chosen[0] && current.current.actionable) { game.takeFleetHelm(chosen[0].id); return; }
    if (!chosen.length || !current.current.actionable) return;
    if (key === 'G') arm('move'); else if (key === 'H') hold(); else if (key === 'E') arm('escort'); else if (key === 'F') arm('focus'); else if (key === 'C') cycleFormation();
  };
  // Esc closes what is open, innermost first; the battle menu is the last resort.
  const escape = () => {
    if (armed) setArmed(undefined);
    else if (contactId) { setContactId(undefined); game.selectTarget(''); }
    else if (airOpen) setAirOpen(false);
    else if (selected.length || selectedFlights.length) selectShips([]);
    else game.setPaused(true);
  };
  const handlers = useRef({ airAction, shipAction, adjustSpeed, selectFormation, formations, escape }); handlers.current = { airAction, shipAction, adjustSpeed, selectFormation, formations, escape };
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (document.querySelector('dialog[open]') || event.altKey) return;
      const element = event.target as HTMLElement;
      if (element?.matches('input, textarea, select') || element?.closest('[role=combobox], [role=listbox]') || element?.isContentEditable || (element?.closest('button, [role=button]') && event.code === 'Space')) return;
      const digit = /^Digit[1-9]$/.test(event.code) ? Number(event.code.at(-1)) : 0;
      const mapActive = !!current.current.data.airOperationsOpen;
      const toggle = bindings.airOperations.includes(event.code);
      const plain = !event.ctrlKey && !event.metaKey;
      const letter = plain && /^Key[A-Z]$/.test(event.code) ? event.code.slice(3) : '';
      const speed = plain && ['Equal', 'NumpadAdd'].includes(event.code) ? 1 : plain && ['Minus', 'NumpadSubtract'].includes(event.code) ? -1 : 0;
      const angle = mapActive && event.shiftKey && /^Arrow/.test(event.code);
      if (angle) game.orbitAirMap(event.code === 'ArrowLeft' ? -12 : event.code === 'ArrowRight' ? 12 : 0, event.code === 'ArrowUp' ? 12 : event.code === 'ArrowDown' ? -12 : 0);
      const pan = !angle && mapActive && plain && /^Arrow/.test(event.code) && nav.current.key(event.code, true);
      const shipKey = ['G', 'H', 'E', 'F', 'C', 'V', 'T'].includes(letter) && current.current.selected.length > 0 && !current.current.selectedFlights.length;
      const airKey = ['L', 'A', 'D', 'I', 'E', 'R', 'S'].includes(letter) && current.current.selectedFlights.length > 0;
      const handled = toggle || event.code === 'Space' || (!mapActive && letter === 'T' && !!current.current.data.spectatedShipId) || (mapActive && (digit || pan || angle || event.code === 'Escape' || shipKey || airKey || speed));
      if (!handled) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (event.repeat) return;
      if (toggle) { if (mapActive) game.followFleetShip(game.selectedShipIds[0] ?? game.simulation.ship.id); else game.enterFleetCommand(); }
      else if (event.code === 'Space') game.toggleTacticalPause();
      else if (!mapActive && letter === 'T') { if (current.current.data.spectatedShipId && current.current.actionable) game.takeFleetHelm(current.current.data.spectatedShipId); }
      else if (digit) { const f = handlers.current.formations.find(f => f.index === digit); if (f) handlers.current.selectFormation(f); }
      else if (event.code === 'Escape') handlers.current.escape();
      else if (speed) handlers.current.adjustSpeed(speed);
      else if (airKey) handlers.current.airAction(letter);
      else if (shipKey) handlers.current.shipAction(letter);
    };
    const keyup = (event: KeyboardEvent) => { nav.current.key(event.code, false); };
    const clear = () => { nav.current.clear(); drag.current = undefined; setBox(undefined); };
    window.addEventListener('keydown', keydown, true); window.addEventListener('keyup', keyup); window.addEventListener('blur', clear);
    return () => { window.removeEventListener('keydown', keydown, true); window.removeEventListener('keyup', keyup); window.removeEventListener('blur', clear); nav.current.clear(); };
  }, [game, bindings]);
  useEffect(() => {
    if (!mapOpen) { nav.current.clear(); drag.current = undefined; setBox(undefined); setArmed(undefined); setHoverId(undefined); return; }
    let previous = performance.now(), frame = 0;
    const animate = (now: number) => {
      const dt = (now - previous) / 1000; previous = now;
      const rect = map.current?.getBoundingClientRect();
      if (rect && !drag.current && !document.querySelector('dialog[open]')) { const [dx, dy] = nav.current.step(dt, rect.width, rect.height); if (dx || dy) game.panAirMap(dx, dy); }
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate); return () => cancelAnimationFrame(frame);
  }, [mapOpen, game]);
  useEffect(() => {
    if (!mapOpen) return;
    // Camera frames include keyboard, wheel, fit and reset navigation, even when
    // the pointer is stationary. Preview and click use the same water projection.
    return game.onCameraFrame(() => {
      if (!pointer.current) return;
      const point = game.airMapWater(pointer.current.x, pointer.current.y);
      setCoveragePoint(previous => previous?.[0] === point?.[0] && previous?.[1] === point?.[1] ? previous : point);
      if (!previewArmed(current.current.armed)) return;
      setMovePoint(previous => previous?.[0] === point?.[0] && previous?.[1] === point?.[1] ? previous : point);
    });
  }, [game, mapOpen]);
  useEffect(() => {
    const release = (event: PointerEvent) => {
      if (drag.current?.pointerId !== event.pointerId) return;
      // SVG handles in-chart releases first; this catches short gestures released
      // over a panel before they acquired pointer capture.
      drag.current = undefined; setBox(undefined);
    };
    window.addEventListener('pointerup', release); window.addEventListener('pointercancel', release);
    return () => { window.removeEventListener('pointerup', release); window.removeEventListener('pointercancel', release); };
  }, []);
  const startDrag = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button === 2) return;
    // The middle button turns the camera; a plain left drag pans the water.
    const mode = event.button === 1 || event.ctrlKey || event.metaKey || event.altKey ? 'orbit' : event.button === 0 && event.shiftKey && !armed ? 'select' : 'pan';
    drag.current = { x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY, mode, pointerId: event.pointerId, additive: event.ctrlKey || event.metaKey, moved: false };
  };
  const dragMap = (event: ReactPointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    pointer.current = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    setCoveragePoint(game.airMapWater(pointer.current.x, pointer.current.y));
    if (previewArmed(armed)) setMovePoint(game.airMapWater(pointer.current.x, pointer.current.y));
    const d = drag.current; if (!d || d.pointerId !== event.pointerId) return;
    if (!event.buttons) { drag.current = undefined; setBox(undefined); return; }
    if (!d.moved && Math.hypot(event.clientX - d.x, event.clientY - d.y) > 5) { d.moved = true; event.currentTarget.setPointerCapture(event.pointerId); }
    if (d.moved && d.mode === 'pan') game.panAirMap(event.clientX - d.lastX, event.clientY - d.lastY);
    else if (d.moved && d.mode === 'orbit') game.orbitAirMap(event.clientX - d.lastX, event.clientY - d.lastY);
    else if (d.moved && !armed) setBox({ x: Math.min(d.x, event.clientX) - rect.left, y: Math.min(d.y, event.clientY) - rect.top, width: Math.abs(event.clientX - d.x), height: Math.abs(event.clientY - d.y) });
    d.lastX = event.clientX; d.lastY = event.clientY;
  };
  const endDrag = (event: ReactPointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (d?.pointerId !== event.pointerId) return;
    drag.current = undefined; setBox(undefined);
    if (!d?.moved) return;
    ignoreClick.current = event.button === 0;
    if (d.mode !== 'select' || armed) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const inside = (x: number, y: number) => x + rect.left >= Math.min(d.x, event.clientX) && x + rect.left <= Math.max(d.x, event.clientX) && y + rect.top >= Math.min(d.y, event.clientY) && y + rect.top <= Math.max(d.y, event.clientY);
    const scaleX = rect.width / event.currentTarget.clientWidth, scaleY = rect.height / event.currentTarget.clientHeight;
    if (filter === 'ships') selectShips([...(d.additive ? game.selectedShipIds : []), ...ships.filter(s => { const p = game.projectAirMap(s.x, s.z); return !s.physicalLost && p && inside(p[0] * scaleX, p[1] * scaleY); }).map(s => s.id)]);
    else { game.selectFlights([...(d.additive ? game.selectedFlightIds : []), ...flights.filter(f => { const p = game.projectAirMap(f.position[0], f.position[2], f.position[1]); return f.airborne > 0 && p && inside(p[0] * scaleX, p[1] * scaleY); }).map(f => f.id)]); game.selectFleetShips([]); }
  };
  // Receipt references survive display-history eviction. Accepted routes remain
  // visible until an authority frame after acknowledgement has been consumed.
  useEffect(() => {
    setPendingRoutes(routes => {
      const next = { ...routes }; let changed = false;
      for (const [id, pending] of Object.entries(routes)) {
        const updated = ships.some(s => s.id === id && !s.physicalLost) ? advancePendingRoute(pending, tick) : undefined;
        if (updated !== pending) { if (updated) next[id] = updated; else delete next[id]; changed = true; }
      }
      return changed ? next : routes;
    });
  }, [game, data]);
  const receipts = game.simulation.orderReceipts?.filter(r => r.command !== 'damage-control').slice(-2) ?? [];
  const weaponsRow = recipients.length > 0 && <div className="fleet-command-weapons" role="group" aria-label="Weapons policy">{WEAPONS.map(kind => { const free = recipients.every(s => orders[s.id]?.weapons[kind]); return <button key={kind} disabled={!actionable} aria-pressed={free} onClick={() => recipients.forEach(s => game.simulation.setShipWeapons?.(s.id, { ...(orders[s.id]?.weapons ?? { guns: true, aa: true, torpedoes: false }), [kind]: !free }))}><i/>{weaponLabel[kind]} {free ? 'free' : 'held'}</button>; })}</div>;
  const stragglerTags = recipients.flatMap(s => (orders[s.id]?.navigation?.formation?.stragglers ?? []).map(straggler => ({ leader: s, straggler, ship: ships.find(c => c.id === straggler.shipId) })));

  if (!mapOpen) {
    const helm = !!subject && data.controlledShipId === subject.id;
    return <div className={`fleet-command ${helm ? 'fleet-command-helm-mode' : 'fleet-command-follow'}`}>
      <section className="fleet-command-panel" aria-label={helm ? 'Fleet helm controls' : 'Following ship'}>
        <h2>{helm ? 'At the helm' : 'Following'} <span>{subject?.name}</span><small>{helm ? 'You steer' : 'Captain in command'}</small></h2>
        {subject && <p>{standingOrder(orders[subject.id], nameFor)}</p>}
        <div className="fleet-command-panel-actions">
          <SimulationSpeed game={game} data={data}/>
          {helm ? <button onClick={() => game.followFleetShip(data.controlledShipId!)}>Give back helm</button> : <button disabled={!actionable || !subject || subject.physicalLost} onClick={() => subject && game.takeFleetHelm(subject.id)}>Take helm <kbd>T</kbd></button>}
          <button onClick={() => game.enterFleetCommand()}><Icon name="compass" size={14}/>Fleet command <kbd>M</kbd></button>
        </div>
        {!helm && weaponsRow}
        {feedback && <p className="fleet-command-feedback" role="status">{feedback}</p>}
      </section>
      {data.tacticalPaused && <p className="fleet-command-paused" role="status">Tactical pause · Both fleets stopped · {game.simulation.queuedOrderCount ?? 0} orders queued for resume</p>}
    </div>;
  }

  const origin = subject ?? lead ?? { x: game.simulation.ship.x, z: game.simulation.ship.z };
  const rosterShips: RosterShip[] = ships.map(s => {
    const actor = actorOf(s.id), wing = wings.find(w => w.owner.motion.id === s.id)?.wing, status = orders[s.id]?.navigation?.status;
    return { id: s.id, name: s.name, hull: s.integrity, kn: Math.round(Math.abs((actor?.motion.speed ?? 0) * KNOTS_PER_MPS)), damageDealt: scores[s.id]?.damageDealt ?? 0, frags: scores[s.id]?.frags ?? 0, lost: s.physicalLost,
      warn: !s.physicalLost && (s.integrity < .5 || status === 'straggling' || status === 'blocked' || status === 'immobile' || status === 'leader-lost'),
      aircraft: wing ? { remaining: Object.values(wing.counts).reduce((n, v) => n + v, 0) - wing.counts.lost - wing.counts.withdrawn, total: Object.values(wing.counts).reduce((n, v) => n + v, 0) } : undefined };
  });
  const ownAircraft = rosterShips.reduce((sum, s) => ({ remaining: sum.remaining + (s.aircraft?.remaining ?? 0), total: sum.total + (s.aircraft?.total ?? 0) }), { remaining: 0, total: 0 });
  // The corner card carries the same rows as the foot tokens plus the class glyph,
  // the standing order and the tonnage the comparison counts.
  const ownShips: OwnFleetShip[] = rosterShips.map(s => ({
    ...s, warn: !!s.warn, shipClass: shipClassOf(actorOf(s.id)?.definition ?? shipPreset(ships.find(c => c.id === s.id)!.shipId)),
    order: standingOrder(orders[s.id], nameFor), massKg: actorOf(s.id)?.definition.hull.massKg ?? 0,
  }));
  const ownWing: OwnFleetAircraft = {
    remaining: ownAircraft.remaining, total: ownAircraft.total,
    airborne: wings.reduce((n, { wing }) => n + wing.groups.reduce((m, f) => m + f.airborne, 0), 0),
    onDeck: wings.reduce((n, { wing }) => n + wing.onDeck, 0), inHangar: wings.reduce((n, { wing }) => n + wing.inHangar, 0),
  };
  const railOpen = airOpen && wings.length > 0;
  const comparison = battleComparison({
    own: ships.map(s => { const a = actorOf(s.id); return { id: s.id, massKg: a?.definition.hull.massKg ?? 0, integrity: a?.damage.integrity ?? 0, maxIntegrity: a?.damage.maxIntegrity ?? 0, lost: s.physicalLost }; }),
    scores, tracks: observations, massOf: id => shipPreset(id).hull.massKg, enemyLostShips: combat.contacts.filter(c => c.team === 'enemy' && c.physicalLost).length, ownAircraft, enemyAircraftLost: game.simulation.aircraftLosses?.enemy,
  });
  const wheelItems: WheelItem[] = [
    { kind: 'move', label: 'Move', sub: armed === 'move' ? 'G · armed' : 'G', armed: armed === 'move', disabled: !actionable },
    { kind: 'hold', label: 'Hold', sub: 'H', disabled: !actionable },
    { kind: 'escort', label: 'Escort', sub: 'E', armed: armed === 'escort', disabled: !actionable },
    { kind: 'focus', label: 'Focus fire', sub: 'F', armed: armed === 'focus', disabled: !actionable },
    { kind: 'formation', label: formation === 'column' ? 'Column' : 'Screen', sub: 'C · formation' },
    { kind: 'speed', label: `${speedKn} kn`, sub: '+ / −' },
  ];
  const armedHint = typeof armed === 'object' ? `Choose ${armed.target}` : armed === 'search' ? 'Choose the area center on water, or pan with arrow keys and press Enter at chart center' : armed === 'move' ? 'Choose water · Shift adds a waypoint' : armed === 'escort' ? 'Choose a friendly leader' : armed === 'focus' ? 'Choose an enemy contact' : '';
  // Near the right edge — or the open air rail — the wheel opens to port of the unit instead of running under it.
  const flipAt = (x: number, z: number) => { if (!map.current) return ''; const point = game.projectAirMap(x, z); return point ? `${point[0] > map.current.clientWidth - (railOpen ? 340 : 0) - 560 ? 'flip' : ''} ${point[1] > map.current.clientHeight - 420 ? 'flip-up' : ''}` : ''; };
  const chip = (name: string) => <div className="fleet-command-wheel-chip"><strong>{name}</strong><span>{armedHint}</span><button onClick={() => setArmed(undefined)}>Cancel<kbd>Esc</kbd></button></div>;
  const onWheel = (kind: string, shift: boolean) => {
    if (kind === 'move') arm('move'); else if (kind === 'hold') hold(); else if (kind === 'escort') arm('escort'); else if (kind === 'focus') arm('focus');
    else if (kind === 'formation') cycleFormation(); else if (kind === 'speed') adjustSpeed(shift ? -1 : 1);
  };
  const airReady = (a: SquadronAction) => selectedFlights.some(f => actionAvailable(a, f.role) && (!f.deck || f.active || f.deck.canLaunch));
  const airItems: WheelItem[] = [
    ...SQUADRON_ACTIONS.filter(a => selectedFlights.some(f => actionAvailable(a, f.role))).map(a => ({ kind: a.kind, label: a.label, sub: typeof armed === 'object' && armed.kind === a.kind ? `${a.key} · armed` : a.key, armed: typeof armed === 'object' && armed.kind === a.kind, disabled: !actionable || !airReady(a) })),
    { kind: 'return', label: 'Return', sub: 'R', disabled: !actionable || !selectedFlights.some(f => f.active) },
    ...(boundary ? [{ kind: 'search', label: 'Search', sub: armed === 'search' ? 'S · armed' : 'S', armed: armed === 'search', disabled: !actionable || !selectedFlights.some(f => (searchPolicy !== 'strike' || f.role !== 'fighter') && (!f.deck || f.active || f.deck.canLaunch)) }] : []),
  ];
  const onAirWheel = (kind: string) => { if (kind === 'return') airAction('R'); else if (kind === 'search') arm('search'); else { const action = SQUADRON_ACTIONS.find(a => a.kind === kind); if (action) arm(action); } };
  const flightCentroid = selectedFlights.length ? selectedFlights.reduce<Vec3>((sum, f) => [sum[0] + f.position[0] / selectedFlights.length, sum[1] + f.position[1] / selectedFlights.length, sum[2] + f.position[2] / selectedFlights.length], [0, 0, 0]) : undefined;
  const planesOf = (flight: { aircraftIds: string[] }) => wings.flatMap(({ owner }) => owner.airWing!.planes.filter(p => flight.aircraftIds.includes(p.id)));
  const selectedTrackCluster = selectedReport?.kind === 'aircraft' ? clusters.find(c => c.trackIds.includes(selectedReport.id)) : undefined;

  return <div onClickCapture={e => {
    if (armed !== 'move' || !(e.target as Element).closest('.fleet-command-chart, .air-squadron-labels')) return;
    e.stopPropagation();
    if (ignoreClick.current) { ignoreClick.current = false; return; }
    water(e, false);
  }} className={`fleet-command fleet-command-map${railOpen ? ' rail-open' : ''}`}>
    <svg ref={map} className="fleet-command-chart" tabIndex={0} aria-label="Fleet command chart" data-armed={armed ? true : undefined}
      onKeyDown={e => { if (armed === 'search' && e.key === 'Enter') { e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); water({ clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, shiftKey: false }, false); } }}
      onMouseDown={e => { if (e.button === 1) e.preventDefault(); }} onAuxClick={e => e.preventDefault()}
      onPointerDown={startDrag} onPointerMove={dragMap} onPointerUp={endDrag} onPointerCancel={() => { drag.current = undefined; setBox(undefined); }}
      onClick={e => { if (ignoreClick.current) { ignoreClick.current = false; return; } water(e, false); }}
      onContextMenu={e => { e.preventDefault(); if (e.ctrlKey || e.metaKey || e.altKey || drag.current?.moved) return; water(e, true); }} onWheel={e => { const r = e.currentTarget.getBoundingClientRect(); game.zoomAirMap(e.deltaY, e.clientX - r.left, e.clientY - r.top); }}>
      {armed === 'search' && <svg x="50%" y="50%" width="1" height="1" overflow="visible" className="fleet-command-search-center" aria-hidden="true"><path d="M-12 0H12M0-12V12"/></svg>}
      <ReconnaissanceCoverage coverage={game.simulation.reconCoverage} tick={tick}/>
      {boundary && <path className="fleet-command-boundary" data-map-path={JSON.stringify(circlePoints(0, 0, boundary.radiusM))} data-closed="true"/>}
      {boundary && <path className="fleet-command-boundary-warning" data-map-path={JSON.stringify(circlePoints(0, 0, boundary.radiusM - boundary.warningMarginM))} data-closed="true"/>}
      {formations.map(f => {
        const members = ships.filter(s => f.shipIds.includes(s.id));
        if (!members.length) return null;
        const all = members.every(m => ids.includes(m.id));
        const points = bracketPoints(members);
        return <g key={`formation-${f.index}`} className={`fleet-command-bracket ${all ? 'selected' : ''}`}>
          {members.length > 1 && <path data-map-path={JSON.stringify(points)} data-closed="true"/>}
          <g className="fleet-command-bracket-label" data-map-position={JSON.stringify(members.length > 1 ? points[0] : [members[0].x, 0, members[0].z])} role="button" tabIndex={0} aria-label={`Select ${f.name} · ${f.index}`}
            onClick={e => { e.stopPropagation(); selectFormation(f); }} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); selectFormation(f); } }}>
            <rect className="fleet-command-bracket-key" x={members.length > 1 ? 0 : -30} y={members.length > 1 ? -24 : -32} width="16" height="16" rx="2"/><text className="fleet-command-bracket-index" x={members.length > 1 ? 8 : -22} y={members.length > 1 ? -12 : -20}>{f.index}</text>
            {members.length > 1 && <text className="fleet-command-bracket-name" x="22" y="-12">{f.name} · {members.length} ships</text>}
          </g>
        </g>;
      })}
      {observations.filter(c => c.kind === 'surface' && c.id === contactId && !c.visibleCondition?.sinking).map(c => <path key={`area-${c.id}`} className={`fleet-command-uncertainty ${c.status}`} data-map-path={JSON.stringify(circlePoints(c.estimatedPosition[0], c.estimatedPosition[2], c.uncertaintyM))} data-closed="true"/>)}
      {flights.filter(f => f.active || f.airborne > 0).map(f => {
        const on = game.selectedFlightIds.includes(f.id), carrier = ships.find(s => s.id === f.ownerId);
        const from: Vec3 = f.airborne > 0 ? f.position : carrier ? [carrier.x, 0, carrier.z] : f.position;
        const station: Vec3 = [f.destination[0], 0, f.destination[2]], patrol = f.order.kind === 'patrol', search = f.order.kind === 'search-area' ? f.order : undefined;
        // Loitering pilots steer at a moving orbit point; the chart shows the station itself, not the tangent.
        const path: Vec3[] = patrol ? [from, station] : f.route.length > 1 ? f.route : f.airborne === 0 && f.order.kind !== 'return' ? [from, station] : [];
        return <g key={`air-${f.id}`} className={`fleet-command-air-course ${on ? 'selected' : ''} ${f.airborne === 0 ? 'planned' : ''}`} aria-label={`${f.name} course`}>
          {path.length > 1 && <path className="fleet-command-air-route" data-map-path={JSON.stringify(path)}/>}
          {patrol && <><path className="fleet-command-loiter" data-map-path={JSON.stringify(circlePoints(station[0], station[2], LOITER_RADIUS_M))} data-closed="true"/><g className="fleet-command-air-target" data-map-position={JSON.stringify(station)}><circle r="7"/><path d="M-11 0H11M0-11V11"/></g></>}
          {search && <path className="fleet-command-search-area" data-map-path={JSON.stringify(circlePoints(search.center[0], search.center[1], search.radiusM))} data-closed="true"/>}
        </g>;
      })}
      {selectedFlights.flatMap(f => f.search?.trail.slice(1).flatMap((sample, i) => { const age = (tick - sample.tick) / 60; return age <= 90 ? [<path key={`trail-${f.id}-${sample.tick}`} className="fleet-command-search-trail" opacity={Math.max(.15, 1 - age / 90)} data-map-path={JSON.stringify([f.search!.trail[i].position, sample.position])}/>] : []; }) ?? [])}
      {ships.filter(s => !s.physicalLost).map(s => {
        const pending = pendingRoutes[s.id];
        const points = pending ? pending.points : routePoints(s, orders[s.id], ships);
        const movement = orders[s.id]?.movement;
        const waypoints = pending || movement?.type === 'route' ? points.slice(1) : [];
        return <g key={`route-${s.id}`} data-route-owner={s.id} className={`fleet-command-course ${ids.includes(s.id) ? 'selected' : ''}`}>
          <path className={movement?.type === 'escort' ? 'fleet-command-escort-link' : movement?.type === 'hold-area' ? 'fleet-command-hold-ring' : 'fleet-command-route'} data-map-path={JSON.stringify(points)}/>
          {waypoints.map((point, i) => <g key={i} className="fleet-command-waypoint" data-map-position={JSON.stringify(point)} aria-label={`${s.name} waypoint ${i + 1}`}><circle r="8"/><path d="M-12 0H12M0-12V12"/><text x="12" y="-10">{i + 1}</text></g>)}
        </g>;
      })}
      {armed === 'move' && movePoint && <g className="fleet-command-move-preview" aria-label="Move preview">
        {recipients.map(s => <path key={s.id} data-map-path={JSON.stringify([[s.x, 0, s.z], [movePoint[0], 0, movePoint[1]]])}/>)}
        <g data-map-position={JSON.stringify([movePoint[0], 0, movePoint[1]])}><circle r="9"/><path d="M-14 0H14M0-14V14"/><text x="16" y="-8">{speedKn} kn · Shift adds a waypoint</text></g>
      </g>}
      {previewArmed(armed) && armed !== 'move' && movePoint && selectedFlights.length > 0 && <g className="fleet-command-move-preview air" aria-label="Air order preview">
        {selectedFlights.map(f => <path key={f.id} data-map-path={JSON.stringify([f.position, [movePoint[0], 0, movePoint[1]]])}/>)}
        {armed === 'search' && <path data-map-path={JSON.stringify(circlePoints(movePoint[0], movePoint[1], searchRadius))} data-closed="true"/>}
        {armed !== 'search' && <path data-map-path={JSON.stringify(circlePoints(movePoint[0], movePoint[1], LOITER_RADIUS_M))} data-closed="true"/>}
        <g data-map-position={JSON.stringify([movePoint[0], 0, movePoint[1]])}><circle r="9"/><path d="M-14 0H14M0-14V14"/><text x="16" y="-8">{armed === 'search' ? `Search · ${searchRadius / 1000} km` : 'Loiter here'}</text></g>
      </g>}
      {combat.contacts.filter(c => !c.physicalLost).map(s => {
        const own = s.team === 'friendly', actor = own ? actorOf(s.id) : undefined, status = orders[s.id]?.navigation?.status;
        const warn = own && (s.integrity < .5 || status === 'straggling' || status === 'blocked' || status === 'immobile');
        const kn = Math.round(Math.abs((actor?.motion.speed ?? 0) * KNOTS_PER_MPS));
        // A leader's label sits to port so its escorts, stationed close astern and to starboard, keep theirs readable.
        const leader = own && formations.some(f => f.leaderId === s.id && f.shipIds.length > 1);
        const definition = actor?.definition ?? shipPreset(s.shipId), glyph = SHIP_GLYPHS[shipClassOf(definition)];
        return <g key={s.id} data-map-position={JSON.stringify([s.x, 0, s.z])} data-ship-marker={s.id} data-map-fade={`${definition.hull.length},${s.heading}`} className={`fleet-command-marker ${s.team} ${ids.includes(s.id) || s.id === contactId ? 'selected' : ''} ${hoverId === s.id ? 'hovered' : ''} ${warn ? 'warn' : ''}`}
          role="button" tabIndex={0} aria-label={`${nameFor(s.id) === 'assigned leader' ? s.name : nameFor(s.id)} · ${s.team}`}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); targetShip(s, false, e.shiftKey); } }}
          onClick={e => { e.stopPropagation(); if (ignoreClick.current) { ignoreClick.current = false; return; } targetShip(s, false, e.shiftKey || e.ctrlKey || e.metaKey); }}
          onContextMenu={e => { e.preventDefault(); e.stopPropagation(); if (e.ctrlKey || e.metaKey || e.altKey || drag.current?.moved) return; targetShip(s, true, false); }}>
          <circle r="18" className="fleet-command-hitbox"/>
          {hoverId === s.id && <circle r="22" className="fleet-command-hover-ring"/>}
          <g data-map-glyph="true" data-map-heading={s.heading}><path className="fleet-command-hull" d={glyph.hull}/><path className="fleet-command-mark" d={glyph.mark}/></g>
          <text x={leader ? -14 : 14} y="-3" textAnchor={leader ? 'end' : 'start'}>{own ? nameFor(s.id) : s.name}</text>
          {own && <><rect className="fleet-command-hull-track" x={leader ? -54 : 14} y="2" width="40" height="3"/><rect className="fleet-command-hull-fill" x={leader ? -14 - 40 * Math.max(0, Math.min(1, s.integrity)) : 14} y="2" width={40 * Math.max(0, Math.min(1, s.integrity))} height="3"/>
            <text className="fleet-command-marker-order" x={leader ? -14 : 14} y="17" textAnchor={leader ? 'end' : 'start'}>{Math.round(s.integrity * 100)}% · {kn} kn{status === 'straggling' ? ' · straggling' : status === 'evading-aircraft' || status === 'evading-torpedo' ? ' · evading' : ''}</text></>}
          {!own && <text className="fleet-command-marker-order" x="14" y="11">{s.status === 'operational' ? 'contact' : s.status.replaceAll('-', ' ')}</text>}
        </g>;
      })}
      {observations.filter(c => c.kind === 'surface').map(c => { const glyph = SHIP_GLYPHS[c.identifiedPresetId ? shipClassOf(shipPreset(c.identifiedPresetId)) : shipClassFromReport(c.classification)], [rvx, , rvz] = c.velocity, heading = Math.atan2(rvx, -rvz); return <g key={c.id} data-map-position={JSON.stringify(reportPosition(c, tick))} data-contact-marker={c.id} data-contact-kind="surface" data-map-fade={`${c.identifiedPresetId ? shipPreset(c.identifiedPresetId).hull.length : 180},${heading}`} data-report-state={reportState(c, tick)} className={`fleet-command-marker ${c.affiliation === 'hostile' ? 'enemy' : 'unidentified'} report ${c.status} ${contactId === c.id ? 'selected' : ''}`}
        role="button" tabIndex={0} aria-label={`${reportName(c)} · ${c.status} · observed ${reportAge(c, tick)} · uncertainty ${reportUncertainty(c)}`}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); selectReport(c); } }}
        onClick={e => { e.stopPropagation(); if (ignoreClick.current) { ignoreClick.current = false; return; } selectReport(c); }} onContextMenu={e => { e.preventDefault(); e.stopPropagation(); if (e.ctrlKey || e.metaKey || e.altKey || drag.current?.moved) return; selectReport(c, true); }}>
        <title>{`${reportName(c)} · ${reportState(c, tick).replaceAll('-', ' ')} · ${reportAge(c, tick)}`}</title>
        <circle r="18" className="fleet-command-hitbox"/>
        <g data-map-glyph="true" data-map-heading={heading}><path className="fleet-command-hull" d={glyph.hull}/><path className="fleet-command-mark" d={glyph.mark}/></g>
        <text x="16" y="-3">{reportName(c)}</text><text className="fleet-command-marker-order" x="16" y="11">{c.affiliation === 'unknown' ? 'affiliation unknown' : reportState(c, tick) === 'current' ? conditionReport(c, tick).split(' · ')[0].toLowerCase() : `${reportState(c, tick).replaceAll('-', ' ')} · ${reportAge(c, tick)}`}</text>
        {healthMarker(c, 16, 18)}
      </g>; })}
      {ownPlanes.map(p => { const flight = flights.find(f => f.id === p.flightId), on = !!flight && game.selectedFlightIds.includes(flight.id), unarmed = p.role === 'fighter' ? p.ammo <= 0 : !p.payload; return <g key={p.id} data-map-position={JSON.stringify(p.position)} data-plane={p.id} data-map-fade={`13,${p.heading},12,30`} className={`fleet-command-plane friendly ${on ? 'selected' : ''} ${p.hp < 50 ? 'hurt' : ''} ${unarmed ? 'unarmed' : ''} ${hoverFlightId && hoverFlightId === p.flightId ? 'hovered' : ''}`}
        onClick={e => { e.stopPropagation(); if (ignoreClick.current) { ignoreClick.current = false; return; } if (flight) selectAir(flight.id, e.shiftKey || e.ctrlKey || e.metaKey); }}>
        <circle r="8" className="fleet-command-hitbox"/>
        <g data-map-glyph="true" data-map-heading={p.heading}><path d={PLANE_GLYPHS[p.role]} transform="scale(.9)"/></g>
        {on && <><rect className="fleet-command-hull-track" x="-6" y="9" width="12" height="2"/><rect className="fleet-command-hull-fill" x="-6" y="9" width={12 * Math.max(0, Math.min(1, p.hp / 100))} height="2"/></>}
      </g>; })}
      {observations.filter(c => c.kind === 'aircraft').map(c => { const position = reportPosition(c, tick), [vx, , vz] = c.velocity, damaged = c.visibleCondition?.fire || c.visibleCondition?.heavySmoke; return <g key={c.id} data-map-position={JSON.stringify(position)} data-track={c.id} data-contact-kind="aircraft" data-map-fade={`13,${Math.atan2(vx, -vz)},12,30`} data-report-state={reportState(c, tick)} className={`fleet-command-plane ${c.affiliation === 'hostile' ? 'enemy' : 'unidentified'} ${c.status} ${contactId === c.id ? 'selected' : ''}`}
        role="button" tabIndex={0} aria-label={`${reportName(c)} · ${c.status} · observed ${reportAge(c, tick)}`}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); selectReport(c); } }}
        onClick={e => { e.stopPropagation(); if (ignoreClick.current) { ignoreClick.current = false; return; } selectReport(c); }} onContextMenu={e => { e.preventDefault(); e.stopPropagation(); if (e.ctrlKey || e.metaKey || e.altKey || drag.current?.moved) return; selectReport(c, true); }}>
        <title>{`${reportName(c)} · ${reportState(c, tick).replaceAll('-', ' ')} · ${reportAge(c, tick)}`}</title>
        <circle r="8" className="fleet-command-hitbox"/>
        <g data-map-glyph="true" data-map-heading={Math.atan2(vx, -vz)}><path d={PLANE_GLYPHS[reportedAircraftType(c, observedModels).type]} transform="scale(.9)"/>{damaged && <path className="fleet-command-smoke" d="M0 6q-3 6 -1 12"/>}</g>
        {healthMarker(c, 12, 18)}
      </g>; })}
      {clusters.map(cluster => <g key={cluster.id} data-map-position={JSON.stringify(cluster.position)} className={`fleet-command-cluster ${cluster.stale ? 'stale' : ''} ${cluster.trackIds.includes(contactId ?? '') ? 'selected' : ''}`} aria-hidden="true">
        <text x="20" y="-2">{cluster.label}{cluster.model ? ` · ${cluster.model}` : ''}</text><text className="fleet-command-marker-order" x="20" y="11">{cluster.stale ? `last known · ${observationAge(cluster.lastObservedTick, tick)}` : `current${cluster.smoking ? ` · ${cluster.smoking} smoking` : ''}`}</text>
      </g>)}
    </svg>
    <div ref={anchors} className="fleet-command-anchors">
      {lead && !selectedFlights.length && <div className={`fleet-command-wheel-anchor ${flipAt(lead.x, lead.z)}`} data-map-position={JSON.stringify([lead.x, 0, lead.z])}>
        {armed ? chip(recipients.length > 1 ? `${recipients.length} ships` : lead.name) : <div className="fleet-command-wheel-block">
          <div className="fleet-command-wheel-title"><strong>{recipients.length > 1 ? `${recipients.length} ships` : lead.name}</strong><small>{recipients.length > 1 ? recipients.map(s => s.name).join(' · ') : `${Math.round(lead.integrity * 100)}% · ${Math.round(Math.abs((actorOf(lead.id)?.motion.speed ?? 0) * KNOTS_PER_MPS))} kn · ${standingOrder(orders[lead.id], nameFor)}`}</small></div>
          <div className="fleet-command-wheel-row">
            <OrderWheel items={wheelItems} hull={lead.integrity} onSelect={onWheel} label="Order wheel"/>
            <div className="fleet-command-wheel-actions">
              <button onClick={() => game.followFleetShip(lead.id)}><Icon name="camera" size={13}/>Follow<kbd>V</kbd></button>
              <button disabled={!actionable} onClick={() => game.takeFleetHelm(lead.id)}>Take helm<kbd>T</kbd></button>
            </div>
          </div>
          {weaponsRow}
        </div>}
      </div>}
      {stragglerTags.map(({ leader, straggler, ship }) => ship && <div key={`straggler-${straggler.shipId}`} className="fleet-command-straggler" data-map-position={JSON.stringify([ship.x, 0, ship.z])} role="group" aria-label={`${ship.name} straggling`}>
        <span>{ship.name} straggling · {(straggler.availableSpeedMps * KNOTS_PER_MPS).toFixed(0)} kn available · {(straggler.gapM / 1000).toFixed(1)} km from station</span>
        {(['slow-for-stragglers', 'leave-stragglers'] as const).map(policy => <button key={policy} disabled={!actionable} aria-pressed={orders[leader.id]?.formationPolicy === policy} onClick={() => { game.simulation.setFormationPolicy?.(leader.id, policy); setFeedback(`${leader.name} · Formation policy queued`); }}>{policy === 'slow-for-stragglers' ? 'Slow for stragglers' : 'Leave behind'}</button>)}
      </div>)}
      {selectedFlights.length > 0 && flightCentroid && <div className={`fleet-command-wheel-anchor ${flipAt(flightCentroid[0], flightCentroid[2])}`} data-map-position={JSON.stringify(flightCentroid)}>
        {armed ? chip(selectedFlights.length === 1 ? selectedFlights[0].name : `${selectedFlights.length} air groups`) : <div className="fleet-command-wheel-block air">
          <div className="fleet-command-wheel-title"><strong>{selectedFlights.length === 1 ? selectedFlights[0].name : `${selectedFlights.length} air groups`}</strong><small>{selectedFlights.reduce((n, f) => n + f.surviving, 0)}/{selectedFlights.reduce((n, f) => n + f.total, 0)} · {selectedFlights.reduce((n, f) => n + f.armed, 0)} armed · {selectedFlights.length === 1 ? (selectedFlights[0].active ? mission(selectedFlights[0]) : selectedFlights[0].activity) : [...new Set(selectedFlights.map(f => f.carrierName))].join(', ')}{selectedFlights[0].enduranceSeconds !== null && selectedFlights.length === 1 ? ` · ${duration(selectedFlights[0].enduranceSeconds)}` : ''}</small></div>
          <div className="fleet-command-wheel-row">
            <OrderWheel items={airItems} hull={selectedFlights.reduce((n, f) => n + f.hp, 0) / selectedFlights.length / 100} hubLabel={String(selectedFlights.reduce((n, f) => n + f.surviving, 0))} onSelect={onAirWheel} label="Air order wheel"/>
            <div className="fleet-command-wheel-actions">
              <button onClick={() => { setAirOpen(true); setFilter('aircraft'); }}>Deck<Icon name="chevron" size={12} style={{ transform: 'rotate(-90deg)' }}/></button>
              <button onClick={() => game.followAircraft?.(planesOf(selectedFlights[0]).find(p => airborne(p))?.id ?? '')} disabled={!planesOf(selectedFlights[0]).some(p => airborne(p))}><Icon name="camera" size={13}/>Follow lead</button>
            </div>
          </div>
          <div className="fleet-command-planes">{selectedFlights.map(f => <div key={f.id} className="fleet-command-plane-row" onMouseEnter={() => setHoverFlightId(f.id)} onMouseLeave={() => setHoverFlightId(undefined)}><b>{f.name}</b><span className="fleet-command-plane-bars">{planesOf(f).map(p => <i key={p.id} className={p.hp <= 0 || ['lost', 'withdrawn'].includes(p.phase) ? 'lost' : p.hp < 50 ? 'hurt' : ''} style={{ ['--hp' as string]: `${Math.max(0, Math.min(100, p.hp))}%` }} title={`${p.id.split('/').at(-1)} · ${Math.ceil(p.hp)}% · ${p.lossReason ?? p.phase}${p.role === 'fighter' ? p.ammo > 0 ? ' · armed' : ' · no ammunition' : p.payload ? ' · armed' : ' · no payload'}`}/>)}</span><span>{f.surviving}/{f.total}</span></div>)}</div>
          {boundary && <div className="fleet-command-buttons fleet-command-search">
            <label>Radius<Select value={searchRadius} onValueChange={v => setSearchRadius(Number(v))}>{[2000, 4000, 6000].map(v => <SelectOption key={v} value={v}>{v / 1000} km</SelectOption>)}</Select></label>
            <label>Altitude<Select value={searchAltitude} onValueChange={v => setSearchAltitude(v as SearchAltitude)}><SelectOption value="low">Low · 200 m</SelectOption><SelectOption value="medium">Medium · 850 m</SelectOption><SelectOption value="high">High · 1,500 m</SelectOption></Select></label>
            <label>On contact<Select value={searchPolicy} onValueChange={v => setSearchPolicy(v as SearchPolicy)}><SelectOption value="report">Report only</SelectOption><SelectOption value="shadow">Shadow and report</SelectOption><SelectOption value="strike">Search and strike</SelectOption></Select></label>
          </div>}
          <AirGroupService flights={selectedFlights} enabled={actionable} command={(groups, action) => { const accepted = groups.filter(f => game.commandDeck(f.id, action)); setArmed(undefined); setFeedback(`${accepted.length} group service orders queued`); }}/>
          {selectedFlights.some(f => f.notice) && <p className="fleet-command-notice" role="status">{selectedFlights.filter(f => f.notice).map(f => `${f.name} · ${f.notice}`).join(' / ')}</p>}
        </div>}
      </div>}
      {selectedContact && <div className="fleet-command-popover-anchor" {...(selectedReport?.kind === 'aircraft' ? { 'data-map-position': JSON.stringify(reportPosition(selectedReport, tick)) } : selectedReport ? { 'data-map-position': JSON.stringify(reportPosition(selectedReport, tick)), 'data-contact-marker': selectedReport.id } : { 'data-map-position': JSON.stringify([selectedContact.x, 0, selectedContact.z]) })}>
        <section className="fleet-command-popover" aria-label="Contact report">
          <strong>{selectedTrackCluster ? selectedTrackCluster.label : selectedContact.name}</strong>
          {selectedReport ? <p>{selectedReport.affiliation === 'hostile' ? 'Hostile' : 'Affiliation unknown'} · {reportState(selectedReport, tick).replaceAll('-', ' ')} · {bearingLabel(selectedContact.x - origin.x, selectedContact.z - origin.z)} · {rangeLabel(selectedContact.x - origin.x, selectedContact.z - origin.z)}{selectedReport.visibleCondition?.sinking ? '' : ` · ±${reportUncertainty(selectedReport)}`}</p> : <p>Hostile · {bearingLabel(selectedContact.x - origin.x, selectedContact.z - origin.z)} · {rangeLabel(selectedContact.x - origin.x, selectedContact.z - origin.z)}</p>}
          {selectedReport && <p>Reported by {selectedReport.sources.map(source => ships.find(s => s.id === source.observerId)?.name ?? 'Friendly aircraft').filter((name, i, names) => names.indexOf(name) === i).join(', ') || 'Fleet lookouts'}, observed {reportAge(selectedReport, tick)}. {selectedReport.kind === 'surface' ? conditionReport(selectedReport, tick).split(' · ')[0] : 'Heading and speed are estimates from your observers.'}</p>}
          {selectedReport && healthOf(selectedReport) !== undefined && <p>{Math.round(healthOf(selectedReport)! * 100)}% HP remaining</p>}
          <p className="fleet-command-popover-hint">{selectedReport?.visibleCondition?.sinking ? 'Loss confirmed by an observer. This report is no longer a target.' : selectedReport?.status === 'stale' ? 'Search the reported area to reacquire this contact.' : selectedReport?.kind === 'aircraft' ? 'Select a fighter group and Intercept to engage.' : 'Right-click with ships selected to focus fire, or with bombers selected to strike.'}</p>
          <div className="fleet-command-buttons">
            <button disabled={!actionable || !selectedFlights.length && !flights.some(f => f.role !== 'fighter' || true)} onClick={() => { if (!current.current.selectedFlights.length) { setFeedback('Select air groups first, then search here.'); return; } arm('search'); }}><Icon name="target" size={13}/>Search here<kbd>S</kbd></button>
            <button onClick={() => { setContactId(undefined); game.selectTarget(''); }}>Close<kbd>Esc</kbd></button>
          </div>
        </section>
      </div>}
    </div>
    <div className="fleet-command-recon"><ReconnaissanceLegend coverage={game.simulation.reconCoverage}/>{game.simulation.reconCoverage && <span>{coverageTick === undefined ? 'Point at water for search age' : `Here: observed ${observationAge(coverageTick, tick)}`}</span>}</div>
    {box && <div className="fleet-command-box" style={{ left: box.x, top: box.y, width: box.width, height: box.height }}/>}
    <SquadronLabels data={data} game={game} onSelect={(id, additive) => { selectAir(id, additive); }} onTarget={(id, team) => { if (armed === 'search') { setFeedback('Choose water for the center of the search area.'); return true; } if (typeof armed !== 'object') return false; issueAir({ kind: 'squadron', id, team }); return true; }} onOrder={(id, team) => issueAir({ kind: 'squadron', id, team })}/>
    <header className="fleet-command-top">
      <div><time>{duration(tick / 60)}</time><SimulationSpeed game={game} data={data}/></div>
      <nav aria-label="Fleet views">
        <button aria-pressed={filter === 'ships'} onClick={() => { setFilter('ships'); setAirOpen(false); game.selectFlights([]); setArmed(undefined); }}><Icon name="ship" size={14}/>Ships</button>
        {wings.length > 0 && <button aria-pressed={filter === 'aircraft'} aria-expanded={airOpen} onClick={() => { setFilter('aircraft'); setAirOpen(!airOpen); }}><Icon name="aircraft" size={14}/>Aircraft</button>}
        <button onClick={() => game.fitAirMap()} title="Fit reported fleet"><Icon name="expand" size={14}/>Fit</button>
        <button onClick={() => game.resetAirMapAngle()} title="Reset camera angle"><Icon name="compass" size={14}/>North up</button>
        {!game.simulation.networked && <button onClick={() => game.toggleTacticalPause()} aria-pressed={data.tacticalPaused}><Icon name={data.tacticalPaused ? 'play' : 'pause'} size={14}/>{data.tacticalPaused ? 'Resume' : 'Pause'} <kbd>Space</kbd></button>}
        <button onClick={() => game.setPaused(true)} aria-label="Battle menu"><Icon name="settings" size={16}/></button>
      </nav>
    </header>
    <OwnFleetCard formations={formations} ships={ownShips} selectedIds={ids} hoverId={hoverId} onHover={setHoverId} onSelectShip={selectShip} onSelectFormation={selectFormation}
      airOpen={airOpen} {...(wings.length > 0 ? { aircraft: ownWing, onOpenAir: () => { setAirOpen(true); setFilter('aircraft'); } } : {})}/>
    <EnemyFleet tracks={observations} clusters={clusters} tick={tick} origin={origin} selectedId={contactId} onSelect={selectReport} nameOf={reportName} comparison={comparison}/>
    {data.tacticalPaused && <p className="fleet-command-paused" role="status">Tactical pause · Both fleets stopped · {game.simulation.queuedOrderCount ?? 0} orders queued for resume</p>}
    <FleetRoster formations={formations} ships={rosterShips} selectedIds={ids} hoverId={hoverId} onHover={setHoverId} onSelectShip={selectShip} onSelectFormation={selectFormation}/>
    <div className="fleet-command-ticker" role="status">{feedback && <p>{feedback}</p>}{receipts.map(r => <p key={r.sequence} data-state={r.state}>{ships.find(s => s.id === r.shipId)?.name ?? r.shipId} · {r.command.replaceAll('-', ' ')} {r.state}{r.message ? ` · ${r.message}` : ''}</p>)}</div>
    {railOpen && <AirRail
      carriers={wings.map(({ owner, wing }) => ({ id: owner.motion.id, name: nameFor(owner.motion.id), hull: ships.find(s => s.id === owner.motion.id)?.integrity ?? 0,
        kn: Math.round(Math.abs((owner.motion.speed ?? 0) * KNOTS_PER_MPS)), order: standingOrder(orders[owner.motion.id], nameFor), wing }))}
      flights={flights} planesOf={planesOf} selectedIds={game.selectedFlightIds} hoverId={hoverFlightId}
      armed={typeof armed === 'object' ? armed.kind : armed === 'search' ? 'search' : undefined} actionable={actionable} hasBoundary={!!boundary}
      search={{ radius: searchRadius, altitude: searchAltitude, policy: searchPolicy, setRadius: setSearchRadius, setAltitude: setSearchAltitude, setPolicy: setSearchPolicy }}
      onHover={setHoverFlightId} onSelect={selectAir} onVerb={onAirWheel}
      onFollowLead={f => game.followAircraft?.(planesOf(f).find(p => airborne(p))?.id ?? '')} canFollow={f => planesOf(f).some(p => airborne(p))}
      onCentre={f => game.centerAirMapOn(f.position[0], f.position[2])}
      onService={(groups, action) => { const accepted = groups.filter(f => game.commandDeck(f.id, action)); setArmed(undefined); setFeedback(`${accepted.length} group service orders queued`); }}
      onDeckPolicy={(id, policy) => { if (game.setDeckPolicy(id, policy)) setFeedback(`${nameFor(id)} · Deck policy order queued`); }}
      onPrioritize={(id, request) => { if (game.prioritizeDeckTask(id, request)) setFeedback(`${nameFor(id)} · Next deck task requested`); }}
      onCancelTask={(id, request) => { if (game.cancelDeckTask(id, request)) setFeedback(`${nameFor(id)} · Deck cancellation queued`); }}
      onClose={() => setAirOpen(false)}/>}
  </div>;
}
