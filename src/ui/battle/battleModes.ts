import type { BattleSetup } from '../../simulation/battle';
import type { FleetBudget } from '../../multiplayer/generated/FleetBudget';
import type { PveRequest } from '../../multiplayer/generated/PveRequest';
import { shipPreset, shipPresets } from '../../ships/presets';
import { fleetBudget } from '../../simulation/battleRules';
import { budgetError } from '../pveSetup';

export type BattleMode = 'custom' | 'pve' | 'duel';
export const BATTLE_MODES: readonly { id: BattleMode; name: string; summary: string }[] = [
  { id: 'custom', name: 'Custom battle', summary: 'Build both fleets. You command one ship; bots sail the rest.' },
  { id: 'pve', name: 'Fleet command', summary: 'Assemble task groups and command the whole fleet against a mission fleet.' },
  { id: 'duel', name: '1v1 online', summary: 'Up to 8 vessels and 2 carriers within 200,000 tonnes against another commander.' },
];
export const isBattleMode = (value: unknown): value is BattleMode => BATTLE_MODES.some(mode => mode.id === value);
export const battleModeName = (mode: BattleMode) => BATTLE_MODES.find(entry => entry.id === mode)!.name;
export const BATTLE_MODE_STORAGE_KEY = 'naval-battle-mode-v1';
export function loadBattleMode(): BattleMode {
  try { const saved = localStorage.getItem(BATTLE_MODE_STORAGE_KEY); return isBattleMode(saved) ? saved : 'custom'; }
  catch { return 'custom'; }
}
export function saveBattleMode(mode: BattleMode): void {
  try { localStorage.setItem(BATTLE_MODE_STORAGE_KEY, mode); } catch { /* Remembering the mode is optional. */ }
}

const definitions = new Map(Object.keys(shipPresets).map(id => [id, shipPreset(id)]));
/** Ships the player brings, commanded ship first, as the fleet moves between modes. */
export function fleetForCarry(mode: BattleMode, state: { setup: BattleSetup; request?: PveRequest; duel: string[] }): string[] {
  if (mode === 'custom') return [state.setup.playerShipId, ...state.setup.friendlyBots.map(bot => typeof bot === 'string' ? bot : bot.shipId)];
  if (mode === 'pve') return state.request?.ships.map(ship => ship.presetId) ?? [];
  return state.duel;
}
/** A fleet only carries into a mode the player has not started filling, and only as far as that mode's rules allow. */
export function carryToCustom(setup: BattleSetup, ids: readonly string[]): BattleSetup {
  if (!ids.length || setup.friendlyBots.length || setup.enemies.length) return setup;
  return { ...setup, playerShipId: ids[0], friendlyBots: ids.slice(1).map(shipId => ({ shipId, aiLevel: 'normal' as const })), spawns: undefined };
}
export function carryToDuel(fleet: string[], initialShipId: string, ids: readonly string[]): string[] {
  if (!ids.length || fleet.length > 1 || (fleet.length === 1 && fleet[0] !== initialShipId)) return fleet;
  const next: string[] = [];
  for (const id of ids) if (!fleetBudget([...next, id], definitions).error) next.push(id);
  return next.length ? next : fleet;
}
export function carryToPve(request: PveRequest, ids: readonly string[], eligiblePresets: readonly string[], budget: FleetBudget, nextId: () => string): PveRequest {
  if (!ids.length || request.ships.length) return request;
  const groupId = request.groups[0]?.id;
  if (!groupId) return request;
  let ships = request.ships;
  for (const presetId of ids) {
    if (!eligiblePresets.includes(presetId)) continue;
    const candidate = [...ships, { id: nextId(), presetId, groupId }];
    if (!budgetError(candidate, budget)) ships = candidate;
  }
  return ships === request.ships ? request : { ...request, ships };
}
