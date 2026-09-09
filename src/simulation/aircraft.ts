import type { AirOrder as NativeAirOrder } from '../multiplayer/generated/AirOrder';
import type { EndurancePolicy } from '../multiplayer/generated/EndurancePolicy';
import type { DeckPolicy } from '../multiplayer/generated/DeckPolicy';
import { physicalLoss } from './battleRules';
import type { AircraftRole, ShipDefinition, TorpedoPart, Vec3 } from '../ships/blueprint';
import type { FleetActor, Team } from './battle';
import { crewSkill, DEFAULT_AI_LEVEL, isPassiveAi } from './aiLevels';
import type { CombatEvent } from './combat';
import type { Shell } from './damage';
import { add, clamp, dot, length, localToWorld, normalize, scale, sub, wrapAngle, worldToLocal } from './geometry';
import { equipmentCondition } from './machinery';
import { motionVelocity } from './ship';
import { clearTorpedoLane, torpedoIntercept, type Torpedo } from './torpedoes';
import { flyAircraft as fly, initialFlightControls, stepFlightMechanisms, TAKEOFF_ROLL_SECONDS, TAKEOFF_CLIMB_SECONDS, type FlightAttitude, type FlightControls } from './aircraftFlight';
import { clearFighterLane, fighterGunAim, fighterTarget, initialAirPilot, orbitPoint, steerFighter, strikeIngress, type AirPilot } from './aircraftTactics';
import { aircraftDeckAttitude, aircraftGroundPose } from './aircraftGroundPose';
import { fighterBurst, strikeAimError } from './aircraftAccuracy';
import { AIR_GUNNERY, gunnerySeed, initialFireDiscipline, stepFireDiscipline } from './airGunnery';
import { flyFormation, formationLeader } from './aircraftFormation';
import { aircraftBomb, aircraftTorpedo, DEFAULT_AIR_TORPEDO } from './aircraftWeapons';

export type FlightPhase = 'ready' | 'queued' | 'taxi' | 'takeoff' | 'outbound' | 'attack' | 'returning' | 'landing' | 'rollout' | 'parking' | 'rearming' | 'lost' | 'hangar' | 'raising' | 'lowering' | 'repairing' | 'launch-ready';
export type AirOrder = Exclude<NativeAirOrder, { kind: 'defend' }> | { kind: 'defend'; targetId?: string };
export interface AirFlight { id: string; name: string; squadronId: string; planeIds: string[]; order: AirOrder; notice?: string; mergedInto?: string; }
export interface Aircraft {
  id: string; ownerId: string; team: Team; squadronId: string; modelId: string; role: AircraftRole;
  phase: FlightPhase; position: Vec3; previousPosition: Vec3; velocity: Vec3;
  heading: number; pitch: number; bank: number; hp: number; ammo: number; payload: boolean;
  wingFold: number; // 0 flight-ready, 1 fully stowed; fixed wings always 0.
  deckPosition?: Vec3; deckHeading?: number; timer: number; flightTime: number; cooldown: number; targetId?: string; kills: number;
  controls: FlightControls; previousControls?: FlightControls; previousAttitude?: FlightAttitude; pilot: AirPilot;
  deckSlot?: number; flightId?: string; recoveryRequestedAt?: number; lossReason?: string;
  navigationTarget?: Vec3; sortie?: number;
  /** A loss leaves combat immediately; its unpowered airframe continues to sea level. */
  wreck?: { age: number; rollRate: number; impacted: boolean };
}
export interface DeckStatus {
  policy: DeckPolicy; nextRequestId?: number;
  queue: { id: number; flightId: string; action: 'raise' | 'stow' | 'rearm' | 'repair' | 'launch'; automatic: boolean }[];
  currentPlaneId?: string; task?: string; stepRemainingSeconds?: number; suspended: boolean; notice?: string;
  occupied: number; capacity: number; groupSize: number; activeFlightLimit: number | null; endurance: EndurancePolicy; repairCeilingHp: number;
}
export interface AirWingState { deck?: DeckStatus; planes: Aircraft[]; launchCooldown: number; flights: AirFlight[]; flightSequence: number; transferCooldown: number; }
export interface AirRelease { id: number; ownerId: string; position: Vec3; velocity: Vec3; weapon?: TorpedoPart; }
export const hasFoldingWings = (modelId: string) => aircraftGroundPose(modelId).foldingWings;
const WING_FOLD_SECONDS = 4; // Gameplay timing; manual crew/hydraulic operation is abstracted.
export const AIRCRAFT_ENDURANCE_SECONDS = 1050;
/** Gun bursts a fighter carries when ready; service restores the full load. */
export const FIGHTER_AMMO_BURSTS = 16;
export const AIRCRAFT_REPAIR_HP = 60;
/** Up to one extra base service interval for damage; health above the repair ceiling is preserved. */
export const aircraftServiceSeconds = (baseSeconds: number, hp: number) => baseSeconds * (1 + (100 - clamp(hp, 0, 100)) / 100);
export const deckClearance = (p: Aircraft) => aircraftGroundPose(p.modelId).clearance;
export const flightSize = (actor: FleetActor) => actor.airWing?.deck?.groupSize ?? actor.definition.airWing?.flightSize ?? 3;
export const deckCapacity = (actor: FleetActor) => actor.airWing?.deck?.capacity ?? actor.definition.airWing?.deckCapacity ?? 18;
export const activeFlight = (flight: AirFlight, planes: Aircraft[]) => planes.some(p => p.flightId === flight.id && !['ready', 'rearming', 'lost', 'hangar', 'raising', 'lowering', 'repairing'].includes(p.phase));
export const airborne = (p: Aircraft) => ['takeoff', 'outbound', 'attack', 'returning', 'landing'].includes(p.phase);
/** Stable deck spots, derived from the authored flight-deck datums (runtime metres). */
export function aircraftDeckSpot(actor: FleetActor, plane: Aircraft): Vec3 {
  const wing = actor.definition.airWing!;
  const index = plane.deckSlot ?? 0;
  const count = Math.min(deckCapacity(actor), actor.airWing!.planes.length);
  const span = Math.min(actor.definition.hull.length * .76, (count - 1) * 14);
  return [wing.launchPosition[0] - 10, wing.launchPosition[1] + deckClearance(plane),
    wing.recoveryPosition[2] - 15 - span + (count > 1 ? index * span / (count - 1) : 0)];
}
export const onFlightDeck = (p: Aircraft) => (p.deckSlot !== undefined && ['ready', 'queued', 'taxi', 'rollout', 'parking', 'rearming', 'raising', 'lowering', 'launch-ready'].includes(p.phase)) || (p.phase === 'takeoff' && p.timer <= TAKEOFF_ROLL_SECONDS);
// Keep the next taxi off the centerline until the departing plane is beyond the bow.
const occupiesLaunchLane = (p: Aircraft, actor: FleetActor) => ['taxi', 'rollout'].includes(p.phase)
  || (p.phase === 'parking' && Math.abs((p.deckPosition?.[0] ?? 0) - actor.definition.airWing!.launchPosition[0]) < 6)
  || (p.phase === 'takeoff' && p.timer < TAKEOFF_ROLL_SECONDS + 1);
const TAKEOFF_ACCELERATION = 2 * 140 / TAKEOFF_ROLL_SECONDS ** 2;
const LAUNCH_TAXI_SPEED = 35;
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
export function airServiceAvailable(actor: FleetActor): boolean {
  const wing = actor.definition.airWing;
  const module = wing && actor.definition.modules.find(m => m.id === wing.serviceModuleId);
  return !!module && !physicalLoss(actor) && Math.abs(actor.motion.roll) < .22 && Math.abs(actor.motion.pitch) < .15 && actor.motion.y > -3 && equipmentCondition(actor, actor.definition, module).availability > 0;
}
/** Stable squadron IDs; merged groups retain records but no longer offer commands. */
export function squadronFlights(actor: FleetActor): AirFlight[] {
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
/** Consolidate whole matching groups only after every survivor is safely in the hangar. */
function combineLandedSquadrons(actor: FleetActor) {
  const state = actor.airWing!;
  if (!state.planes.some(p => p.phase === 'lost')) return;
  const planes = new Map(state.planes.map(p => [p.id, p]));
  const candidates = squadronFlights(actor).map(flight => ({ flight, survivors: flight.planeIds.map(id => planes.get(id)!).filter(p => p.phase !== 'lost') }))
    .filter(({ survivors }) => survivors.length > 0 && survivors.length < flightSize(actor)
      && survivors.every(p => (p.phase === 'ready' || p.phase === 'rearming') && !onFlightDeck(p)));
  for (let i = 0; i < candidates.length; i++) {
    const target = candidates[i];
    if (target.flight.mergedInto) continue;
    for (const source of candidates.slice(i + 1)) {
      if (source.flight.mergedInto || target.survivors.length + source.survivors.length > flightSize(actor)) continue;
      if (!source.survivors.every(p => p.modelId === target.survivors[0].modelId && p.role === target.survivors[0].role)) continue;
      // Exchange live planes for lost slots, keeping inventory IDs unique and bounded.
      for (const plane of source.survivors) {
        const slot = target.flight.planeIds.findIndex(id => planes.get(id)!.phase === 'lost');
        if (slot < 0) {
          target.flight.planeIds.push(plane.id);
          source.flight.planeIds = source.flight.planeIds.filter(id => id !== plane.id);
        } else {
          const lostId = target.flight.planeIds[slot];
          target.flight.planeIds[slot] = plane.id;
          source.flight.planeIds[source.flight.planeIds.indexOf(plane.id)] = lostId;
          planes.get(lostId)!.flightId = source.flight.id;
        }
        plane.flightId = target.flight.id;
      }
      target.survivors.push(...source.survivors);
      source.flight.mergedInto = target.flight.id;
      for (const flight of [target.flight, source.flight]) if (!state.flights.some(f => f.id === flight.id)) state.flights.push(flight);
    }
  }
}
function validAirOrder(actor: FleetActor, flightId: string, planes: Aircraft[], order: AirOrder, actors: FleetActor[]) {
  if (order.kind === 'return') return true;
  if (order.kind === 'strike' || order.kind === 'intercept-contact') return false; // Rust observation-mode orders.
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
  if (state.flights.filter(f => activeFlight(f, state.planes)).length >= (actor.definition.airWing!.maxActiveFlights ?? 4)) return 0;
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
export function recoveryQueue(actor: FleetActor): Aircraft[] {
  return (actor.airWing?.planes ?? []).filter(p => p.phase === 'returning' || p.phase === 'landing').sort((a, b) =>
    Number(b.phase === 'landing') - Number(a.phase === 'landing')
    || Number(b.flightTime > 470) - Number(a.flightTime > 470)
    || (a.flightTime > 470 && b.flightTime > 470 ? b.flightTime - a.flightTime : 0)
    || (a.recoveryRequestedAt ?? 0) - (b.recoveryRequestedAt ?? 0) || a.id.localeCompare(b.id));
}
function spotAircraft(actor: FleetActor, p: Aircraft): boolean {
  if (p.deckSlot !== undefined) return true;
  const state = actor.airWing!;
  const free = Array.from({ length: deckCapacity(actor) }, (_, i) => i).find(i => !state.planes.some(other => other.deckSlot === i));
  if (free === undefined) {
    const reserve = state.planes.find(other => other.deckSlot !== undefined && other.phase === 'ready');
    if (!reserve) return false;
    p.deckSlot = reserve.deckSlot; reserve.deckSlot = undefined; reserve.deckPosition = undefined;
  } else p.deckSlot = free;
  deckPose(p, actor, aircraftDeckSpot(actor, p));
  p.previousPosition = [...p.position];
  return true;
}
export const AIR_TORPEDO = DEFAULT_AIR_TORPEDO;
export interface AirContext {
  seed?: number;
  actors: FleetActor[]; planes: Aircraft[]; shells: Shell[]; torpedoes: Torpedo[]; releases: AirRelease[];
  nextId: () => number; emit: (e: Omit<CombatEvent, 'sequence' | 'tick'>) => void;
}
function lose(p: Aircraft, ctx: AirContext, reason = 'Shot down') {
  if (p.phase === 'lost') return;
  if (airborne(p) && !onFlightDeck(p)) {
    const seed = [...p.id].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 0);
    p.wreck = { age: 0, rollRate: (seed % 2 ? 1 : -1) * (.45 + (seed % 7) * .065), impacted: false };
  }
  p.hp = 0; p.phase = 'lost';
  p.lossReason = reason; p.deckSlot = undefined;
  ctx.emit({ kind: 'aircraft-lost', position: [...p.position], shipId: p.ownerId, message: `${p.modelId} · ${reason}`, aircraft: { id: p.id } });
}
/** Simplified unpowered descent, independent of rendering and GPU waves. */
function stepWreck(p: Aircraft, ctx: AirContext, dt: number) {
  const wreck = p.wreck;
  if (!wreck || wreck.impacted) return;
  const from = p.position, velocity = p.velocity;
  const drag = .055, decay = Math.exp(-drag * dt), travel = (1 - decay) / drag;
  const next: Vec3 = [from[0] + velocity[0] * travel,
    from[1] + (velocity[1] + 9.81 / drag) * travel - 9.81 / drag * dt,
    from[2] + velocity[2] * travel];
  p.velocity = [velocity[0] * decay, (velocity[1] + 9.81 / drag) * decay - 9.81 / drag, velocity[2] * decay];
  wreck.age += dt;
  p.bank = wrapAngle(p.bank + wreck.rollRate * dt);
  const dive = Math.atan2(p.velocity[1], Math.hypot(p.velocity[0], p.velocity[2]));
  p.pitch += (dive - p.pitch) * (1 - Math.exp(-dt * 1.8));
  p.controls.propeller += Math.exp(-wreck.age * .8) * 20 * dt;
  if (next[1] <= 0) {
    const fraction = clamp(from[1] / (from[1] - next[1] || 1), 0, 1);
    p.position = [from[0] + (next[0] - from[0]) * fraction, 0, from[2] + (next[2] - from[2]) * fraction];
    wreck.impacted = true;
    ctx.emit({ kind: 'aircraft-crash', position: [...p.position], shipId: p.ownerId, message: `${p.modelId} struck the sea`, aircraft: { id: p.id, velocity: [...p.velocity] } });
  } else p.position = next;
}
export function stepAircraft(ctx: AirContext, dt: number, time: number) {
  if (dt <= 0) return;
  // Snapshot the whole group before any fighter can change another plane's state.
  for (const p of ctx.planes) {
    p.previousPosition = [...p.position];
    p.previousAttitude = { heading: p.heading, pitch: p.pitch, bank: p.bank };
    p.previousControls = { ...p.controls };
    if (p.phase === 'lost') stepWreck(p, ctx, dt);
    else stepFlightMechanisms(p, dt, onFlightDeck(p));
  }
  // One immutable leader pose per tick keeps every wingman on the same reference.
  const leaders = new Map<string, Aircraft>();
  for (const actor of ctx.actors) for (const flight of actor.airWing?.flights ?? []) {
    const leader = formationLeader(flight, actor.airWing!.planes);
    if (leader) leaders.set(flight.id, { ...leader, position: [...leader.position], velocity: [...leader.velocity], pilot: { ...leader.pilot } });
  }
  for (const actor of ctx.actors) {
    const state = actor.airWing, wing = actor.definition.airWing;
    if (!state || !wing) continue;
    combineLandedSquadrons(actor);
    state.launchCooldown = Math.max(0, state.launchCooldown - dt);
    state.transferCooldown = Math.max(0, state.transferCooldown - dt);
    for (const p of state.planes) if (p.phase === 'returning' || p.phase === 'landing') p.recoveryRequestedAt ??= time;
    const recovery = recoveryQueue(actor);
    const landingClearance = recovery.find(p => {
      if (p.phase !== 'returning' || p.pilot.recoveryStage !== 'final') return false;
      const local = worldToLocal(p.position, actor.motion), aft = local[2] - wing.recoveryPosition[2];
      return aft > 550 && Math.abs(local[0] - wing.recoveryPosition[0]) < 70 && Math.abs(wrapAngle(p.heading - actor.motion.heading)) < .2
        && recovery.every(other => other.phase !== 'landing' || Math.abs(local[2] - worldToLocal(other.position, actor.motion)[2]) > 60);
    });
    const approachingDeck = state.planes.some(p => p.phase === 'landing' && worldToLocal(p.position, actor.motion)[2] - wing.recoveryPosition[2] < 650);
    if (actor.controller === 'bot' && !isPassiveAi(actor.bot?.aiLevel) && time >= 5 * crewSkill(actor.bot?.aiLevel ?? DEFAULT_AI_LEVEL).reactionScale) {
      const validTarget = (a: FleetActor) => a.team !== actor.team && !physicalLoss(a) && a.motion.y > -8;
      const target = ctx.actors.find(a => a.motion.id === actor.targetId && validTarget(a)) ?? ctx.actors.find(validTarget);
      for (const squadron of wing.squadrons) if (!state.planes.some(p => p.squadronId === squadron.id && !['ready', 'rearming', 'lost'].includes(p.phase))) launchSquadron(actor, squadron.id, target);
    }
    for (const [i, p] of state.planes.entries()) {
      p.cooldown = Math.max(0, p.cooldown - dt);
      if (p.phase === 'lost') continue;
      const foldTarget = hasFoldingWings(p.modelId) && ['ready', 'queued', 'parking', 'rearming'].includes(p.phase) ? 1 : 0;
      // Unfold during the compressed deck run; full span is restored before liftoff.
      const foldSeconds = p.phase === 'takeoff' ? TAKEOFF_ROLL_SECONDS - .5 : WING_FOLD_SECONDS;
      p.wingFold += Math.sign(foldTarget - p.wingFold) * Math.min(Math.abs(foldTarget - p.wingFold), dt / foldSeconds);
      if (actor.damage.sunk && (onFlightDeck(p) || !airborne(p))) { p.hp = 0; p.phase = 'lost'; p.deckSlot = undefined; p.lossReason = 'Carrier lost'; continue; }
      if (p.phase === 'ready' || p.phase === 'queued' || p.phase === 'rearming') {
        if (p.deckSlot !== undefined) deckPose(p, actor, aircraftDeckSpot(actor, p));
        if (p.phase === 'rearming' && airServiceAvailable(actor)) {
          p.timer -= dt;
          if (p.timer <= 0) { p.phase = 'ready'; p.timer = 0; p.deckSlot = undefined; p.deckPosition = undefined; p.flightTime = 0; p.ammo = p.role === 'fighter' ? FIGHTER_AMMO_BURSTS : 0; p.payload = p.role !== 'fighter'; p.hp = Math.max(p.hp, AIRCRAFT_REPAIR_HP); }
        }
        if (p.phase === 'queued' && state.launchCooldown <= 0 && airServiceAvailable(actor)
          && !approachingDeck && !state.planes.some(other => ['taxi', 'rollout', 'parking'].includes(other.phase)) && spotAircraft(actor, p)) {
          // Gameplay launch cadence: overlapping deck runs complete a full squadron in ~10 s.
          // Spawn only on release from the hangar; no idle deck aircraft or taxi delay.
          p.phase = 'takeoff'; p.timer = 0; p.flightTime = 0;
          state.launchCooldown = (10 - TAKEOFF_ROLL_SECONDS - TAKEOFF_CLIMB_SECONDS) / Math.max(1, flightSize(actor) - 1);
          deckPose(p, actor, add(wing.launchPosition, [0, deckClearance(p), 0]));
          p.previousPosition = [...p.position];
          ctx.emit({ kind: 'aircraft-launch', position: [...p.position], shipId: p.ownerId, message: `${p.modelId} launched`, aircraft: { id: p.id } });
        }
        continue;
      }
      if (p.phase === 'taxi' || p.phase === 'parking' || p.phase === 'rollout') {
        if ((p.phase === 'taxi' && p.wingFold > 0) || (p.phase === 'parking' && hasFoldingWings(p.modelId) && p.wingFold < 1)) {
          deckPose(p, actor, p.deckPosition!);
          continue;
        }
        if (p.phase === 'rollout') {
          p.timer += dt;
          const local = p.deckPosition!;
          deckPose(p, actor, [local[0], local[1], local[2] - Math.max(0, 35 * (1 - p.timer / 1.2)) * dt]);
          if (p.timer >= 1.2) { p.phase = 'rearming'; p.timer = aircraftServiceSeconds(wing.rearmSeconds, p.hp); p.deckSlot = undefined; p.deckPosition = undefined; p.recoveryRequestedAt = undefined; }
        } else {
          const destination = p.phase === 'parking' ? aircraftDeckSpot(actor, p) : add(wing.launchPosition, [0, deckClearance(p), 0]);
          // Clear the parking row laterally before moving along the flight lane.
          const current = p.deckPosition!;
          const waypoint: Vec3 = Math.abs(current[0] - destination[0]) > .1 ? [destination[0], destination[1], current[2]] : destination;
          const arrived = taxi(p, actor, waypoint, p.phase === 'taxi' ? LAUNCH_TAXI_SPEED : 12, dt) && length(sub(waypoint, destination)) < .1;
          if (arrived && p.phase === 'parking') { p.phase = 'rearming'; p.timer = aircraftServiceSeconds(wing.rearmSeconds, p.hp); p.deckSlot = undefined; p.deckPosition = undefined; p.recoveryRequestedAt = undefined; }
          else if (arrived && (!airServiceAvailable(actor))) { p.phase = 'parking'; }
          else if (arrived) {
            p.phase = 'takeoff'; p.timer = 0; p.flightTime = 0; state.launchCooldown = wing.launchIntervalSeconds;
            deckPose(p, actor, destination);
            ctx.emit({ kind: 'aircraft-launch', position: [...p.position], shipId: p.ownerId, message: `${p.modelId} launched`, aircraft: { id: p.id } });
          }
        }
        continue;
      }
      p.flightTime += dt; p.timer += dt;
      if (p.flightTime > AIRCRAFT_ENDURANCE_SECONDS) { lose(p, ctx, 'Endurance exhausted'); continue; }
      if ((p.flightTime > 470 || p.hp < 25) && p.phase !== 'landing') p.phase = 'returning';
      const carrier = localToWorld(add(wing.recoveryPosition, [0, deckClearance(p), 0]), actor.motion);
      if (p.hp <= 0) { lose(p, ctx); continue; }
      if (p.phase === 'takeoff') {
        if (p.timer <= TAKEOFF_ROLL_SECONDS) {
          const local: Vec3 = [wing.launchPosition[0], wing.launchPosition[1] + deckClearance(p), wing.launchPosition[2] - .5 * TAKEOFF_ACCELERATION * p.timer * p.timer];
          deckPose(p, actor, local);
          p.velocity = add(motionVelocity(actor.motion), [Math.sin(p.heading) * TAKEOFF_ACCELERATION * p.timer, 0, -Math.cos(p.heading) * TAKEOFF_ACCELERATION * p.timer]);
        } else {
          const point = localToWorld([wing.launchPosition[0], wing.launchPosition[1] + deckClearance(p) + 80, -600], actor.motion);
          fly(p, point, 78 + (p.timer - TAKEOFF_ROLL_SECONDS) * 5, dt);
        }
        if (p.timer > TAKEOFF_ROLL_SECONDS + TAKEOFF_CLIMB_SECONDS) { p.phase = 'outbound'; p.timer = 0; p.deckPosition = undefined; p.deckSlot = undefined; }
        continue;
      }
      if (p.phase === 'returning' || p.phase === 'landing') {
        if (actor.damage.sunk) { fly(p, [carrier[0], 180, carrier[2]], 80, dt); continue; }
        const local = worldToLocal(p.position, actor.motion);
        const aft = local[2] - wing.recoveryPosition[2];
        p.pilot.recoverySide ??= local[0] < 0 ? -1 : 1;
        const approach = localToWorld([wing.recoveryPosition[0], wing.recoveryPosition[1] + 180, wing.recoveryPosition[2] + 3000], actor.motion);
        const busy = state.planes.some(other => other !== p && occupiesLaunchLane(other, actor));
        const available = airServiceAvailable(actor);
        if (p.phase === 'returning') {
          if (!available) {
            p.pilot.recoveryStage = 'marshal';
            const anchor = localToWorld([850, 220 + (i % 3) * 45, wing.recoveryPosition[2] + 1600], actor.motion);
            fly(p, orbitPoint(p, anchor, 650 + (i % 3) * 90), 70, dt);
          } else {
            // Enter via a downwind leg and a base turn. A single point astern
            // made inbound aircraft reverse over it and repeatedly miss final.
            if (!p.pilot.recoveryStage || p.pilot.recoveryStage === 'marshal') {
              p.pilot.recoveryStage = aft > 700 && Math.abs(local[0] - wing.recoveryPosition[0]) < 100 && Math.abs(wrapAngle(p.heading - actor.motion.heading)) < .25 ? 'final' : 'downwind';
            }
            if (p.pilot.recoveryStage === 'downwind') {
              const downwind = localToWorld([wing.recoveryPosition[0] + p.pilot.recoverySide * 900, wing.recoveryPosition[1] + 180 + (i % 3) * 25, wing.recoveryPosition[2] + 2800], actor.motion);
              fly(p, downwind, 70 + Math.max(0, actor.motion.speed), dt);
              if (length(sub(p.position, downwind)) < 300) p.pilot.recoveryStage = 'base';
            } else if (p.pilot.recoveryStage === 'base') {
              fly(p, approach, 58 + Math.max(0, actor.motion.speed), dt);
              if (length(sub(p.position, approach)) < 250) p.pilot.recoveryStage = 'final';
            }
            else if (p.pilot.recoveryStage === 'final') {
              const intercept = localToWorld([wing.recoveryPosition[0], wing.recoveryPosition[1] + Math.max(90, aft * .06), wing.recoveryPosition[2] + Math.max(150, aft - 600)], actor.motion);
              fly(p, intercept, 38 + Math.max(0, actor.motion.speed), dt);
              const separated = state.planes.every(other => other === p || other.phase !== 'landing' || Math.abs(aft - (worldToLocal(other.position, actor.motion)[2] - wing.recoveryPosition[2])) > 60);
              if (landingClearance === p && separated && (!busy || aft > 900) && aft > 550 && Math.abs(local[0] - wing.recoveryPosition[0]) < 70
                && Math.abs(wrapAngle(p.heading - actor.motion.heading)) < .2) { p.phase = 'landing'; p.timer = 0; }
              else if (aft < 500) p.pilot.recoveryStage = 'marshal';
            }
          }
        } else if (!airServiceAvailable(actor)) {
          p.phase = 'returning'; p.pilot.recoveryStage = 'marshal';
          fly(p, approach, 70, dt);
        } else {
          // Follow a shallow glide path through the wire datum. Extending the path
          // below the deck prevents an asymptotic hover just above the tyres.
          const lookAhead = 140;
          const nextAft = aft - lookAhead;
          const height = nextAft * .06;
          const leadSeconds = lookAhead / Math.max(20, length(p.velocity) - actor.motion.speed);
          const aim = add(localToWorld([wing.recoveryPosition[0], wing.recoveryPosition[1] + deckClearance(p) + height, wing.recoveryPosition[2] + nextAft], actor.motion), scale(motionVelocity(actor.motion), leadSeconds));
          fly(p, aim, 40 + Math.max(0, actor.motion.speed), dt, { landing: true });
          const next = worldToLocal(p.position, actor.motion);
          const deckY = wing.recoveryPosition[1] + deckClearance(p);
          if (next[2] <= wing.recoveryPosition[2] + 12 && next[2] >= wing.recoveryPosition[2] - 30
            && Math.abs(next[0] - wing.recoveryPosition[0]) < 7 && Math.abs(next[1] - deckY) < .35
            && Math.abs(wrapAngle(p.heading - actor.motion.heading)) < .12) {
            if (busy || !spotAircraft(actor, p)) { p.phase = 'returning'; p.pilot.recoveryStage = 'marshal'; continue; }
            p.phase = 'rollout'; p.timer = 0;
            deckPose(p, actor, [next[0], deckY, next[2]]);
            ctx.emit({ kind: 'aircraft-recovered', position: [...p.position], shipId: p.ownerId, message: `${p.modelId} landed`, aircraft: { id: p.id } });
          } else if (next[2] < wing.recoveryPosition[2] - 30 || (aft < 250 && Math.abs(next[0] - wing.recoveryPosition[0]) > 30)) {
            p.phase = 'returning'; p.pilot.recoveryStage = 'marshal';
          }
        }
        continue;
      }
      const flight = state.flights.find(f => f.id === p.flightId);
      const leader = flight && leaders.get(flight.id);
      const follow = () => {
        if (!flight || !leader || leader.id === p.id || leader.hp <= 0) return false;
        flyFormation(p, leader, flight, dt, time, ctx.seed ?? 0);
        return true;
      };
      if (p.role !== 'fighter' && flight?.order.kind === 'patrol') {
        const anchor: Vec3 = [flight.order.point[0], p.role === 'dive-bomber' ? 850 : 420, flight.order.point[2]];
        p.phase = 'outbound'; if (!follow()) fly(p, orbitPoint(p, anchor, 850), 80, dt, { bankLimit: .45 }); continue;
      }
      if (p.role === 'fighter') {
        if (!p.ammo || p.flightTime > 260) { p.phase = 'returning'; continue; }
        let patrol: Vec3 = [...carrier];
        if (flight?.order.kind === 'patrol') patrol = flight.order.point;
        if (flight?.order.kind === 'defend' && flight.order.targetId) {
          const targetId = flight.order.targetId;
          const defended = ctx.actors.find(a => a.motion.id === targetId && !physicalLoss(a));
          if (defended) patrol = [defended.motion.x, 0, defended.motion.z];
          else { flight.order = { kind: 'defend' }; flight.notice = 'Ship unavailable · Defending carrier'; }
        }
        if (flight?.order.kind === 'intercept') {
          const targetFlightId = flight.order.flightId;
          const targets = ctx.planes.filter(other => other.flightId === targetFlightId && other.team !== p.team && airborne(other) && other.hp > 0);
          if (targets.length) patrol = targets[0].position;
          else if (!ctx.actors.some(a => a.airWing?.flights.some(f => f.id === targetFlightId && activeFlight(f, a.airWing!.planes)))) {
            flight.order = { kind: 'patrol', point: [p.position[0], 420, p.position[2]] }; flight.notice = 'Interception complete · Loitering';
          }
        }
        if (flight?.order.kind === 'escort') {
          const escorted = ctx.planes.find(other => other.flightId === (flight.order as { flightId: string }).flightId && airborne(other) && !onFlightDeck(other));
          if (escorted) patrol = escorted.position;
          else if (!ctx.actors.some(a => a.airWing?.flights.some(f => f.id === (flight.order as { flightId: string }).flightId && activeFlight(f, a.airWing!.planes)))) {
            flight.order = { kind: 'defend' }; flight.notice = 'Escort complete · Defending carrier';
          }
        }
        const hostile = fighterTarget(p, ctx.planes, patrol, dt, flight?.order.kind === 'intercept' ? flight.order.flightId : undefined);
        const discipline = p.pilot.fireDiscipline ??= initialFireDiscipline();
        const pressure = 1 - p.hp / 100 + (hostile && length(sub(hostile.position, p.position)) < 350 ? .5 : 0);
        stepFireDiscipline(discipline, dt, pressure, gunnerySeed(p.id, ctx.seed ?? 0), !!hostile);
        if (hostile) {
          p.phase = 'attack';
          const pursuing = steerFighter(p, hostile, ctx.planes, dt);
          const gun = fighterGunAim(p, hostile);
          const onAim = pursuing && gun.distance > 80 && gun.distance < 600 && gun.alignment > (discipline.panic ? .94 : .996)
            && clearFighterLane(p, gun.point, ctx.planes);
          p.pilot.aimTime = onAim ? p.pilot.aimTime + dt : 0;
          if (onAim && p.pilot.aimTime >= (discipline.panic ? .04 : .12) && p.cooldown <= 0) {
            // Sample the next burst before consuming it, so a blocked lane spends nothing.
            const burst = fighterBurst(p, gun.point, ctx.seed ?? 0, p.sortie ?? 0);
            if (!clearFighterLane(p, burst.end, ctx.planes)) continue;
            p.ammo--; p.cooldown = .4;
            if (burst.hit) hostile.hp -= AIR_GUNNERY.fighterDamage * clamp((gun.alignment - .996) / .004, .3, 1) * clamp(1.3 - gun.distance / 900, .5, 1);
            ctx.emit({ kind: 'aircraft-fire', position: [...p.position], shipId: p.ownerId, message: 'Fighter guns', aircraft: { id: p.id, target: burst.end, panic: discipline.panic, direction: normalize(sub(sub(burst.end, p.position), scale(p.velocity, gun.time))), velocity: [...p.velocity], attitude: { heading: p.heading, pitch: p.pitch, bank: p.bank } } });
            if (hostile.hp <= 0) { p.kills++; lose(hostile, ctx); }
          }
        } else {
          p.phase = 'outbound'; p.pilot.aimTime = 0;
          const anchor: Vec3 = [patrol[0], Math.max(420, patrol[1] + 80), patrol[2]];
          if (!leader || leader.phase === 'attack' || !follow()) fly(p, orbitPoint(p, anchor, 1000), 85, dt, { bankLimit: .5 });
        }
        continue;
      }
      const target = ctx.actors.find(a => a.motion.id === p.targetId && a.team !== p.team && !physicalLoss(a) && a.motion.y > -8);
      if (!target || !p.payload) {
        if (!target && p.payload) { const flight = state.flights.find(f => f.id === p.flightId); if (flight) flight.notice = 'Target unavailable · Returning armed'; }
        p.phase = 'returning'; continue;
      }
      const targetPoint = add([target.motion.x, Math.max(0, target.motion.y + target.definition.hull.depth - target.definition.hull.draft), target.motion.z],
        strikeAimError(p, target.motion.heading, ctx.seed ?? 0, p.sortie ?? 0));
      const distance = Math.hypot(targetPoint[0] - p.position[0], targetPoint[2] - p.position[2]);
      // The whole flight uses one approach axis. Final weapon solutions retain
      // each pilot's seeded aim error and all existing release/lane checks.
      if (leader && leader.id !== p.id && leader.targetId === p.targetId && leader.pilot.attackHeading !== undefined
        && p.pilot.attempts === leader.pilot.attempts && p.pilot.attackStage !== 'egress') {
        p.pilot.attackHeading = leader.pilot.attackHeading;
        p.pilot.attackStage ??= 'ingress';
        if (leader.pilot.attackStage === 'run') p.pilot.attackStage = 'run';
      }
      const ingress = strikeIngress(p, target, targetPoint);
      const heading = p.pilot.attackHeading!;
      const forward: Vec3 = [Math.sin(heading), 0, -Math.cos(heading)];
      if (leader && leader.id !== p.id && leader.targetId === p.targetId && leader.payload
        && p.pilot.attempts === leader.pilot.attempts && p.pilot.attackStage !== 'egress'
        && (leader.pilot.attackStage === 'ingress' || (leader.pilot.attackStage === 'run'
          && Math.hypot(leader.position[0] - targetPoint[0], leader.position[2] - targetPoint[2]) > (p.role === 'dive-bomber' ? 1700 : 2100)))) {
        p.phase = 'outbound';
        if (follow()) continue;
      }
      if (p.pilot.attackStage === 'egress') {
        const exit = add(targetPoint, scale(forward, 2200)); exit[1] = 350;
        fly(p, exit, 95, dt);
        if (distance > 1800) {
          if (++p.pilot.attempts >= 2) p.phase = 'returning';
          else p.pilot.attackStage = 'ingress';
        }
        continue;
      }
      if (p.pilot.attackStage === 'ingress') {
        p.phase = 'outbound';
        fly(p, ingress, p.role === 'dive-bomber' ? 85 : 75, dt, { bankLimit: .65 });
        if (Math.hypot(p.position[0] - ingress[0], p.position[2] - ingress[2]) < (p.role === 'dive-bomber' ? 1000 : 240) && Math.abs(p.position[1] - ingress[1]) < 120) p.pilot.attackStage = 'run';
        continue;
      }
      // Reaching the ingress point does not mean the aircraft faces the target.
      // Finish the turn at approach altitude before committing to a restricted-bank dive.
      if (p.role === 'dive-bomber' && p.phase !== 'attack') {
        const bearing = Math.atan2(targetPoint[0] - p.position[0], p.position[2] - targetPoint[2]);
        if (distance > 1600 || Math.abs(wrapAngle(bearing - p.heading)) > .12 || Math.abs(p.bank) > .15) {
          fly(p, [targetPoint[0], 850, targetPoint[2]], 85, dt, { bankLimit: .65 });
          continue;
        }
      }
      p.phase = 'attack';
      if (p.role === 'dive-bomber') {
        const height = Math.max(0, p.position[1] - 1 - targetPoint[1]);
        const fall = (p.velocity[1] + Math.sqrt(p.velocity[1] ** 2 + 19.62 * height)) / 9.81;
        const aim = add(targetPoint, scale(motionVelocity(target.motion), fall));
        fly(p, [aim[0], targetPoint[1], aim[2]], 104, dt, { dive: true, bankLimit: .5 });
        // Recompute after movement: the released body inherits this exact velocity.
        const releaseHeight = Math.max(0, p.position[1] - 1 - targetPoint[1]);
        const releaseFall = (p.velocity[1] + Math.sqrt(p.velocity[1] ** 2 + 19.62 * releaseHeight)) / 9.81;
        const landing = add(p.position, scale(p.velocity, releaseFall));
        const impactAim = add(targetPoint, scale(motionVelocity(target.motion), releaseFall));
        const error = Math.hypot(landing[0] - impactAim[0], landing[2] - impactAim[2]);
        if (error < 22 && p.pitch < -.25 && p.position[1] > targetPoint[1] + 90) {
          const id = ctx.nextId();
          const bomb = aircraftBomb(p.modelId);
          ctx.shells.push({ id, ownerId: p.ownerId, weaponLabel: bomb.label, bomb: { heading: p.heading, pitch: p.pitch, bank: p.bank }, position: add(p.position, [0, -1, 0]), velocity: [...p.velocity], age: 0, penetrationMm: 0, damage: bomb.he.damage, caliberM: bomb.caliberM, visited: [], ammunition: 'he', type: 'HE', he: { ...bomb.he } });
          p.payload = false; p.phase = 'returning';
          ctx.emit({ kind: 'bomb-release', position: [...p.position], shipId: p.ownerId, message: 'Bomb away', shell: { id, caliberM: bomb.caliberM, velocity: [...p.velocity], ammunition: 'he', type: 'HE' }, aircraft: { id: p.id } });
        } else if (p.position[1] < targetPoint[1] + 100 || dot(sub(targetPoint, p.position), forward) < -100) p.pilot.attackStage = 'egress';
      } else {
        // Include the airborne travel before solving the slower underwater run.
        const fall = (-3 + Math.sqrt(9 + 19.62 * Math.max(0, p.position[1]))) / 9.81;
        const waterEntry = add(p.position, scale([p.velocity[0], 0, p.velocity[2]], fall));
        const futureTarget = add(targetPoint, scale(motionVelocity(target.motion), fall));
        const torpedo = aircraftTorpedo(p.modelId);
        const aim = torpedoIntercept(waterEntry, futureTarget, motionVelocity(target.motion), torpedo.speed) ?? futureTarget;
        fly(p, [aim[0], 26, aim[2]], 70, dt, { bankLimit: distance > 1600 ? .72 : .35, altitudeLookahead: 450 });
        const aligned = dot(normalize([p.velocity[0], 0, p.velocity[2]]), normalize([aim[0] - p.position[0], 0, aim[2] - p.position[2]])) > .999;
        if (distance < 1050 && distance > 650 && p.position[1] < 38 && p.position[1] > 15 && Math.abs(p.bank) < .12 && Math.abs(p.pitch) < .08 && aligned
          && clearTorpedoLane(actor, waterEntry, aim, torpedo.speed, ctx.actors)) {
          ctx.releases.push({ id: ctx.nextId(), ownerId: p.ownerId, position: [...p.position], velocity: [p.velocity[0], -3, p.velocity[2]], weapon: torpedo });
          p.payload = false; p.phase = 'returning';
          ctx.emit({ kind: 'aircraft-release', position: [...p.position], shipId: p.ownerId, message: 'Torpedo away', aircraft: { id: p.id } });
        }
        if (distance < 550 && p.payload) p.pilot.attackStage = 'egress';
      }
    }
  }
  for (let i = ctx.releases.length - 1; i >= 0; i--) {
    const release = ctx.releases[i]; release.velocity[1] -= 9.81 * dt;
    release.position = add(release.position, scale(release.velocity, dt));
    if (release.position[1] <= 0) {
      const weapon = release.weapon ?? AIR_TORPEDO;
      const velocity = scale(normalize([release.velocity[0], 0, release.velocity[2]]), weapon.speed);
      const position: Vec3 = [release.position[0], -weapon.runningDepthM, release.position[2]];
      ctx.torpedoes.push({ id: release.id, ownerId: release.ownerId, tubeId: 'aircraft.payload', position, velocity, distance: 0, age: 0, weapon });
      ctx.emit({ kind: 'torpedo-launch', position, shipId: release.ownerId, message: 'Air torpedo entered water', torpedo: { id: release.id, velocity, diameterM: weapon.diameterM } });
      ctx.releases.splice(i, 1);
    }
  }
}
