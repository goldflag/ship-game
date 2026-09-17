/** Read-only helpers over a hull's air wing as the frame carries it: which
 * planes are aloft or on deck, where a deck spot is, how the wing's flights are
 * addressed. The battle decides all of it in Rust; this only reads. */
import type { ShipDefinition, Vec3 } from '../ships/blueprint';
import type { Aircraft as SessionAircraft, AirFlight, FleetActor as SessionActor } from './session/elements';
import { physicalLoss } from './session/battleRules';
import { equipmentCondition } from './machinery';
import { aircraftGroundPose } from './aircraftGroundPose';
import { clamp } from './geometry';
import { TAKEOFF_ROLL_SECONDS } from './aircraftPose';
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
export const terminalAircraft = (p: Pick<SessionAircraft, 'phase'>) => p.phase === 'lost' || p.phase === 'withdrawn';
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
export function recoveryQueue(actor: SessionActor): SessionAircraft[] {
  return (actor.airWing?.planes ?? []).filter(p => p.phase === 'returning' || p.phase === 'landing').sort((a, b) =>
    Number(b.phase === 'landing') - Number(a.phase === 'landing')
    || Number(b.flightTime > 470) - Number(a.flightTime > 470)
    || (a.flightTime > 470 && b.flightTime > 470 ? b.flightTime - a.flightTime : 0)
    || (a.recoveryRequestedAt ?? 0) - (b.recoveryRequestedAt ?? 0) || a.id.localeCompare(b.id));
}
