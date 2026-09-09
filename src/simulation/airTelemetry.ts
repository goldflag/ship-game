import legacyAir from '../../assets/gameplay/legacy-air.v1.json';
import type { EndurancePolicy } from '../multiplayer/generated/EndurancePolicy';
import type { AircraftRole, Vec3 } from '../ships/blueprint';
import type { FleetActor } from './battle';
import { squadronFlights, activeFlight, airServiceAvailable, airborne, deckCapacity, flightSize, onFlightDeck, recoveryQueue, type Aircraft, type AirOrder } from './aircraft';
import { length, sub } from './geometry';

export type AirStatus = 'ready' | 'launching' | 'on-mission' | 'returning' | 'servicing' | 'lost' | 'hangar' | 'handling';
export const airStatus = (p: Aircraft): AirStatus => p.phase === 'lost' ? 'lost' : p.phase === 'ready' ? 'ready' : p.phase === 'hangar' ? 'hangar'
  : ['raising', 'lowering'].includes(p.phase) ? 'handling'
  : ['queued', 'taxi', 'takeoff', 'launch-ready'].includes(p.phase) ? 'launching' : ['returning', 'landing'].includes(p.phase) ? 'returning'
  : ['rollout', 'parking', 'rearming', 'repairing'].includes(p.phase) ? 'servicing' : 'on-mission';
export const AIR_STATUS_LABELS: Record<AirStatus, string> = { ready: 'Ready', launching: 'Launching', 'on-mission': 'On mission', returning: 'Returning', servicing: 'Servicing', lost: 'Lost', hangar: 'In hangar', handling: 'Handling' };
export interface FlightSummary {
  id: string; name: string; squadronId: string; role: AircraftRole; order: AirOrder;
  active: boolean; status: AirStatus; total: number; surviving: number; airborne: number;
  hp: number; armed: number; enduranceSeconds: number | null; rearmSeconds: number;
  position: Vec3; destination: Vec3; activity: string; heading: number; targetName?: string; route: Vec3[]; etaSeconds?: number;
  queuePosition?: number; notice?: string; aircraftIds: string[];
  deck?: { onDeck: number; inHangar: number; canRaise: boolean; canStow: boolean; canRearm: boolean; canRepair: boolean; canLaunch: boolean; reason?: string };
}
export function airWingTelemetry(actor: FleetActor, actors: FleetActor[]) {
  const state = actor.airWing, wing = actor.definition.airWing;
  if (!state || !wing) return undefined;
  const queue = recoveryQueue(actor);
  const endurance: EndurancePolicy = state.deck?.endurance ?? { ...legacyAir.endurance, kind: 'timed' };
  const remaining = (elapsed: number): number | null => endurance.kind === 'disabled' ? null : Math.max(0, Math.floor(endurance.exhaustionSeconds - elapsed));
  const lowEndurance = (plane: Aircraft) => endurance.kind !== 'disabled' && plane.flightTime > (plane.role === 'fighter' ? endurance.fighterRecallSeconds : endurance.recallSeconds);
  const counts: Record<AirStatus, number> = { ready: 0, launching: 0, 'on-mission': 0, returning: 0, servicing: 0, lost: 0, hangar: 0, handling: 0 };
  state.planes.forEach(p => { counts[airStatus(p)]++; });
  const groups: FlightSummary[] = squadronFlights(actor).flatMap(f => {
    const planes = state.planes.filter(p => f.planeIds.includes(p.id));
    if (!planes.length) return [];
    const surviving = planes.filter(p => p.phase !== 'lost');
    const flying = surviving.filter(airborne);
    const lead = flying.find(p => !['returning', 'landing'].includes(p.phase)) ?? flying[0] ?? surviving[0] ?? planes[0];
    const active = activeFlight(f, state.planes);
    const status = !surviving.length ? 'lost' : surviving.some(p => airStatus(p) === 'launching') ? 'launching'
      : surviving.some(p => airStatus(p) === 'on-mission') ? 'on-mission' : surviving.some(p => airStatus(p) === 'returning') ? 'returning'
      : surviving.some(p => airStatus(p) === 'servicing') ? 'servicing' : surviving.some(p => airStatus(p) === 'handling') ? 'handling'
      : surviving.some(p => p.phase === 'hangar') ? 'hangar' : 'ready';
    const target = (f.order.kind === 'attack' || f.order.kind === 'defend') ? actors.find(a => a.motion.id === (f.order as { targetId: string }).targetId) : undefined;
    const escort = (f.order.kind === 'escort' || f.order.kind === 'intercept') ? actors.flatMap(a => a.airWing?.flights ?? []).find(g => g.id === (f.order as { flightId: string }).flightId) : undefined;
    const home: Vec3 = [actor.motion.x, actor.motion.y, actor.motion.z];
    const position = flying.length ? flying.reduce<Vec3>((point, p) => point.map((v, i) => v + p.position[i] / flying.length) as Vec3, [0, 0, 0]) : home;
    const reportMission = f.order.kind === 'strike' || f.order.kind === 'intercept-contact';
    const destination: Vec3 = status === 'returning' || f.order.kind === 'return' ? home : target ? [target.motion.x, 0, target.motion.z]
      : reportMission ? lead.navigationTarget ?? position : f.order.kind === 'patrol' ? [...f.order.point] : escort ? actors.flatMap(a => a.airWing?.planes ?? []).find(p => p.flightId === escort.id && airborne(p))?.position ?? home : home;
    const route: Vec3[] = flying.length ? [position, ...(lead.navigationTarget ? [[...lead.navigationTarget] as Vec3] : []), [...destination]] : [];
    const distance = route.slice(1).reduce((n, point, i) => n + length(sub(point, route[i])), 0);
    const queueIndex = queue.findIndex(p => p.flightId === f.id);
    const pendingClearance = state.deck?.queue.some(r => r.flightId === f.id && r.automatic);
    const allOnDeck = surviving.length > 0 && surviving.every(p => p.phase === 'ready' && onFlightDeck(p));
    const stowable = surviving.some(p => ['ready', 'rearming'].includes(p.phase) && onFlightDeck(p));
    const raiseable = surviving.some(p => p.phase === 'hangar') && surviving.every(p => p.phase === 'hangar' || p.phase === 'ready' && onFlightDeck(p));
    const deck = state.deck ? { onDeck: surviving.filter(onFlightDeck).length, inHangar: surviving.filter(p => ['hangar', 'repairing'].includes(p.phase)).length,
      canRaise: !pendingClearance && raiseable, canStow: !pendingClearance && stowable,
      canRepair: !pendingClearance && (stowable || surviving.some(p => p.phase === 'hangar' && p.hp < state.deck!.repairCeilingHp)),
      canRearm: !pendingClearance && allOnDeck, canLaunch: !pendingClearance && allOnDeck && surviving.every(p => p.hp >= 25),
      reason: pendingClearance ? 'Clearing space for flight operations' : flying.length && surviving.some(p => !airborne(p)) ? 'Waiting for group members to return'
        : surviving.some(p => p.phase === 'repairing') ? 'Repair in progress'
        : allOnDeck && surviving.some(p => p.hp < 25) ? 'Repair below before launching' : undefined } : undefined;
    return [{ id: f.id, name: f.name, squadronId: f.squadronId, role: lead.role, order: structuredClone(f.order), active, status,
      total: planes.length, surviving: surviving.length, airborne: flying.length,
      hp: surviving.length ? Math.round(surviving.reduce((n, p) => n + p.hp, 0) / surviving.length) : 0,
      armed: surviving.filter(p => p.role === 'fighter' ? p.ammo > 0 : p.payload).length,
      enduranceSeconds: remaining(Math.max(0, ...flying.map(p => p.flightTime))),
      rearmSeconds: Math.ceil(Math.max(0, ...surviving.filter(p => ['rearming', 'repairing'].includes(p.phase)).map(p => p.timer))),
      position, destination: [destination[0], 0, destination[2]],
      activity: deck?.reason ?? (status !== 'on-mission' ? AIR_STATUS_LABELS[status]
        : surviving.some(p => p.phase === 'attack') ? (lead.role === 'fighter' ? 'Engaging' : 'Attacking')
        : f.order.kind === 'patrol' ? (Math.hypot(position[0] - destination[0], position[2] - destination[2]) < 1300 ? 'Loitering' : 'En route')
        : f.order.kind === 'defend' ? 'Defending' : (f.order.kind === 'intercept' || f.order.kind === 'intercept-contact') ? 'Intercepting' : f.order.kind === 'escort' ? 'Escorting' : 'En route'),
      heading: lead.heading, route, targetName: target?.definition.name ?? escort?.name ?? (reportMission ? 'reported contact' : undefined),
      etaSeconds: flying.length && (status === 'returning' || f.order.kind === 'attack') ? Math.ceil(distance / Math.max(35, length(lead.velocity))) : undefined,
      queuePosition: queueIndex >= 0 ? queueIndex + 1 : undefined,
      notice: f.notice ?? (flying.some(lowEndurance) ? 'Low endurance · Returning to carrier' : undefined), aircraftIds: planes.map(p => p.id), deck,
    } satisfies FlightSummary];
  });
  return {
    deck: state.deck,
    available: state.deck ? !state.deck.suspended : airServiceAvailable(actor), total: state.planes.length, counts,
    activeFlights: groups.filter(g => g.active).length, maxActiveFlights: state.deck ? state.deck.activeFlightLimit : wing.maxActiveFlights ?? 4, flightSize: flightSize(actor),
    deckCapacity: deckCapacity(actor), onDeck: state.planes.filter(onFlightDeck).length,
    inHangar: state.planes.filter(p => p.phase !== 'lost' && !airborne(p) && !onFlightDeck(p)).length,
    recoveryCount: queue.length,
    squadrons: wing.squadrons.map(s => {
      const planes = state.planes.filter(p => p.squadronId === s.id);
      return { id: s.id, name: s.name, role: s.role, total: s.count, ready: planes.filter(p => p.phase === 'ready').length,
        queued: planes.filter(p => ['queued', 'taxi'].includes(p.phase)).length, airborne: planes.filter(airborne).length,
        rearming: planes.filter(p => airStatus(p) === 'servicing').length, lost: planes.filter(p => p.phase === 'lost').length,
        rearmSeconds: Math.ceil(Math.max(0, ...planes.filter(p => p.phase === 'rearming').map(p => p.timer))), kills: planes.reduce((n, p) => n + p.kills, 0) };
    }),
    groups,
    flights: state.planes.map(p => ({ id: p.id, flightId: p.flightId, modelId: p.modelId, role: p.role, phase: p.phase, status: airStatus(p),
      hp: p.hp, payload: p.payload, ammo: p.ammo, location: p.phase === 'lost' ? 'Lost' : onFlightDeck(p) ? 'Deck' : airborne(p) ? 'Airborne' : 'Hangar',
      followable: p.phase !== 'lost' && (onFlightDeck(p) || airborne(p)), lossReason: p.lossReason,
      enduranceSeconds: remaining(p.flightTime),
    })),
  };
}
export type AirWingTelemetry = NonNullable<ReturnType<typeof airWingTelemetry>>;
