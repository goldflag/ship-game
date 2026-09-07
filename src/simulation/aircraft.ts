import type { AircraftRole, ShipDefinition, TorpedoPart, Vec3 } from '../ships/blueprint';
import type { FleetActor, Team } from './battle';
import type { CombatEvent } from './combat';
import type { Shell } from './damage';
import { add, clamp, dot, length, localToWorld, normalize, scale, sub, wrapAngle, worldToLocal } from './geometry';
import { equipmentCondition } from './machinery';
import { motionVelocity } from './ship';
import { clearTorpedoLane, torpedoIntercept, type Torpedo } from './torpedoes';
import { flyAircraft as fly, initialFlightControls, stepFlightMechanisms, TAKEOFF_ROLL_SECONDS, TAKEOFF_CLIMB_SECONDS, type FlightAttitude, type FlightControls } from './aircraftFlight';
import { clearFighterLane, fighterGunAim, fighterTarget, initialAirPilot, orbitPoint, steerFighter, strikeIngress, type AirPilot } from './aircraftTactics';

export type FlightPhase = 'ready' | 'queued' | 'taxi' | 'takeoff' | 'outbound' | 'attack' | 'returning' | 'landing' | 'rollout' | 'parking' | 'rearming' | 'lost';
export type AirOrder = { kind: 'attack'; targetId: string } | { kind: 'patrol'; point: Vec3 } | { kind: 'defend' } | { kind: 'escort'; flightId: string } | { kind: 'return' };
export interface AirFlight { id: string; name: string; squadronId: string; planeIds: string[]; order: AirOrder; notice?: string; }
export interface Aircraft {
  id: string; ownerId: string; team: Team; squadronId: string; modelId: string; role: AircraftRole;
  phase: FlightPhase; position: Vec3; previousPosition: Vec3; velocity: Vec3;
  heading: number; pitch: number; bank: number; hp: number; ammo: number; payload: boolean;
  deckPosition?: Vec3; timer: number; flightTime: number; cooldown: number; targetId?: string; kills: number;
  controls: FlightControls; previousControls?: FlightControls; previousAttitude?: FlightAttitude; pilot: AirPilot;
  deckSlot?: number; flightId?: string; recoveryRequestedAt?: number; lossReason?: string;
  navigationTarget?: Vec3;
}
export interface AirWingState { planes: Aircraft[]; launchCooldown: number; flights: AirFlight[]; flightSequence: number; transferCooldown: number; }
export interface AirRelease { id: number; ownerId: string; position: Vec3; velocity: Vec3; }
export const MAX_AIRBORNE = 144;
export const deckClearance = (p: Aircraft) => p.role === 'fighter' ? 1.755 : p.role === 'dive-bomber' ? 1.941 : 2.24445;
export const flightSize = (actor: FleetActor) => actor.definition.airWing?.flightSize ?? 3;
export const deckCapacity = (actor: FleetActor) => actor.definition.airWing?.deckCapacity ?? 18;
export const activeFlight = (flight: AirFlight, planes: Aircraft[]) => planes.some(p => p.flightId === flight.id && !['ready', 'rearming', 'lost'].includes(p.phase));
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
export const onFlightDeck = (p: Aircraft) => (p.deckSlot !== undefined && ['ready', 'queued', 'taxi', 'rollout', 'parking', 'rearming'].includes(p.phase)) || (p.phase === 'takeoff' && p.timer <= TAKEOFF_ROLL_SECONDS);
// Keep the next taxi off the centerline until the departing plane is beyond the bow.
const occupiesLaunchLane = (p: Aircraft, actor: FleetActor) => ['taxi', 'rollout'].includes(p.phase)
  || (p.phase === 'parking' && Math.abs((p.deckPosition?.[0] ?? 0) - actor.definition.airWing!.launchPosition[0]) < 6)
  || (p.phase === 'takeoff' && p.timer < TAKEOFF_ROLL_SECONDS + 1);
const TAKEOFF_ACCELERATION = 2 * 140 / TAKEOFF_ROLL_SECONDS ** 2;
const LAUNCH_TAXI_SPEED = 35;
function deckPose(p: Aircraft, actor: FleetActor, local: Vec3) {
  p.deckPosition = [...local]; p.position = localToWorld(local, actor.motion);
  p.heading = actor.motion.heading; p.pitch = actor.motion.pitch; p.bank = actor.motion.roll;
  p.velocity = motionVelocity(actor.motion);
}
function taxi(p: Aircraft, actor: FleetActor, destination: Vec3, speed: number, dt: number): boolean {
  const current = p.deckPosition ?? worldToLocal(p.position, actor.motion);
  const delta = sub(destination, current), distance = length(delta);
  const local = add(current, scale(delta, Math.min(1, speed * dt / (distance || 1))));
  deckPose(p, actor, local);
  if (distance > .1) p.heading = wrapAngle(actor.motion.heading + Math.atan2(delta[0], -delta[2]));
  return distance <= speed * dt;
}
export function createAirWing(def: ShipDefinition, ownerId: string, team: Team): AirWingState | undefined {
  if (!def.airWing) return;
  const state: AirWingState = { launchCooldown: 0, flights: [], flightSequence: 0, transferCooldown: 0, planes: def.airWing.squadrons.flatMap(s => Array.from({ length: s.count }, (_, i) => ({
    id: `${ownerId}/${s.id}/${i + 1}`, ownerId, team, squadronId: s.id, modelId: s.modelId, role: s.role,
    phase: 'ready' as const, position: [0, 0, 0] as Vec3, previousPosition: [0, 0, 0] as Vec3, velocity: [0, 0, 0] as Vec3,
    heading: 0, pitch: 0, bank: 0, hp: 100, ammo: s.role === 'fighter' ? 16 : 0, payload: s.role !== 'fighter', timer: 0, flightTime: 0, cooldown: 0, kills: 0,
    controls: initialFlightControls(), pilot: initialAirPilot(),
  }))) };
  // A balanced ready deck; remaining inventory is stored in the hangar.
  const capacity = Math.min(def.airWing.deckCapacity ?? 18, state.planes.length);
  const groups = def.airWing.squadrons.map(s => state.planes.filter(p => p.squadronId === s.id));
  let slot = 0;
  for (let row = 0; slot < capacity; row++) for (const group of groups) {
    if (slot < capacity && group[row]) group[row].deckSlot = slot++;
  }
  return state;
}
export function airServiceAvailable(actor: FleetActor): boolean {
  const wing = actor.definition.airWing;
  const module = wing && actor.definition.modules.find(m => m.id === wing.serviceModuleId);
  return !!module && !actor.damage.sunk && !actor.damage.stability.combatLost && Math.abs(actor.motion.roll) < .22 && Math.abs(actor.motion.pitch) < .15 && actor.motion.y > -3 && equipmentCondition(actor, actor.definition, module).availability > 0;
}
export function launchSquadron(actor: FleetActor, squadronId: string, target?: FleetActor): number {
  if (!airServiceAvailable(actor)) return 0;
  const state = actor.airWing!;
  if (state.flights.filter(f => activeFlight(f, state.planes)).length >= (actor.definition.airWing!.maxActiveFlights ?? 4)) return 0;
  const planes = state.planes.filter(p => p.squadronId === squadronId && p.phase === 'ready').slice(0, flightSize(actor));
  if (!planes.length) return 0;
  if (planes.some(p => p.role !== 'fighter') && (!target || target.team === actor.team || target.damage.sunk || target.damage.stability.combatLost || target.motion.y < -8)) return 0;
  const number = ++state.flightSequence;
  const id = `${actor.motion.id}/flight-${number}`;
  const name = `${planes[0].role === 'fighter' ? 'Fighter' : planes[0].role === 'dive-bomber' ? 'Dive' : 'Torpedo'} ${number}`;
  state.flights = state.flights.filter(f => activeFlight(f, state.planes) || state.flights.indexOf(f) >= state.flights.length - 12);
  state.flights.push({ id, name, squadronId, planeIds: planes.map(p => p.id), order: planes[0].role === 'fighter' ? { kind: 'defend' } : { kind: 'attack', targetId: target!.motion.id } });
  for (const plane of planes) {
    plane.phase = 'queued'; plane.flightId = id; plane.targetId = target?.motion.id; plane.pilot = initialAirPilot();
    plane.recoveryRequestedAt = undefined; plane.lossReason = undefined;
  }
  return planes.length;
}
export function recallAircraft(actor: FleetActor, flightId?: string): void {
  for (const flight of actor.airWing?.flights ?? []) if (!flightId || flight.id === flightId) { flight.order = { kind: 'return' }; flight.notice = 'Recalled'; }
  for (const p of actor.airWing?.planes ?? []) {
    if (flightId && p.flightId !== flightId) continue;
    if (p.phase === 'queued') p.phase = 'ready';
    else if (p.phase === 'taxi' || (p.phase === 'takeoff' && onFlightDeck(p))) p.phase = 'parking';
    else if (airborne(p) && p.phase !== 'landing') p.phase = 'returning';
  }
}
export function orderFlight(actor: FleetActor, flightId: string, order: AirOrder, actors: FleetActor[]): boolean {
  const flight = actor.airWing?.flights.find(f => f.id === flightId);
  if (!flight || !activeFlight(flight, actor.airWing!.planes) || actor.damage.sunk || actor.damage.stability.combatLost) return false;
  if (order.kind === 'return') { recallAircraft(actor, flightId); return true; }
  const planes = actor.airWing!.planes.filter(p => p.flightId === flightId && ['queued', 'taxi', 'takeoff', 'outbound', 'attack', 'returning'].includes(p.phase));
  if (!planes.length || planes.some(p => p.flightTime > 470 || p.hp < 25)) return false;
  if (order.kind === 'attack') {
    const target = actors.find(a => a.motion.id === order.targetId);
    if (!target || target.team === actor.team || target.damage.sunk || target.damage.stability.combatLost || target.motion.y < -8 || planes.some(p => p.role === 'fighter' || !p.payload)) return false;
  } else {
    if (planes.some(p => p.role !== 'fighter' || p.ammo <= 0)) return false;
    if (order.kind === 'patrol' && (!order.point.every(Number.isFinite) || Math.hypot(order.point[0] - actor.motion.x, order.point[2] - actor.motion.z) > 30000)) return false;
    if (order.kind === 'escort' && (order.flightId === flightId || !actors.some(a => a.team === actor.team && a.airWing?.flights.some(f => f.id === order.flightId && activeFlight(f, a.airWing!.planes))))) return false;
  }
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
export const AIR_TORPEDO: TorpedoPart = {
  id: 'mark-13-game', name: 'Air-dropped torpedo', kind: 'torpedo', diameterM: .57, lengthM: 4.1,
  speed: 23, rangeM: 4500, armingDistanceM: 180, runningDepthM: 2, reloadSeconds: 35,
  launchIntervalSeconds: 3, damage: 480, breachAreaM2: .55,
};
export interface AirContext {
  actors: FleetActor[]; planes: Aircraft[]; shells: Shell[]; torpedoes: Torpedo[]; releases: AirRelease[];
  nextId: () => number; emit: (e: Omit<CombatEvent, 'sequence' | 'tick'>) => void;
}
function lose(p: Aircraft, ctx: AirContext, reason = 'Shot down') {
  p.hp = 0; p.phase = 'lost';
  p.lossReason = reason; p.deckSlot = undefined;
  ctx.emit({ kind: 'aircraft-lost', position: [...p.position], shipId: p.ownerId, message: `${p.modelId} · ${reason}`, aircraft: { id: p.id } });
}
export function stepAircraft(ctx: AirContext, dt: number, time: number) {
  if (dt <= 0) return;
  // Snapshot the whole group before any fighter can change another plane's state.
  for (const p of ctx.planes) {
    p.previousPosition = [...p.position];
    p.previousAttitude = { heading: p.heading, pitch: p.pitch, bank: p.bank };
    p.previousControls = { ...p.controls };
    stepFlightMechanisms(p, dt, onFlightDeck(p));
  }
  let flying = ctx.planes.filter(airborne).length;
  for (const actor of ctx.actors) {
    const state = actor.airWing, wing = actor.definition.airWing;
    if (!state || !wing) continue;
    state.launchCooldown = Math.max(0, state.launchCooldown - dt);
    state.transferCooldown = Math.max(0, state.transferCooldown - dt);
    for (const p of state.planes) if (p.phase === 'returning' || p.phase === 'landing') p.recoveryRequestedAt ??= time;
    const recovery = recoveryQueue(actor);
    const landingClearance = recovery.find(p => {
      if (p.phase !== 'returning' || p.pilot.recoveryStage !== 'final') return false;
      const local = worldToLocal(p.position, actor.motion), aft = local[2] - wing.recoveryPosition[2];
      return aft > 550 && Math.abs(local[0] - wing.recoveryPosition[0]) < 70 && Math.abs(wrapAngle(p.heading - actor.motion.heading)) < .2
        && recovery.every(other => other.phase !== 'landing' || Math.abs(local[2] - worldToLocal(other.position, actor.motion)[2]) > 260);
    });
    const approachingDeck = state.planes.some(p => p.phase === 'landing' && worldToLocal(p.position, actor.motion)[2] - wing.recoveryPosition[2] < 650);
    // Spot one waiting launch at a time. Transfers represent hangar handling; they
    // never put the entire inventory on the deck or consume additional aircraft.
    const waiting = state.planes.find(p => p.phase === 'queued' && p.deckSlot === undefined);
    if (waiting && !approachingDeck && state.transferCooldown <= 0 && airServiceAvailable(actor) && spotAircraft(actor, waiting)) state.transferCooldown = 4;
    if (actor.controller === 'bot' && time >= 5) {
      const validTarget = (a: FleetActor) => a.team !== actor.team && !a.damage.sunk && !a.damage.stability.combatLost && a.motion.y > -8;
      const target = ctx.actors.find(a => a.motion.id === actor.targetId && validTarget(a)) ?? ctx.actors.find(validTarget);
      for (const squadron of wing.squadrons) if (!state.planes.some(p => p.squadronId === squadron.id && !['ready', 'rearming', 'lost'].includes(p.phase))) launchSquadron(actor, squadron.id, target);
    }
    for (const [i, p] of state.planes.entries()) {
      p.cooldown = Math.max(0, p.cooldown - dt);
      if (p.phase === 'lost') continue;
      if (actor.damage.sunk && (onFlightDeck(p) || !airborne(p))) { p.hp = 0; p.phase = 'lost'; p.deckSlot = undefined; p.lossReason = 'Carrier lost'; continue; }
      if (p.phase === 'ready' || p.phase === 'queued' || p.phase === 'rearming') {
        if (p.deckSlot !== undefined) deckPose(p, actor, aircraftDeckSpot(actor, p));
        if (p.phase === 'rearming' && airServiceAvailable(actor)) {
          p.timer -= dt;
          if (p.timer <= 0) { p.phase = 'ready'; p.ammo = p.role === 'fighter' ? 16 : 0; p.payload = p.role !== 'fighter'; p.hp = 100; }
        }
        if (p.phase === 'queued' && p.deckSlot !== undefined && state.launchCooldown <= 0 && flying < MAX_AIRBORNE && airServiceAvailable(actor)
          && !approachingDeck && !state.planes.some(other => occupiesLaunchLane(other, actor))) {
          p.phase = 'taxi'; p.timer = 0; p.flightTime = 0;
        } else continue;
      }
      if (p.phase === 'taxi' || p.phase === 'parking' || p.phase === 'rollout') {
        if (p.phase === 'rollout') {
          p.timer += dt;
          const local = p.deckPosition!;
          deckPose(p, actor, [local[0], local[1], local[2] - Math.max(0, 35 * (1 - p.timer / 3)) * dt]);
          if (p.timer >= 3) p.phase = 'parking';
        } else {
          const destination = p.phase === 'parking' ? aircraftDeckSpot(actor, p) : add(wing.launchPosition, [0, deckClearance(p), 0]);
          // Clear the parking row laterally before moving along the flight lane.
          const current = p.deckPosition!;
          const waypoint: Vec3 = Math.abs(current[0] - destination[0]) > .1 ? [destination[0], destination[1], current[2]] : destination;
          const arrived = taxi(p, actor, waypoint, p.phase === 'taxi' ? LAUNCH_TAXI_SPEED : 12, dt) && length(sub(waypoint, destination)) < .1;
          if (arrived && p.phase === 'parking') { p.phase = 'rearming'; p.timer = wing.rearmSeconds; p.recoveryRequestedAt = undefined; }
          else if (arrived && (!airServiceAvailable(actor) || flying >= MAX_AIRBORNE)) { p.phase = 'parking'; }
          else if (arrived) {
            flying++; p.phase = 'takeoff'; p.timer = 0; p.flightTime = 0; state.launchCooldown = wing.launchIntervalSeconds;
            deckPose(p, actor, destination);
            ctx.emit({ kind: 'aircraft-launch', position: [...p.position], shipId: p.ownerId, message: `${p.modelId} launched`, aircraft: { id: p.id } });
          }
        }
        continue;
      }
      p.flightTime += dt; p.timer += dt;
      if (p.flightTime > 650) { lose(p, ctx, 'Endurance exhausted'); continue; }
      if ((p.flightTime > 470 || p.hp < 25) && p.phase !== 'landing') p.phase = 'returning';
      const carrier = localToWorld(add(wing.recoveryPosition, [0, deckClearance(p), 0]), actor.motion);
      // Approximate AA envelope from surviving, supplied light gun mounts. No render/GPU input.
      for (const enemy of ctx.actors) {
        if (enemy.team === p.team || enemy.damage.sunk || enemy.damage.stability.combatLost || enemy.motion.y < -1) continue;
        const distance = length(sub(p.position, [enemy.motion.x, enemy.motion.y, enemy.motion.z]));
        if (distance > 1100) continue;
        const guns = enemy.definition.mounts.filter((m, index) => m.weapon.caliberM <= .04 && enemy.mounts[index].hp > 0 && enemy.mounts[index].ammo > 0 && (!m.magazineId || equipmentCondition(enemy, enemy.definition, enemy.definition.modules.find(v => v.id === m.magazineId)!).availability > 0)).length;
        p.hp -= Math.min(4, guns * .24) * (1 - distance / 1300) * dt;
      }
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
              const separated = state.planes.every(other => other === p || other.phase !== 'landing' || Math.abs(aft - (worldToLocal(other.position, actor.motion)[2] - wing.recoveryPosition[2])) > 260);
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
            p.phase = 'rollout'; p.timer = 0; flying--;
            deckPose(p, actor, [next[0], deckY, next[2]]);
            ctx.emit({ kind: 'aircraft-recovered', position: [...p.position], shipId: p.ownerId, message: `${p.modelId} landed`, aircraft: { id: p.id } });
          } else if (next[2] < wing.recoveryPosition[2] - 30 || (aft < 250 && Math.abs(next[0] - wing.recoveryPosition[0]) > 30)) {
            p.phase = 'returning'; p.pilot.recoveryStage = 'marshal';
          }
        }
        continue;
      }
      if (p.role === 'fighter') {
        if (!p.ammo || p.flightTime > 260) { p.phase = 'returning'; continue; }
        const flight = state.flights.find(f => f.id === p.flightId);
        let patrol: Vec3 = [...carrier];
        if (flight?.order.kind === 'patrol') patrol = flight.order.point;
        if (flight?.order.kind === 'escort') {
          const escorted = ctx.planes.find(other => other.flightId === (flight.order as { flightId: string }).flightId && airborne(other) && !onFlightDeck(other));
          if (escorted) patrol = escorted.position;
          else if (!ctx.actors.some(a => a.airWing?.flights.some(f => f.id === (flight.order as { flightId: string }).flightId && activeFlight(f, a.airWing!.planes)))) {
            flight.order = { kind: 'defend' }; flight.notice = 'Escort complete · Defending carrier';
          }
        }
        const hostile = fighterTarget(p, ctx.planes, patrol, dt);
        if (hostile) {
          p.phase = 'attack';
          const pursuing = steerFighter(p, hostile, ctx.planes, dt);
          const gun = fighterGunAim(p, hostile);
          const onAim = pursuing && gun.distance > 80 && gun.distance < 600 && gun.alignment > .996
            && clearFighterLane(p, gun.point, ctx.planes);
          p.pilot.aimTime = onAim ? p.pilot.aimTime + dt : 0;
          if (onAim && p.pilot.aimTime >= .12 && p.cooldown <= 0) {
            p.ammo--; p.cooldown = .4;
            hostile.hp -= 22 * clamp((gun.alignment - .996) / .004, .3, 1) * clamp(1.3 - gun.distance / 900, .5, 1);
            ctx.emit({ kind: 'aircraft-fire', position: [...p.position], shipId: p.ownerId, message: 'Fighter guns', aircraft: { id: p.id, target: gun.point } });
            if (hostile.hp <= 0) { p.kills++; lose(hostile, ctx); }
          }
        } else {
          p.phase = 'outbound'; p.pilot.aimTime = 0;
          const anchor: Vec3 = [patrol[0], Math.max(420, patrol[1] + 80) + (i % 3) * 35, patrol[2]];
          fly(p, orbitPoint(p, anchor, 850 + (i % 3) * 100), 95, dt);
        }
        continue;
      }
      const target = ctx.actors.find(a => a.motion.id === p.targetId && a.team !== p.team && !a.damage.sunk && !a.damage.stability.combatLost && a.motion.y > -8);
      if (!target || !p.payload) {
        if (!target && p.payload) { const flight = state.flights.find(f => f.id === p.flightId); if (flight) flight.notice = 'Target unavailable · Returning armed'; }
        p.phase = 'returning'; continue;
      }
      const targetPoint: Vec3 = [target.motion.x, Math.max(0, target.motion.y + target.definition.hull.depth - target.definition.hull.draft), target.motion.z];
      const distance = Math.hypot(targetPoint[0] - p.position[0], targetPoint[2] - p.position[2]);
      const ingress = strikeIngress(p, target, targetPoint);
      const heading = p.pilot.attackHeading!;
      const forward: Vec3 = [Math.sin(heading), 0, -Math.cos(heading)];
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
        // The last two aircraft trail the leader's approach with separate heights.
        ingress[1] += (i % 3) * (p.role === 'dive-bomber' ? 30 : 12);
        fly(p, ingress, p.role === 'dive-bomber' ? 95 : 80, dt);
        if (Math.hypot(p.position[0] - ingress[0], p.position[2] - ingress[2]) < 240 && Math.abs(p.position[1] - ingress[1]) < 120) p.pilot.attackStage = 'run';
        continue;
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
        if (error < 22 && p.pitch < -.25 && p.position[1] > targetPoint[1] + 90 && ctx.shells.length < 256) {
          const id = ctx.nextId();
          ctx.shells.push({ id, ownerId: p.ownerId, weaponLabel: '500 lb HE bomb', position: add(p.position, [0, -1, 0]), velocity: [...p.velocity], age: 0, penetrationMm: 0, damage: 380, caliberM: .35, visited: [], ammunition: 'he', type: 'HE', he: { explosiveKg: 120, fragmentPenetrationMm: 75, damage: 380, stockFraction: 1, basis: 'Provisional 500 lb gameplay bomb; contact fuze' } });
          p.payload = false; p.phase = 'returning';
          ctx.emit({ kind: 'bomb-release', position: [...p.position], shipId: p.ownerId, message: 'Bomb away', shell: { id, caliberM: .35, velocity: [...p.velocity], ammunition: 'he', type: 'HE' }, aircraft: { id: p.id } });
        } else if (p.position[1] < targetPoint[1] + 100 || dot(sub(targetPoint, p.position), forward) < -100) p.pilot.attackStage = 'egress';
      } else {
        // Include the airborne travel before solving the slower underwater run.
        const fall = (-3 + Math.sqrt(9 + 19.62 * Math.max(0, p.position[1]))) / 9.81;
        const waterEntry = add(p.position, scale([p.velocity[0], 0, p.velocity[2]], fall));
        const futureTarget = add(targetPoint, scale(motionVelocity(target.motion), fall));
        const aim = torpedoIntercept(waterEntry, futureTarget, motionVelocity(target.motion), AIR_TORPEDO.speed) ?? futureTarget;
        fly(p, [aim[0], 26, aim[2]], 70, dt, { bankLimit: distance > 1600 ? .72 : .35, altitudeLookahead: 450 });
        const aligned = dot(normalize([p.velocity[0], 0, p.velocity[2]]), normalize([aim[0] - p.position[0], 0, aim[2] - p.position[2]])) > .999;
        if (distance < 1050 && distance > 650 && p.position[1] < 38 && p.position[1] > 15 && Math.abs(p.bank) < .12 && Math.abs(p.pitch) < .08 && aligned
          && ctx.releases.length + ctx.torpedoes.length < 128 && clearTorpedoLane(actor, waterEntry, aim, AIR_TORPEDO.speed, ctx.actors)) {
          ctx.releases.push({ id: ctx.nextId(), ownerId: p.ownerId, position: [...p.position], velocity: [p.velocity[0], -3, p.velocity[2]] });
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
      const velocity = scale(normalize([release.velocity[0], 0, release.velocity[2]]), AIR_TORPEDO.speed);
      const position: Vec3 = [release.position[0], -AIR_TORPEDO.runningDepthM, release.position[2]];
      ctx.torpedoes.push({ id: release.id, ownerId: release.ownerId, tubeId: 'aircraft.payload', position, velocity, distance: 0, age: 0, weapon: AIR_TORPEDO });
      ctx.emit({ kind: 'torpedo-launch', position, shipId: release.ownerId, message: 'Air torpedo entered water', torpedo: { id: release.id, velocity, diameterM: AIR_TORPEDO.diameterM } });
      ctx.releases.splice(i, 1);
    }
  }
}
