import type { AircraftRole } from '../ships/blueprint';
import type { FlightSummary } from '../simulation/airTelemetry';

/** m:ss for endurance, rearm and ETA readings. */
export const duration = (seconds: number) => `${Math.floor(Math.max(0, Math.ceil(seconds)) / 60)}:${String(Math.max(0, Math.ceil(seconds)) % 60).padStart(2, '0')}`;
export const roleLabel = (role: AircraftRole) => role === 'fighter' ? 'Fighters' : role === 'dive-bomber' ? 'Dive bombers' : 'Torpedo bombers';
export const roleIcon = (role: AircraftRole): 'fighter' | 'bomb' | 'torpedo' => role === 'fighter' ? 'fighter' : role === 'dive-bomber' ? 'bomb' : 'torpedo';
export const mission = (f: FlightSummary) => (f.order.kind === 'attack' || f.order.kind === 'strike') ? `Strike ${f.targetName ?? 'ship'}`
  : (f.order.kind === 'intercept' || f.order.kind === 'intercept-contact') ? `Intercept ${f.targetName ?? 'squadron'}` : f.order.kind === 'escort' ? `Escort ${f.targetName ?? 'squadron'}`
  : f.order.kind === 'patrol' ? 'Loiter at station' : f.order.kind === 'return' ? 'Return to carrier' : `Defend ${f.targetName ?? 'carrier'}`;
