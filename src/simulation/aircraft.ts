import type { AirOrder as NativeAirOrder } from '../multiplayer/generated/AirOrder';
import { physicalLoss } from './battleRules';
import type { ShipDefinition, Vec3 } from '../ships/blueprint';
import type { FleetActor, Team } from './battle';
import type { CombatEvent } from './combat';
import type { Shell } from './damage';
import { add, clamp, length, localToWorld, scale, sub, worldToLocal } from './geometry';
import { equipmentCondition } from './machinery';
import { motionVelocity } from './ship';
import { type Torpedo } from './torpedoes';
import { initialFlightControls, TAKEOFF_ROLL_SECONDS } from './aircraftFlight';
import { initialAirPilot, type AirPilot } from './aircraftTactics';
import { aircraftDeckAttitude, aircraftGroundPose } from './aircraftGroundPose';
import { DEFAULT_AIR_TORPEDO } from './aircraftWeapons';

/** Declared with the frame, in Rust (`naval_sim::aircraft`); the engine's
 * plane keeps its pilot, which the frame publishes as `behavior`. */
export type { FlightPhase, AirFlight, DeckStatus, AirRelease } from '../game/session/elements';
export type AirOrder = NativeAirOrder;
import type { Aircraft as SessionAircraft, AirWingState as SessionAirWingState, FleetActor as SessionActor, AirFlight, AirRelease } from '../game/session/elements';
export interface Aircraft extends SessionAircraft { kills: number; pilot: AirPilot; }
export interface AirWingState extends SessionAirWingState { planes: Aircraft[]; }
export const hasFoldingWings = (modelId: string) => aircraftGroundPose(modelId).foldingWings;
export const AIRCRAFT_ENDURANCE_SECONDS = 1050;
/** Gun bursts a fighter carries when ready; service restores the full load. */
export const FIGHTER_AMMO_BURSTS = 16;
export const AIRCRAFT_REPAIR_HP = 60;
/** Up to one extra base service interval for damage; health above the repair ceiling is preserved. */
export const aircraftServiceSeconds = (baseSeconds: number, hp: number) => baseSeconds * (1 + (100 - clamp(hp, 0, 100)) / 100);
export const deckClearance = (p: Pick<SessionAircraft, 'modelId'>) => aircraftGroundPose(p.modelId).clearance;
export const flightSize = (actor: SessionActor) => actor.airWing?.deck?.groupSize ?? actor.definition.airWing!.flightSize;
export const deckCapacity = (actor: SessionActor) => actor.airWing?.deck?.capacity ?? actor.definition.airWing!.deckCapacity;
export const terminalAircraft = (p: Pick<Aircraft, 'phase'>) => p.phase === 'lost' || p.phase === 'withdrawn';
export const activeFlight = (flight: AirFlight, planes: SessionAircraft[]) => planes.some(p => p.flightId === flight.id && !['ready', 'rearming', 'lost', 'withdrawn', 'hangar', 'raising', 'lowering', 'repairing'].includes(p.phase));
export const airborne = (p: Pick<SessionAircraft, 'phase'>) => ['takeoff', 'outbound', 'attack', 'returning', 'landing'].includes(p.phase);
/** Stable deck spots, derived from the authored flight-deck datums (runtime metres). */
export function aircraftDeckSpot(actor: SessionActor, plane: SessionAircraft): Vec3 {
  const wing = actor.definition.airWing!;
  const index = plane.deckSlot ?? 0;
  const count = Math.min(deckCapacity(actor), actor.airWing!.planes.length);
  const span = Math.min(actor.definition.hull.length * .76, (count - 1) * 14);
  return [wing.launchPosition[0] - 10, wing.launchPosition[1] + deckClearance(plane),
    wing.recoveryPosition[2] - 15 - span + (count > 1 ? index * span / (count - 1) : 0)];
}
export const onFlightDeck = (p: Pick<SessionAircraft, 'phase' | 'deckSlot' | 'timer'>) => (p.deckSlot !== undefined && ['ready', 'queued', 'taxi', 'rollout', 'parking', 'rearming', 'raising', 'lowering', 'launch-ready'].includes(p.phase)) || (p.phase === 'takeoff' && p.timer <= TAKEOFF_ROLL_SECONDS);
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
export function airServiceAvailable(actor: SessionActor): boolean {
  const wing = actor.definition.airWing;
  const module = wing && actor.definition.modules.find(m => m.id === wing.serviceModuleId);
  return !!module && !physicalLoss(actor) && Math.abs(actor.motion.roll) < .22 && Math.abs(actor.motion.pitch) < .15 && actor.motion.y > -3 && equipmentCondition(actor, actor.definition, module).availability > 0;
}
/** Stable squadron IDs; merged groups retain records but no longer offer commands. */
export function squadronFlights(actor: SessionActor): AirFlight[] {
  if (!actor.airWing) return [];
  // Managed groups are persistent authority records, including groups whose
  // survivors are split between the deck, hangar and recovery queue.
  if (actor.airWing.deck) return actor.airWing.flights.filter(f => !f.mergedInto);
  return (actor.definition.airWing?.squadrons ?? []).flatMap(s => {
    const planes = actor.airWing!.planes.filter(p => p.squadronId === s.id);
    return Array.from({ length: Math.ceil(planes.length / flightSize(actor)) }, (_, i): AirFlight => {
      const id = `${actor.motion.id}/${s.id}/squadron-${i + 1}`;
      return actor.airWing!.flights.find(f => f.id === id) ?? {
        id, name: `${s.role === 'fighter' ? 'Fighter' : s.role === 'dive-bomber' ? 'Dive' : 'Torpedo'} ${i + 1}`,
        squadronId: s.id, planeIds: planes.slice(i * flightSize(actor), (i + 1) * flightSize(actor)).map(p => p.id), order: { kind: 'defend' },
      };
    });
  }).filter(f => !f.mergedInto);
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
export function recoveryQueue(actor: SessionActor): SessionAircraft[] {
  return (actor.airWing?.planes ?? []).filter(p => p.phase === 'returning' || p.phase === 'landing').sort((a, b) =>
    Number(b.phase === 'landing') - Number(a.phase === 'landing')
    || Number(b.flightTime > 470) - Number(a.flightTime > 470)
    || (a.flightTime > 470 && b.flightTime > 470 ? b.flightTime - a.flightTime : 0)
    || (a.recoveryRequestedAt ?? 0) - (b.recoveryRequestedAt ?? 0) || a.id.localeCompare(b.id));
}
export const AIR_TORPEDO = DEFAULT_AIR_TORPEDO;
export interface AirContext {
  seed?: number;
  actors: FleetActor[]; planes: Aircraft[]; shells: Shell[]; torpedoes: Torpedo[]; releases: AirRelease[];
  nextId: () => number; emit: (e: Omit<CombatEvent, 'sequence' | 'tick'>) => void;
}
