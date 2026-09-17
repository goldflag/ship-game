import type { CombatTelemetry } from '../../game/session/telemetry';
import type { FleetActor, Aircraft } from '../../game/session/elements';
import type { ShipDefinition, Vec3 } from '../../ships/blueprint';
import type { ContactTrack } from '../../multiplayer/generated/ContactTrack';
import type { FleetOrderState } from '../../multiplayer/generated/FleetOrderState';
import type { Formation } from '../../multiplayer/generated/Formation';
import type { SearchAltitude } from '../../multiplayer/generated/SearchAltitude';
import type { SearchPolicy } from '../../multiplayer/generated/SearchPolicy';
import type { WeaponsPolicy } from '../../multiplayer/generated/WeaponsPolicy';
import type { OrderReceipt } from '../../game/session/commandQueue';
import { airWingTelemetry, type AirWingTelemetry, type FlightSummary } from '../../game/session/airTelemetry';
import { airborne } from '../../game/airWing';
import { KNOTS_PER_MPS } from '../../game/session/motion';
import { resolveShip } from '../../ships/localShips';
import { fleetFormations, type FleetFormation } from '../fleetFormations';
import { formationLabel, formationStations, STATION_RADIUS_M, type StationShip } from '../formationStations';
import { airClusters, battleComparison, type AirCluster, type BattleComparison } from '../fleetStats';
import { airStrikes, threatens, type AirStrike, type StrikeIntent } from '../airIntent';
import { reportName, reportPosition, reportState } from '../reconReports';
import { actionAvailable, SQUADRON_ACTIONS, squadronTargetOrder, type SquadronAction, type SquadronTarget } from '../airCommands';
import { SHIP_GLYPHS, shipClassOf, type ShipClass } from '../shipGlyphs';
import type { OwnFleetAircraft, OwnFleetShip } from '../OwnFleet';
import type { DeckServiceAction } from '../../game/session/BattleSession';
import type { ControlGroup, FleetChart, FleetDesk, FleetFrame, FleetOrder } from './fleetDesk';

export type { FleetFrame, FleetDesk, FleetOrder, FleetChart, ControlGroup } from './fleetDesk';

export type Contact = CombatTelemetry['contacts'][number];
export type FleetFlight = FlightSummary & { ownerId: string; carrierName: string };
export interface FleetWing { owner: FleetActor; wing: AirWingTelemetry }
export type ArmedOrder = 'search' | 'move' | 'escort' | 'focus' | SquadronAction;
/** A contact on the chart: an owned or physically seen hull, or a reported position. */
export interface FleetEnemy { id: string; name: string; x: number; z: number }
export type IssueOrder = (order: FleetOrder) => boolean;

export const FORMATION_HINT = 'Select every ship in one formation to set how it sails.';
export const LOITER_RADIUS_M = 700;
const HOLD_RADIUS_M = 500;
const SEARCH_TURNING_ROOM_M = 1500;
const HEALTH_SIGHTING_TICKS = 60;
const escortRadius = STATION_RADIUS_M;

/** What the fleet UI needs beyond the frame: the telemetry contacts, what the
 * player has in hand, the task groups, and which chart or hull the seat is on. */
export interface FleetViewInputs {
  combat: Pick<CombatTelemetry, 'contacts' | 'result'>;
  selectedShipIds: readonly string[];
  selectedFlightIds: readonly string[];
  controlGroups: ReadonlyMap<number, ControlGroup>;
  /** The chart is up; otherwise the seat follows or steers one hull. */
  mapOpen: boolean;
  spectatedShipId?: string;
  controlledShipId?: string;
}

export interface PendingRoute { points: Vec3[]; receipt: OrderReceipt; acceptedTick?: number }
export interface FleetCourse { points: Vec3[]; waypoints: Vec3[]; blocked: boolean; movement?: FleetOrderState['movement'];
  /** An escort's link to its station only means something on its own: the whole formation moves on the leader's route. */
  escortLink: boolean }
export interface FleetMarker { own: boolean; status?: string; warn: boolean; kn: number; hp: number; definition: ShipDefinition; glyph: { hull: string; mark: string };
  /** A column guide's label sits to port of its escorts astern; other guides ride above the marker. */
  side: 'port' | 'starboard' | 'above'; label: { x: number; anchor: 'end' | 'middle' | 'start'; y: number; barX: number; barY: number; orderY: number } }
export interface FleetBracket { members: Contact[]; points: Vec3[]; all: boolean }
export interface StragglerTag { leader: Contact; straggler: { shipId: string; availableSpeedMps: number; gapM: number }; ship?: Contact }

/** Everything the fleet-command surfaces render, derived once per frame from the
 * declared frame and the seat's inputs. Nothing here touches Three.js or React. */
export interface FleetView {
  frame: FleetFrame;
  tick: number;
  mapOpen: boolean;
  actionable: boolean;
  /** Owned hulls with duplicate class names numbered as the roster reads them. */
  ships: Contact[];
  afloat: Contact[];
  nameFor(id: string): string;
  actorOf(id: string): FleetActor | undefined;
  enemies: FleetEnemy[];
  observations: readonly ContactTrack[];
  observedModels: readonly NonNullable<FleetFrame['observedAircraft']>[number][];
  boundary?: { radiusM: number; warningMarginM: number };
  orders: Readonly<Record<string, FleetOrderState | undefined>>;
  scores: Readonly<Record<string, { damageDealt: number; frags: number } | undefined>>;
  receipts: OrderReceipt[];
  notices: readonly NonNullable<FleetFrame['fleetNotices']>[number][];
  formations: FleetFormation[];
  wings: FleetWing[];
  flights: FleetFlight[];
  ownPlanes: Aircraft[];
  selected: Contact[];
  selectedFlights: FleetFlight[];
  /** The hull the seat follows or steers off the chart, or the one selected ship on it. */
  subject?: Contact;
  /** Who a ship order goes to. */
  recipients: Contact[];
  lead?: Contact;
  /** The one group the whole selection is, when it is exactly one group. */
  selectedGroup?: FleetFormation;
  origin: { x: number; z: number };
  healthOf(track: ContactTrack): number | undefined;
  payloadOf(track: ContactTrack): boolean | undefined;
  clusters: AirCluster[];
  strikes: AirStrike[];
  strikeOf(trackId: string): AirStrike | undefined;
  threats: (AirStrike & { intent: StrikeIntent })[];
  interceptorFor(position: Vec3): FleetFlight | undefined;
  coverageTickAt(point?: [number, number]): number | undefined;
  stationShip(ship: { id: string; shipId: string }): StationShip;
  formationOf(id: string): Formation;
  standingOrderOf(id: string): string;
  speedKnOf(id: string): number;
  planesOf(flight: { aircraftIds: string[] }): Aircraft[];
  flightCentroid?: Vec3;
  ownShips: OwnFleetShip[];
  ownWing: OwnFleetAircraft;
  comparison: BattleComparison;
  stragglerTags: StragglerTag[];
  weaponsFree(kind: keyof WeaponsPolicy): boolean;
  leadRoute(pending: Readonly<Record<string, PendingRoute>>): Vec3[];
  moveOrigin(shiftHeld: boolean, leadRoute: Vec3[]): Vec3 | undefined;
  courseOf(ship: Contact, pending?: PendingRoute): FleetCourse;
  bracketOf(formation: FleetFormation): FleetBracket | undefined;
  markerOf(contact: Contact): FleetMarker;
  airReady(action: SquadronAction): boolean;
  searchReady(policy: SearchPolicy): boolean;
}

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
export const circlePoints = (x: number, z: number, radius: number): Vec3[] => Array.from({ length: 65 }, (_, i) => [x + Math.sin(i / 64 * Math.PI * 2) * radius, 0, z + Math.cos(i / 64 * Math.PI * 2) * radius]);
function routePoints(ship: Contact, order?: FleetOrderState, contacts: readonly Contact[] = []): Vec3[] {
  const task = order?.movement;
  const origin: Vec3 = [ship.x, 0, ship.z];
  if (task?.type === 'move') return [origin, [task.position[0], 0, task.position[1]]];
  if (task?.type === 'route') return [origin, ...task.waypoints.slice(order?.navigation?.waypoint ?? 0).map(([x, z]): Vec3 => [x, 0, z])];
  if (task?.type === 'hold-area') return circlePoints(task.position[0], task.position[1], task.radiusM);
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
/** A formation moves as one body, so its route leaves from its centre rather than the leader's bow. */
function centroid(members: { x: number; z: number }[]): Vec3 {
  return [members.reduce((n, m) => n + m.x, 0) / members.length, 0, members.reduce((n, m) => n + m.z, 0) / members.length];
}
const launchable = (f: FlightSummary) => !f.deck || f.active || f.deck.canLaunch;

export function fleetView(frame: FleetFrame, inputs: FleetViewInputs): FleetView {
  const { combat, mapOpen } = inputs;
  const tick = frame.tick;
  const actors = frame.actors;
  const actorOf = (id: string) => actors.find(a => a.motion.id === id);
  const owned = combat.contacts.filter(c => c.team === 'friendly');
  const ships = owned.map(s => {
    const same = owned.filter(other => other.name === s.name);
    return same.length > 1 ? { ...s, name: `${s.name} ${same.findIndex(other => other.id === s.id) + 1}` } : s;
  });
  const afloat = ships.filter(s => !s.physicalLost);
  const nameFor = (id: string) => ships.find(s => s.id === id)?.name ?? 'assigned leader';
  const observations = frame.observationTracks ?? [];
  const enemies: FleetEnemy[] = [...combat.contacts.filter(c => c.team === 'enemy' && !c.physicalLost), ...observations.map(c => ({ id: c.id, name: reportName(c), x: reportPosition(c, tick)[0], z: reportPosition(c, tick)[2] }))];
  const boundary = frame.missionRules?.area;
  const ids = inputs.selectedShipIds;
  const selected = ships.filter(s => ids.includes(s.id) && !s.physicalLost);
  const orders = frame.fleetOrders ?? {};
  const scores = frame.shipScores ?? {};
  const formations = fleetFormations(afloat, orders, inputs.controlGroups);
  const wings: FleetWing[] = actors.filter(a => a.team === 'friendly' && a.airWing).map(a => ({ owner: a, wing: airWingTelemetry(a, actors as FleetActor[])! }));
  const flights: FleetFlight[] = wings.flatMap(({ owner, wing }) => wing.groups.map(f => ({ ...f, ownerId: owner.motion.id, carrierName: nameFor(owner.motion.id) })));
  const selectedFlights = flights.filter(f => inputs.selectedFlightIds.includes(f.id));
  const ownPlanes = wings.flatMap(({ owner }) => owner.airWing!.planes.filter(airborne));
  const observedModels = frame.observedAircraft ?? [];
  const enemyHealth = new Map([...(frame.observedShips ?? []), ...observedModels]
    .filter(o => Number.isFinite(o.health) && tick - o.observedTick <= HEALTH_SIGHTING_TICKS)
    .map(o => [o.id, Math.max(0, Math.min(1, o.health))]));
  const healthOf = (c: ContactTrack) => reportState(c, tick) === 'current' ? enemyHealth.get(c.id) : undefined;
  const payloadOf = (c: ContactTrack) => reportState(c, tick) === 'current' ? observedModels.find(o => o.id === c.id)?.payload : undefined;
  const clusters = airClusters(observations, tick, 900, observedModels);
  // What observers can say about each reported air group: the weapons still slung
  // under current sightings, and the own ship its course is closing on.
  const strikes = airStrikes(clusters, observations, observedModels, tick, afloat.map(s => ({ id: s.id, name: nameFor(s.id), x: s.x, z: s.z })));
  const strikeOf = (trackId: string) => strikes.find(s => s.cluster.trackIds.includes(trackId));
  const threats = strikes.filter(threatens);
  /** The fighter group best placed to meet a contact: airborne and armed first, then ready on deck, nearest first. */
  const interceptorFor = (position: Vec3) => flights.filter(f => f.role === 'fighter' && f.armed > 0 && (f.active || f.deck?.canLaunch))
    .sort((a, b) => Number(b.active) - Number(a.active) || Math.hypot(a.position[0] - position[0], a.position[2] - position[2]) - Math.hypot(b.position[0] - position[0], b.position[2] - position[2]))[0];
  const coverage = frame.reconCoverage;
  const coverageTickAt = (point?: [number, number]) => point && coverage ? coverage.cells.find(c => Math.abs(c.x - point[0]) <= coverage.cellSizeM / 2 && Math.abs(c.z - point[1]) <= coverage.cellSizeM / 2)?.lastObservedTick : undefined;
  const subject = !mapOpen ? ships.find(s => s.id === inputs.spectatedShipId || s.id === inputs.controlledShipId) : selected.length === 1 ? selected[0] : undefined;
  const recipients = !mapOpen && subject ? [subject] : selected;
  const lead = recipients[0];
  const actionable = combat.result === 'active' && frame.phase === 'running';
  const receipts = frame.orderReceipts?.filter(r => r.command !== 'damage-control').slice(-2) ?? [];
  const definitionOf = (ship: { id: string; shipId: string }) => actorOf(ship.id)?.definition ?? resolveShip(ship.shipId);
  const stationShip = (ship: { id: string; shipId: string }): StationShip => ({ id: ship.id, shipClass: shipClassOf(definitionOf(ship)) });
  /** How the group containing this ship sails: what the picker last set, or how its escorts stand now. */
  const formationOf = (id: string): Formation => formations.find(f => f.shipIds.includes(id))?.formation ?? 'column';
  const standingOrderOf = (id: string) => standingOrder(orders[id], nameFor);
  const speedKnOf = (id: string) => Math.round(Math.abs((actorOf(id)?.motion.speed ?? 0) * KNOTS_PER_MPS));
  // The picker acts on one group, so it needs that whole group selected and nothing else.
  const selectedGroup = formations.find(f => f.shipIds.length === recipients.length && f.shipIds.every(id => recipients.some(s => s.id === id)));
  const origin = subject ?? lead ?? { x: frame.ship.x, z: frame.ship.z };
  const stragglerTags: StragglerTag[] = recipients.flatMap(s => (orders[s.id]?.navigation?.formation?.stragglers ?? []).map(straggler => ({ leader: s, straggler, ship: ships.find(c => c.id === straggler.shipId) })));
  const rosterShips: Omit<OwnFleetShip, 'shipClass' | 'order' | 'massKg'>[] = ships.map(s => {
    const wing = wings.find(w => w.owner.motion.id === s.id)?.wing, status = orders[s.id]?.navigation?.status;
    return { id: s.id, name: s.name, hull: s.integrity, kn: speedKnOf(s.id), damageDealt: scores[s.id]?.damageDealt ?? 0, frags: scores[s.id]?.frags ?? 0, lost: s.physicalLost,
      routeBlocked: !s.physicalLost && status === 'blocked',
      warn: !s.physicalLost && (s.integrity < .5 || status === 'straggling' || status === 'blocked' || status === 'immobile' || status === 'leader-lost'),
      aircraft: wing ? { remaining: Object.values(wing.counts).reduce((n, v) => n + v, 0) - wing.counts.lost - wing.counts.withdrawn, total: Object.values(wing.counts).reduce((n, v) => n + v, 0) } : undefined };
  });
  const ownAircraft = rosterShips.reduce((sum, s) => ({ remaining: sum.remaining + (s.aircraft?.remaining ?? 0), total: sum.total + (s.aircraft?.total ?? 0) }), { remaining: 0, total: 0 });
  // The corner card is the whole order of battle: each ship's class glyph, score,
  // the standing order and the tonnage the comparison counts.
  const ownShips: OwnFleetShip[] = rosterShips.map(s => ({
    ...s, warn: !!s.warn, shipClass: shipClassOf(definitionOf(ships.find(c => c.id === s.id)!)),
    order: standingOrderOf(s.id), massKg: actorOf(s.id)?.definition.hull.massKg ?? 0,
  }));
  const ownWing: OwnFleetAircraft = {
    remaining: ownAircraft.remaining, total: ownAircraft.total,
    airborne: wings.reduce((n, { wing }) => n + wing.groups.reduce((m, f) => m + f.airborne, 0), 0),
    onDeck: wings.reduce((n, { wing }) => n + wing.onDeck, 0), inHangar: wings.reduce((n, { wing }) => n + wing.inHangar, 0),
  };
  const comparison = battleComparison({
    own: ships.map(s => { const a = actorOf(s.id); return { id: s.id, massKg: a?.definition.hull.massKg ?? 0, integrity: a?.damage.integrity ?? 0, maxIntegrity: a?.damage.maxIntegrity ?? 0, lost: s.physicalLost }; }),
    scores, tracks: observations, massOf: id => resolveShip(id).hull.massKg, enemyLostShips: combat.contacts.filter(c => c.team === 'enemy' && c.physicalLost).length, ownAircraft, enemyAircraftLost: frame.aircraftLosses?.enemy,
  });
  const planesOf = (flight: { aircraftIds: string[] }) => wings.flatMap(({ owner }) => owner.airWing!.planes.filter(p => flight.aircraftIds.includes(p.id)));
  const flightCentroid = selectedFlights.length ? selectedFlights.reduce<Vec3>((sum, f) => [sum[0] + f.position[0] / selectedFlights.length, sum[1] + f.position[1] / selectedFlights.length, sum[2] + f.position[2] / selectedFlights.length], [0, 0, 0]) : undefined;
  const weaponsFree = (kind: keyof WeaponsPolicy) => recipients.every(s => orders[s.id]?.weapons[kind]);
  const leadRoute = (pending: Readonly<Record<string, PendingRoute>>): Vec3[] => lead ? pending[lead.id]?.points ?? (orders[lead.id]?.movement.type === 'route' ? routePoints(lead, orders[lead.id], ships) : []) : [];
  const moveOrigin = (shiftHeld: boolean, route: Vec3[]): Vec3 | undefined => shiftHeld && route.length > 1 ? route.at(-1)! : recipients.length > 1 ? centroid(recipients) : lead ? [lead.x, 0, lead.z] : undefined;
  const courseOf = (s: Contact, pending?: PendingRoute): FleetCourse => {
    const movement = orders[s.id]?.movement;
    const blocked = !pending && orders[s.id]?.navigation?.status === 'blocked';
    const led = formations.find(f => f.leaderId === s.id && f.shipIds.length > 1);
    const body = led ? ships.filter(m => led.shipIds.includes(m.id) && !m.physicalLost) : [];
    let points = pending ? pending.points : routePoints(s, orders[s.id], ships);
    if (!blocked && body.length > 1 && (pending || movement?.type === 'route') && points.length > 1) points = [centroid(body), ...points.slice(1)];
    const waypoints = pending || movement?.type === 'route' ? points.slice(1) : [];
    const own = formations.find(f => f.shipIds.includes(s.id));
    const alone = ids.includes(s.id) && !(own && own.shipIds.length > 1 && own.shipIds.every(id => ids.includes(id)));
    return { points, waypoints, blocked, movement, escortLink: !blocked && movement?.type === 'escort' && !alone };
  };
  const bracketOf = (f: FleetFormation): FleetBracket | undefined => {
    const members = ships.filter(s => f.shipIds.includes(s.id));
    if (!members.length) return undefined;
    return { members, points: bracketPoints(members), all: members.every(m => ids.includes(m.id)) };
  };
  const markerOf = (s: Contact): FleetMarker => {
    const own = s.team === 'friendly', status = orders[s.id]?.navigation?.status;
    const warn = own && (s.integrity < .5 || status === 'straggling' || status === 'blocked' || status === 'immobile');
    // A column guide's label sits to port: its escorts are astern (a double column keeps
    // its second column to starboard) and their own labels run to starboard. Triple column,
    // screen and line abreast take both beams, so the guide's label rides above the marker.
    const guide = own ? formations.find(f => f.leaderId === s.id && f.shipIds.length > 1) : undefined;
    const side = !guide ? 'starboard' : guide.formation === 'column' || guide.formation === 'double-column' ? 'port' : 'above';
    const label = side === 'port' ? { x: -14, anchor: 'end' as const, y: -3, barX: -54, barY: 2, orderY: 17 }
      : side === 'above' ? { x: 0, anchor: 'middle' as const, y: -32, barX: -20, barY: -27, orderY: -16 }
      : { x: 14, anchor: 'start' as const, y: -3, barX: 14, barY: 2, orderY: 17 };
    const definition = (own ? actorOf(s.id)?.definition : undefined) ?? resolveShip(s.shipId);
    return { own, status, warn, kn: own ? speedKnOf(s.id) : 0, hp: Math.max(0, Math.min(1, s.integrity)), definition, glyph: SHIP_GLYPHS[shipClassOf(definition) as ShipClass], side, label };
  };
  const airReady = (a: SquadronAction) => selectedFlights.some(f => actionAvailable(a, f.role) && launchable(f));
  const searchReady = (policy: SearchPolicy) => selectedFlights.some(f => (policy !== 'strike' || f.role !== 'fighter') && launchable(f));
  return { frame, tick, mapOpen, actionable, ships, afloat, nameFor, actorOf, enemies, observations, observedModels, boundary, orders, scores, receipts, notices: frame.fleetNotices ?? [],
    formations, wings, flights, ownPlanes, selected, selectedFlights, subject, recipients, lead, selectedGroup, origin, healthOf, payloadOf, clusters, strikes, strikeOf, threats, interceptorFor, coverageTickAt,
    stationShip, formationOf, standingOrderOf, speedKnOf, planesOf, flightCentroid, ownShips, ownWing, comparison, stragglerTags, weaponsFree, leadRoute, moveOrigin, courseOf, bracketOf, markerOf, airReady, searchReady };
}

// ---- Gesture → order. Each function turns one player gesture into the orders it
// means, through the door, and returns the feedback line the ticker shows. What
// the chart keeps in hand afterwards (armed order, selection) stays with the chart.

/** Station a guide's escorts from the formation table: role-ordered offsets scaled to
 * the guide's hull, each order carrying its formation and the slot that decides who
 * takes the guide next. Returns the number of orders sent. */
export function stationEscorts(issue: IssueOrder, leaderId: string, formation: Formation, members: readonly StationShip[]): number {
  const guide = members.find(m => m.id === leaderId), followers = members.filter(m => m.id !== leaderId);
  if (!guide || !followers.length) return 0;
  const stations = formationStations(formation, guide, followers);
  stations.forEach(station => issue({ kind: 'escort', shipId: station.id, leaderId, offset: station.offset, radiusM: escortRadius, formation, slot: station.slot }));
  return stations.length;
}
/** Setting a group's formation is one act: the group records how it sails, and every
 * escort takes a fresh station under the same guide. Returns the order feedback. */
export function applyGroupFormation(desk: Pick<FleetDesk, 'controlGroups' | 'issue'>, group: FleetFormation, formation: Formation, members: readonly StationShip[]): string {
  const held = desk.controlGroups.get(group.index);
  desk.issue({ kind: 'control-group', index: group.index, group: { name: held?.name ?? `Group ${group.index}`, shipIds: held?.shipIds ?? [...group.shipIds], formation } });
  const queued = stationEscorts(desk.issue, group.leaderId, formation, members);
  return queued ? `${queued} escort orders queued · ${formationLabel(formation)}` : `${group.name} · ${formationLabel(formation)} · no escorts to station`;
}
/** Escort orders for the recipients under the named guide, in the guide's formation. */
export function sendEscort(view: FleetView, issue: IssueOrder, leaderId: string): string {
  const guide = view.ships.find(s => s.id === leaderId);
  const formation = view.formationOf(leaderId);
  const queued = guide ? stationEscorts(issue, leaderId, formation, [guide, ...view.recipients.filter(s => s.id !== leaderId)].map(view.stationShip)) : 0;
  return queued ? `${queued} escort orders queued · ${formationLabel(formation)}` : 'Choose a leader outside the selection.';
}
/** One destination for the lead, or an extra waypoint on its route; the rest of the
 * selection is stationed on the lead. The receipt the session hands back keeps the
 * queued path visible until an authoritative frame carries it. */
export function sendRoute(view: FleetView, issue: IssueOrder, point: [number, number], speedKn: number, appendRequested: boolean, previous: Vec3[]): { note: string; pending?: PendingRoute } {
  const { lead, recipients, frame } = view;
  if (!lead) return { note: 'Select ships before giving a destination.' };
  const append = appendRequested && previous.length > 1;
  const points: Vec3[] = append ? [...previous, [point[0], 0, point[1]]] : [[lead.x, 0, lead.z], [point[0], 0, point[1]]];
  const before = frame.orderReceipts?.at(-1);
  issue({ kind: 'route', shipId: lead.id, point, speedMps: speedKn / KNOTS_PER_MPS, append });
  const receipt = frame.orderReceipts?.at(-1);
  // Capture the exact object now, outside React's deferred state updater.
  const pending = receipt && receipt !== before && receipt.shipId === lead.id && receipt.command === 'route' ? { points, receipt } : undefined;
  if (recipients.length > 1) sendEscort(view, issue, lead.id);
  return { note: `${append ? 'Waypoint appended' : 'Route queued'} · ${speedKn} kn${recipients.length > 1 ? ` · ${formationLabel(view.formationOf(lead.id))}` : ''}`, pending };
}
export function sendHold(view: FleetView, issue: IssueOrder): string {
  view.recipients.forEach(s => issue({ kind: 'hold-area', shipId: s.id, position: [s.x, s.z], radiusM: HOLD_RADIUS_M }));
  return `${view.recipients.length} hold orders queued · ${HOLD_RADIUS_M} m station area`;
}
export function sendFocus(view: FleetView, issue: IssueOrder, targetId: string): string {
  view.recipients.forEach(s => issue({ kind: 'focus', shipId: s.id, targetId }));
  return `${view.recipients.length} focus orders queued · Movement unchanged`;
}
export function setGroupFormation(view: FleetView, desk: Pick<FleetDesk, 'controlGroups' | 'issue'>, formation: Formation): string {
  const group = view.selectedGroup;
  if (!group || !view.actionable) return FORMATION_HINT;
  return applyGroupFormation(desk, group, formation, view.ships.filter(s => group.shipIds.includes(s.id) && !s.physicalLost).map(view.stationShip));
}
export function toggleWeapons(view: FleetView, issue: IssueOrder, kind: keyof WeaponsPolicy): void {
  const free = view.weaponsFree(kind);
  view.recipients.forEach(s => issue({ kind: 'weapons', shipId: s.id, policy: { ...(view.orders[s.id]?.weapons ?? { guns: true, aa: true, torpedoes: false }), [kind]: !free } }));
}
/** The armed air order aimed at a unit or the water: compatible roles first, then
 * readiness, then what the session took, each shortfall counted in the feedback. */
export function sendAirOrder(view: FleetView, issue: IssueOrder, armed: SquadronAction | undefined, target: SquadronTarget): { note: string; sent: boolean } {
  const order = squadronTargetOrder(armed?.kind, target);
  if (!order) return { note: `Choose ${armed ? armed.target : 'a compatible target'}.`, sent: false };
  const command = SQUADRON_ACTIONS.find(a => a.kind === order.kind);
  const chosen = view.selectedFlights;
  const compatible = chosen.filter(f => !command || actionAvailable(command, f.role));
  const ready = compatible.filter(launchable);
  const queued = ready.filter(f => issue({ kind: 'squadron', flightId: f.id, order }));
  return { sent: true, note: [`${queued.length} air group orders queued`,
    compatible.length < chosen.length && `${chosen.length - compatible.length} incompatible groups skipped`,
    ready.length < compatible.length && `${compatible.length - ready.length} groups not ready to launch`,
    queued.length < ready.length && `${ready.length - queued.length} groups unavailable`,
  ].filter(Boolean).join(' · ') };
}
export interface SearchSettings { radiusM: number; altitude: SearchAltitude; policy: SearchPolicy }
export function sendSearch(view: FleetView, issue: IssueOrder, center: [number, number], search: SearchSettings): { note: string; sent: boolean } {
  if (view.boundary && Math.hypot(...center) + search.radiusM + SEARCH_TURNING_ROOM_M > view.boundary.radiusM) return { note: 'The search area needs 1.5 km of turning room inside the battle boundary.', sent: false };
  const compatible = view.selectedFlights.filter(f => search.policy !== 'strike' || f.role !== 'fighter');
  const ready = compatible.filter(launchable);
  const queued = ready.filter(f => issue({ kind: 'squadron', flightId: f.id, order: { kind: 'search-area', center, radiusM: search.radiusM, altitude: search.altitude, policy: search.policy } }));
  return { sent: true, note: [`${queued.length} search orders queued`, compatible.length < view.selectedFlights.length && `${view.selectedFlights.length - compatible.length} fighter groups skipped`, ready.length < compatible.length && `${compatible.length - ready.length} groups not ready`, queued.length < ready.length && `${ready.length - queued.length} groups unavailable`].filter(Boolean).join(' · ') };
}
export function sendReturn(view: FleetView, issue: IssueOrder): string {
  view.selectedFlights.filter(f => f.active).forEach(f => issue({ kind: 'squadron', flightId: f.id, order: { kind: 'return' } }));
  return 'Return orders queued';
}
export function sendDeckService(issue: IssueOrder, groups: readonly { id: string }[], action: DeckServiceAction): string {
  const accepted = groups.filter(f => issue({ kind: 'deck-service', flightId: f.id, action }));
  return `${accepted.length} group service orders queued`;
}

/** What a click on a hull means with the given order armed. */
export type ShipGesture = { act: 'feedback'; text: string } | { act: 'air'; target: SquadronTarget } | { act: 'escort'; leaderId: string }
  | { act: 'select-ship'; id: string; additive: boolean } | { act: 'focus'; targetId: string } | { act: 'inspect'; id: string; target: boolean };
export function shipGesture(view: FleetView, ship: Pick<Contact, 'id' | 'team'>, o: { right: boolean; additive: boolean; armed?: ArmedOrder }): ShipGesture {
  const { armed, right } = o;
  if (armed === 'search') return { act: 'feedback', text: 'Choose water for the center of the search area.' };
  const report = view.observations.find(c => c.id === ship.id);
  if (report?.visibleCondition?.sinking && (right || armed)) return { act: 'feedback', text: 'Sinking already confirmed.' };
  if (!view.selectedFlights.length && report?.status === 'stale' && (right || armed)) return { act: 'feedback', text: 'Report is stale. Search its last reported area before attacking.' };
  if (view.selectedFlights.length && (right || typeof armed === 'object')) return { act: 'air', target: { kind: 'ship', id: ship.id, team: ship.team } };
  if (ship.team === 'friendly') return right || armed === 'escort' ? { act: 'escort', leaderId: ship.id } : { act: 'select-ship', id: ship.id, additive: o.additive };
  if (right || armed === 'focus') return { act: 'focus', targetId: ship.id };
  return { act: 'inspect', id: ship.id, target: true };
}
/** What a click on a report means: a surface report is a hull; an aircraft report takes an intercept or opens. */
export function reportGesture(view: FleetView, report: ContactTrack, o: { right: boolean; armed?: ArmedOrder }): ShipGesture {
  const { armed, right } = o;
  if (armed === 'search') return { act: 'feedback', text: 'Choose water for the center of the search area.' };
  if (report.kind === 'surface') return shipGesture(view, { id: report.id, team: 'enemy' }, { right, additive: false, armed });
  if (view.selectedFlights.length && (right || typeof armed === 'object')) return { act: 'air', target: { kind: 'squadron', id: report.id, team: 'enemy' } };
  if (right || armed) return { act: 'feedback', text: 'Select a fighter group and Intercept, then choose an aircraft contact.' };
  return { act: 'inspect', id: report.id, target: false };
}

export type FleetWaterAction = 'search' | 'air' | 'cancel-move' | 'move' | 'clear';
/** What a click on open water does on the fleet chart. A destination spends the
 * selection: a plain click sends the ships and hands them back, Shift keeps them in
 * hand to extend the route, and the right button leaves the move without ordering. */
export function fleetWaterAction(armed: 'move' | 'search' | 'squadron' | 'other' | undefined,
  o: { right: boolean; shift: boolean; flights: boolean; lead: boolean }): FleetWaterAction | undefined {
  if (o.flights && armed === 'search') return 'search';
  if (o.flights && (o.right || armed === 'squadron')) return 'air';
  if (armed === 'move') return o.right ? 'cancel-move' : 'move';
  if (o.right || (!armed && o.shift && o.lead && !o.flights)) return 'move';
  return armed ? undefined : 'clear';
}
export function fleetDragMode(button: number, shift: boolean, orbit: boolean, armed: boolean): 'select' | 'orbit' | 'pan' {
  return button === 0 && shift && !armed ? 'select' : button === 1 || orbit ? 'orbit' : 'pan';
}
interface Candidate { id: string; position: Vec3 }
/** Select a flight when any of its displayed planes is enclosed. The active tab
 * breaks ties only when the box contains both ships and aircraft. */
export function fleetBoxSelection(ships: readonly Candidate[], planes: readonly (Candidate & { flightId: string })[],
  preferred: 'ships' | 'aircraft', contains: (position: Vec3) => boolean): { kind: 'ships' | 'aircraft'; ids: string[] } {
  const shipIds = ships.filter(s => contains(s.position)).map(s => s.id);
  const flightIds = [...new Set(planes.filter(p => contains(p.position)).map(p => p.flightId))];
  const kind = flightIds.length && (!shipIds.length || preferred === 'aircraft') ? 'aircraft' : shipIds.length ? 'ships' : preferred;
  return { kind, ids: kind === 'aircraft' ? flightIds : shipIds };
}
/** The box drawn over the chart, resolved against the afloat hulls and airborne planes
 * of the view; Ctrl/Cmd keeps what was already in hand. */
export function boxSelect(view: FleetView, preferred: 'ships' | 'aircraft', contains: (position: Vec3) => boolean, held?: { shipIds: readonly string[]; flightIds: readonly string[] }): { kind: 'ships' | 'aircraft'; ids: string[] } {
  const selection = fleetBoxSelection(
    view.afloat.map(s => ({ id: s.id, position: [s.x, 0, s.z] })),
    view.ownPlanes.filter(p => !!p.flightId).map(p => ({ id: p.id, flightId: p.flightId!, position: p.position })),
    preferred, contains);
  if (selection.kind === 'ships') return { kind: 'ships', ids: [...new Set([...(held?.shipIds ?? []), ...selection.ids])] };
  return { kind: 'aircraft', ids: [...(held?.flightIds ?? []), ...selection.ids] };
}

/** An acknowledgement can precede its worker snapshot. Keep the queued path
 * through that interval, then let the next authoritative frame own the path. */
export function advancePendingRoute(route: PendingRoute, tick: number): PendingRoute | undefined {
  if (route.receipt.state === 'rejected' || route.receipt.state === 'superseded') return;
  if (route.receipt.state !== 'accepted') return route;
  if (route.acceptedTick === undefined) return { ...route, acceptedTick: tick };
  return tick > route.acceptedTick ? undefined : route;
}
/** Receipt references survive display-history eviction. Accepted routes remain
 * visible until an authority frame after acknowledgement has been consumed; a
 * lost hull's route goes with it. Returns the same object when nothing changed. */
export function advancePendingRoutes(routes: Record<string, PendingRoute>, view: Pick<FleetView, 'afloat' | 'tick'>): Record<string, PendingRoute> {
  const next = { ...routes }; let changed = false;
  for (const [id, pending] of Object.entries(routes)) {
    const updated = view.afloat.some(s => s.id === id) ? advancePendingRoute(pending, view.tick) : undefined;
    if (updated !== pending) { if (updated) next[id] = updated; else delete next[id]; changed = true; }
  }
  return changed ? next : routes;
}
/** A lost guide hands the group on to the next ship in its station table. The CPU
 * raises the notice; the group re-forms under the new guide from its escort orders.
 * The CPU names the hull class; the roster name ("Fletcher 2") is what the player reads. */
export function nextNotice(view: Pick<FleetView, 'notices' | 'ships'>, seen: number): { seen: number; text?: string } {
  const notices = view.notices;
  const count = notices.length;
  if (count < seen) seen = 0;
  if (count > seen) {
    const last = notices[count - 1], ship = view.ships.find(s => s.id === last.shipId);
    return { seen: count, text: last.kind === 'guide-assumed' && ship ? `${ship.name} has the guide` : last.text };
  }
  return { seen: count };
}

// ---- Chart projection. Markers carry a world position; live poses read the chart.

export function projectAirMarker(chart: Pick<FleetChart, 'projectAircraft' | 'projectContact' | 'projectContactGroup' | 'projectFleetShip' | 'projectAirMap'>, marker: DOMStringMap, [x, y, z]: Vec3): [number, number] | null {
  if (marker.plane) return chart.projectAircraft(marker.plane);
  if (marker.track) return chart.projectContact(marker.track);
  if (marker.contactGroup) return chart.projectContactGroup(JSON.parse(marker.contactGroup) as string[]);
  if (marker.contactMarker) return chart.projectContact(marker.contactMarker);
  // Own hulls anchor above their rendered top: with the camera level with the water the
  // sea-level point sits on the hull, and the label would cover the ship it names.
  return (marker.shipMarker && chart.projectFleetShip(marker.shipMarker)) || chart.projectAirMap(x, z, y);
}
/** Project both ends of the direction from one pose, independently of label interpolation. */
export function projectMapHeading(chart: Pick<FleetChart, 'projectAirMap'>, position: Vec3, heading: number): number | undefined {
  const [x, y, z] = position;
  const origin = chart.projectAirMap(x, z, y);
  const forward = chart.projectAirMap(x + Math.sin(heading) * 10, z - Math.cos(heading) * 10, y);
  return origin && forward ? Math.atan2(forward[0] - origin[0], origin[1] - forward[1]) * 180 / Math.PI : undefined;
}
