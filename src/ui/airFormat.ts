import type { AircraftRole } from '../ships/blueprint';
import type { FlightSummary } from '../simulation/airTelemetry';

/** m:ss for endurance, rearm and ETA readings. */
export const duration = (seconds: number) => `${Math.floor(Math.max(0, Math.ceil(seconds)) / 60)}:${String(Math.max(0, Math.ceil(seconds)) % 60).padStart(2, '0')}`;
export const roleLabel = (role: AircraftRole) => role === 'fighter' ? 'Fighters' : role === 'dive-bomber' ? 'Dive bombers' : 'Torpedo bombers';
export const roleIcon = (role: AircraftRole): 'fighter' | 'bomb' | 'torpedo' => role === 'fighter' ? 'fighter' : role === 'dive-bomber' ? 'bomb' : 'torpedo';
export const mission = (f: FlightSummary) => !['on-mission', 'launching'].includes(f.status) ? f.activity : f.order.kind === 'search-area' ? `${f.order.policy === 'strike' ? 'Search and strike' : f.order.policy === 'shadow' ? 'Shadow and report' : 'Search and report'} · ${f.order.radiusM / 1000} km radius · ${f.order.altitude} altitude`
  : (f.order.kind === 'attack' || f.order.kind === 'strike') ? `Strike ${f.targetName ?? 'ship'}`
  : (f.order.kind === 'intercept' || f.order.kind === 'intercept-contact') ? `Intercept ${f.targetName ?? 'squadron'}` : f.order.kind === 'escort' ? `Escort ${f.targetName ?? 'squadron'}`
  : f.order.kind === 'patrol' ? 'Loiter at station' : f.order.kind === 'return' ? 'Return to carrier' : `Defend ${f.targetName ?? 'carrier'}`;

/** A group's armament in the words the box foot uses: gun bursts for fighters,
 * planes still carrying for bombers. Low once the fighters average four bursts or fewer. */
export function groupArmament(planes: readonly { role: string; hp: number; phase: string; ammo: number; payload: boolean }[]): { label: string; low: boolean; empty: boolean } {
  const alive = planes.filter(p => p.hp > 0 && !['lost', 'withdrawn'].includes(p.phase));
  if (alive.length && alive.every(p => p.role === 'fighter')) {
    const bursts = alive.reduce((n, p) => n + Math.max(0, p.ammo), 0);
    return { label: `${bursts} bursts`, low: bursts > 0 && bursts <= 4 * alive.length, empty: bursts === 0 };
  }
  const carrying = alive.filter(p => p.role === 'fighter' ? p.ammo > 0 : p.payload).length;
  return { label: `${carrying} carrying`, low: false, empty: carrying === 0 };
}
