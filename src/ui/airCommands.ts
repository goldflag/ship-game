import type { AircraftRole, Vec3 } from '../ships/blueprint';
import type { AirOrder } from '../simulation/aircraft';

export const SQUADRON_ACTIONS = [
  { kind: 'patrol', key: 'L', label: 'Loiter', target: 'water', role: 'all' },
  { kind: 'attack', key: 'A', label: 'Strike', target: 'an enemy ship', role: 'bomber' },
  { kind: 'defend', key: 'D', label: 'Defend', target: 'a friendly ship', role: 'fighter' },
  { kind: 'intercept', key: 'I', label: 'Intercept', target: 'an enemy squadron', role: 'fighter' },
  { kind: 'escort', key: 'E', label: 'Escort', target: 'another friendly squadron', role: 'fighter' },
] as const;
export type SquadronAction = typeof SQUADRON_ACTIONS[number];
export type SquadronTarget = { kind: 'water'; point: Vec3 } | { kind: 'ship' | 'squadron'; id: string; team: string };
export const actionAvailable = (action: SquadronAction, role: AircraftRole) => action.role === 'all' || (action.role === 'fighter' ? role === 'fighter' : role !== 'fighter');

/** Targeting is shared by buttons/hotkeys; final authority remains the CPU order validator. */
export function squadronTargetOrder(action: SquadronAction['kind'] | undefined, target: SquadronTarget): AirOrder | undefined {
  if (target.kind === 'water') return !action || action === 'patrol' ? { kind: 'patrol', point: target.point } : undefined;
  if (target.kind === 'ship') {
    const kind = target.team === 'enemy' ? 'attack' : 'defend';
    return !action || action === kind ? { kind, targetId: target.id } : undefined;
  }
  const kind = target.team === 'enemy' ? 'intercept' : 'escort';
  return !action || action === kind ? { kind, flightId: target.id } : undefined;
}
