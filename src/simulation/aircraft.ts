import type { AirOrder as NativeAirOrder } from '../multiplayer/generated/AirOrder';
import { physicalLoss } from '../game/session/battleRules';
import type { ShipDefinition, Vec3 } from '../ships/blueprint';
import type { FleetActor, Team } from './battle';
import type { CombatEvent } from './combat';
import type { Shell } from './damage';
import { add, clamp, length, localToWorld, scale, sub, worldToLocal } from '../game/geometry';
import { equipmentCondition } from '../game/machinery';
import { motionVelocity } from '../game/session/motion';
import { type Torpedo } from '../game/torpedoAim';
import { initialFlightControls, TAKEOFF_ROLL_SECONDS } from './aircraftFlight';
import { initialAirPilot, type AirPilot } from './aircraftTactics';
import { aircraftDeckAttitude, aircraftGroundPose } from '../game/aircraftGroundPose';
import { DEFAULT_AIR_TORPEDO } from '../ships/aircraftWeapons';

/** Declared with the frame, in Rust (`naval_sim::aircraft`); the engine's
 * plane keeps its pilot, which the frame publishes as `behavior`. */
export type { FlightPhase, AirFlight, DeckStatus, AirRelease } from '../game/session/elements';
export type AirOrder = NativeAirOrder;
import type { Aircraft as SessionAircraft, AirWingState as SessionAirWingState, FleetActor as SessionActor, AirFlight, AirRelease } from '../game/session/elements';
import { hasFoldingWings, AIRCRAFT_ENDURANCE_SECONDS, FIGHTER_AMMO_BURSTS, AIRCRAFT_REPAIR_HP, aircraftServiceSeconds, deckClearance, flightSize, deckCapacity, terminalAircraft, activeFlight, airborne, aircraftDeckSpot, onFlightDeck, airServiceAvailable, squadronFlights, recoveryQueue } from '../game/airWing';
export { hasFoldingWings, AIRCRAFT_ENDURANCE_SECONDS, FIGHTER_AMMO_BURSTS, AIRCRAFT_REPAIR_HP, aircraftServiceSeconds, deckClearance, flightSize, deckCapacity, terminalAircraft, activeFlight, airborne, aircraftDeckSpot, onFlightDeck, airServiceAvailable, squadronFlights, recoveryQueue } from '../game/airWing';
export interface Aircraft extends SessionAircraft { kills: number; pilot: AirPilot; }
export interface AirWingState extends SessionAirWingState { planes: Aircraft[]; }
function deckPose(p: Aircraft, actor: FleetActor, local: Vec3) {
  p.deckPosition = [...local]; p.position = localToWorld(local, actor.motion);
  p.deckHeading = 0;
  Object.assign(p, aircraftDeckAttitude(actor.motion, p.modelId));
  p.velocity = motionVelocity(actor.motion);
}
function taxi(p: Aircraft, actor: FleetActor, destination: Vec3, speed: number, dt: number): boolean {
  const current = p.deckPosition ?? worldToLocal(p.position, actor.motion);
  const delta = sub(destination, current), distance = length(delta);
  const local = add(current, scale(delta, Math.min(1, speed * dt / (distance || 1))));
  deckPose(p, actor, local);
  if (distance > .1) {
    p.deckHeading = Math.atan2(delta[0], -delta[2]);
    Object.assign(p, aircraftDeckAttitude(actor.motion, p.modelId, p.deckHeading));
  }
  return distance <= speed * dt;
}
export function createAirWing(def: ShipDefinition, ownerId: string, team: Team): AirWingState | undefined {
  if (!def.airWing) return;
  const state: AirWingState = { launchCooldown: 0, flights: [], flightSequence: 0, transferCooldown: 0, planes: def.airWing.squadrons.flatMap(s => Array.from({ length: s.count }, (_, i) => ({
    id: `${ownerId}/${s.id}/${i + 1}`, ownerId, team, squadronId: s.id, modelId: s.modelId, role: s.role,
    phase: 'ready' as const, wingFold: hasFoldingWings(s.modelId) ? 1 : 0, position: [0, 0, 0] as Vec3, previousPosition: [0, 0, 0] as Vec3, velocity: [0, 0, 0] as Vec3,
    heading: 0, pitch: 0, bank: 0, hp: 100, ammo: s.role === 'fighter' ? FIGHTER_AMMO_BURSTS : 0, payload: s.role !== 'fighter', timer: 0, flightTime: 0, cooldown: 0, kills: 0,
    controls: initialFlightControls(), pilot: initialAirPilot(),
  }))) };
  return state;
}
function validAirOrder(actor: FleetActor, flightId: string, planes: Aircraft[], order: AirOrder, actors: FleetActor[]) {
  if (order.kind === 'return') return true;
  if (order.kind === 'strike' || order.kind === 'intercept-contact' || order.kind === 'search-area') return false; // Rust observation-mode orders.
  if (!planes.length || planes.some(p => p.flightTime > 470 || p.hp < 25)) return false;
  if (order.kind === 'patrol') return order.point.length === 3 && order.point.every(Number.isFinite)
    && Math.hypot(order.point[0] - actor.motion.x, order.point[2] - actor.motion.z) <= 30000;
  if (order.kind === 'attack') {
    const target = actors.find(a => a.motion.id === order.targetId);
    return !!target && target.team !== actor.team && !physicalLoss(target) && target.motion.y >= -8
      && planes.every(p => p.role !== 'fighter' && p.payload);
  }
  if (planes.some(p => p.role !== 'fighter' || p.ammo <= 0)) return false;
  if (order.kind === 'defend') return !order.targetId || actors.some(a => a.motion.id === order.targetId && a.team === actor.team && !physicalLoss(a));
  return order.flightId !== flightId && actors.some(a => (order.kind === 'escort' ? a.team === actor.team : a.team !== actor.team)
    && a.airWing?.flights.some(f => f.id === order.flightId && activeFlight(f, a.airWing!.planes)));
}
export function launchSquadron(actor: FleetActor, squadronId: string, target?: FleetActor, requestedOrder?: AirOrder, actors: FleetActor[] = target ? [actor, target] : [actor], flightId?: string): number {
  if (!airServiceAvailable(actor)) return 0;
  const state = actor.airWing!;
  if (state.flights.filter(f => activeFlight(f, state.planes)).length >= actor.definition.airWing!.maxActiveFlights) return 0;
  const flight = squadronFlights(actor).find(f => f.squadronId === squadronId && (!flightId || f.id === flightId)
    && state.planes.filter(p => f.planeIds.includes(p.id) && p.phase !== 'lost').length > 0
    && state.planes.filter(p => f.planeIds.includes(p.id)).every(p => p.phase === 'ready' || p.phase === 'lost'));
  if (!flight) return 0;
  const planes = state.planes.filter(p => flight.planeIds.includes(p.id) && p.phase === 'ready');
  const order: AirOrder = requestedOrder ?? (planes[0].role === 'fighter' ? { kind: 'defend' } : { kind: 'attack', targetId: target?.motion.id ?? '' });
  // Ready aircraft have already refuelled, so their previous sortie age is irrelevant.
  if (order.kind === 'return' || !validAirOrder(actor, flight.id, planes.map(p => ({ ...p, flightTime: 0 })), order, actors)) return 0;
  flight.order = structuredClone(order); flight.notice = undefined;
  state.flights = state.flights.filter(f => f.id !== flight.id);
  state.flights.push(flight); state.flightSequence++;
  for (const plane of planes) {
    plane.sortie = (plane.sortie ?? 0) + 1;
    plane.phase = 'queued'; plane.flightId = flight.id; plane.targetId = order.kind === 'attack' ? order.targetId : undefined;
    plane.pilot = initialAirPilot(); plane.flightTime = 0; plane.timer = 0;
    plane.recoveryRequestedAt = undefined; plane.lossReason = undefined;
  }
  return planes.length;
}
/** One command path for a ready squadron's launch and an airborne squadron's retask. */
export function commandSquadron(actor: FleetActor, id: string, order: AirOrder, actors: FleetActor[]): boolean {
  const flight = squadronFlights(actor).find(f => f.id === id);
  if (!flight) return false;
  return activeFlight(flight, actor.airWing!.planes) ? orderFlight(actor, id, order, actors)
    : launchSquadron(actor, flight.squadronId, undefined, order, actors, id) > 0;
}
export function recallAircraft(actor: FleetActor, flightId?: string): void {
  for (const flight of actor.airWing?.flights ?? []) if (!flightId || flight.id === flightId) { flight.order = { kind: 'return' }; flight.notice = 'Recalled'; }
  for (const p of actor.airWing?.planes ?? []) {
    if (flightId && p.flightId !== flightId) continue;
    if (p.phase === 'queued') { p.phase = 'ready'; p.deckSlot = undefined; p.deckPosition = undefined; }
    else if (p.phase === 'taxi' || (p.phase === 'takeoff' && onFlightDeck(p))) p.phase = 'parking';
    else if (airborne(p) && p.phase !== 'landing') p.phase = 'returning';
  }
}
export function orderFlight(actor: FleetActor, flightId: string, order: AirOrder, actors: FleetActor[]): boolean {
  const flight = actor.airWing?.flights.find(f => f.id === flightId);
  if (!flight || !activeFlight(flight, actor.airWing!.planes) || physicalLoss(actor)) return false;
  if (order.kind === 'return') { recallAircraft(actor, flightId); return true; }
  const planes = actor.airWing!.planes.filter(p => p.flightId === flightId && ['queued', 'taxi', 'takeoff', 'outbound', 'attack', 'returning'].includes(p.phase));
  if (!planes.length || planes.some(p => p.flightTime > 470 || p.hp < 25)) return false;
  if (!validAirOrder(actor, flightId, planes, order, actors)) return false;
  flight.order = structuredClone(order); flight.notice = undefined;
  for (const p of planes) {
    p.targetId = order.kind === 'attack' ? order.targetId : undefined; p.pilot = initialAirPilot(); p.recoveryRequestedAt = undefined;
    if (['outbound', 'attack', 'returning'].includes(p.phase)) p.phase = 'outbound';
  }
  return true;
}
/** Oldest requests first, with emergency endurance ahead of ordinary traffic. */
export const AIR_TORPEDO = DEFAULT_AIR_TORPEDO;
export interface AirContext {
  seed?: number;
  actors: FleetActor[]; planes: Aircraft[]; shells: Shell[]; torpedoes: Torpedo[]; releases: AirRelease[];
  nextId: () => number; emit: (e: Omit<CombatEvent, 'sequence' | 'tick'>) => void;
}
