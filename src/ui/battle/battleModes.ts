import type { BattleSetup } from '../../simulation/battle';
import type { FleetBudget } from '../../multiplayer/generated/FleetBudget';
import type { PveRequest } from '../../multiplayer/generated/PveRequest';
import { shipPreset, shipPresets } from '../../ships/presets';
import { fleetBudget } from '../../simulation/battleRules';
import { budgetError } from '../pveSetup';

export type BattleMode = 'custom' | 'pve' | 'duel';
/** One line of the sortie board's ledger: the same four questions answered for every mode. */
export interface BattleModeFact { label: 'You' | 'Enemy' | 'Fleet' | 'Needs'; value: string; note?: string }
export interface BattleModeInfo {
  id: BattleMode; name: string;
  /** One line for menus and the dialog header. */
  summary: string;
  /** Two lines for the sortie board card. */
  pitch: string;
  /** The card's call to action. */
  action: string;
  ledger: readonly BattleModeFact[];
  online?: boolean;
}
export const BATTLE_MODES: readonly BattleModeInfo[] = [
  { id: 'custom', name: 'Custom battle', summary: 'Build both fleets. You command one ship; bots sail the rest.',
    pitch: 'Build both fleets yourself. You take the helm of one ship; bots sail the rest on either side.', action: 'Set up a custom battle',
    ledger: [{ label: 'You', value: 'One ship, direct control', note: 'Bots get an AI level each' }, { label: 'Enemy', value: 'Ships you pick' }, { label: 'Fleet', value: 'Any size, any ship' }, { label: 'Needs', value: 'Nothing · offline' }] },
  { id: 'pve', name: 'Fleet command', summary: 'Assemble task groups and command the whole fleet against a mission fleet.',
    pitch: 'Assemble task groups and command the whole fleet from the chart against a hidden mission fleet.', action: 'Set up a mission',
    ledger: [{ label: 'You', value: 'The whole fleet, by orders', note: 'Formations, courses, air ops' }, { label: 'Enemy', value: 'Generated mission fleet', note: 'Easy · Normal · Hard' }, { label: 'Fleet', value: 'Within a tonnage budget', note: 'Two task groups' }, { label: 'Needs', value: 'Mission content · offline' }] },
  { id: 'duel', name: '1v1 online', summary: 'Up to 8 vessels and 2 carriers within 200,000 tonnes against another commander.',
    pitch: 'Bring a fleet within the budget and fight another commander. Queue up or share a match code.', action: 'Find an opponent', online: true,
    ledger: [{ label: 'You', value: 'Your ship; bots sail your escorts' }, { label: 'Enemy', value: 'Another player' }, { label: 'Fleet', value: 'Up to 8 vessels, 2 carriers', note: '200,000 t total' }, { label: 'Needs', value: 'Connection · matchmaking' }] },
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
/** Whether the Battle button should skip the sortie board and open the last mode straight away. */
export const SORTIE_BOARD_STORAGE_KEY = 'naval-sortie-board-v1';
export function loadSkipSortieBoard(): boolean {
  try { return localStorage.getItem(SORTIE_BOARD_STORAGE_KEY) === 'skip'; } catch { return false; }
}
export function saveSkipSortieBoard(skip: boolean): void {
  try { if (skip) localStorage.setItem(SORTIE_BOARD_STORAGE_KEY, 'skip'); else localStorage.removeItem(SORTIE_BOARD_STORAGE_KEY); } catch { /* The preference is optional. */ }
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
