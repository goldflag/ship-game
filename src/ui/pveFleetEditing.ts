import type { FleetBudget } from '../multiplayer/generated/FleetBudget';
import type { PveRequest } from '../multiplayer/generated/PveRequest';
import { budgetError } from './pveSetup';

export type FleetTransfer = { kind: 'catalog' | 'unit'; id: string };

/** Catalog drops create identities; moving an existing ship preserves its identity. */
export function transferFleetShip(request: PveRequest, transfer: FleetTransfer, groupId: string, newId: string, eligiblePresets: readonly string[], budget: FleetBudget): { request: PveRequest; error?: string } {
  if (!request.groups.some(group => group.id === groupId)) return { request, error: 'Choose an existing group.' };
  if (transfer.kind === 'unit') {
    if (!request.ships.some(ship => ship.id === transfer.id)) return { request, error: 'That ship is no longer in the fleet.' };
    return { request: { ...request, ships: request.ships.map(ship => ship.id === transfer.id ? { ...ship, groupId } : ship) } };
  }
  if (!eligiblePresets.includes(transfer.id)) return { request, error: 'That ship is unavailable for this battle.' };
  if (request.ships.some(ship => ship.id === newId)) return { request, error: 'That ship identity is already in use.' };
  const ships = [...request.ships, { id: newId, presetId: transfer.id, groupId }];
  const error = budgetError(ships, budget);
  return error ? { request, error } : { request: { ...request, ships } };
}
