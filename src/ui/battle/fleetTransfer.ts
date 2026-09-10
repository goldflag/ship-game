import { mapIslands } from '../../maps/catalog';
import { shipPreset, shipPresets } from '../../ships/presets';
import { botSelection, MAX_TEAM_SHIPS, setupSpawns, validateSpawns, type BattleSetup, type BotSelection, type Team } from '../../simulation/battle';
import { fleetBudget } from '../../simulation/battleRules';
import type { FleetTransfer } from '../pveFleetEditing';
import { customIslands } from './deploymentModel';

export type { FleetTransfer };
export type CustomTarget = Team | 'player';
const teamKey = (team: Team) => team === 'friendly' ? 'friendlyBots' : 'enemies';
/** Roster ids on the chart and in the lanes share one form: `friendly:2` is the second friendly bot (slot 0 is the player). */
export const customUnitId = (team: Team, slot: number) => `${team}:${slot}`;
export function parseCustomUnit(id: string): { team: Team; slot: number } | undefined {
  const match = id.match(/^(friendly|enemy):(\d+)$/);
  return match ? { team: match[1] as Team, slot: Number(match[2]) } : undefined;
}
export const customTeamFull = (setup: BattleSetup, team: Team) => setup[teamKey(team)].length >= MAX_TEAM_SHIPS - (team === 'friendly' ? 1 : 0);

/** Custom positions survive roster edits: a new bot takes the next open berth behind its formation. */
function addCustomBot(setup: BattleSetup, team: Team, selection: BotSelection): BattleSetup {
  const key = teamKey(team), next = { ...setup, [key]: [...setup[key], selection] };
  if (!setup.spawns) return next;
  const poses = { friendly: [...setup.spawns.friendly], enemy: [...setup.spawns.enemy] };
  const base = setupSpawns({ ...next, spawns: undefined })[team].at(-1)!;
  const land = mapIslands(setup.mapId ?? 'north-atlantic', setup.spawnDistance, Math.max(next.friendlyBots.length + 1, next.enemies.length));
  for (let i = 0; i < 60; i++) {
    poses[team] = [...setup.spawns[team], { ...base, z: base.z + i * 650 * (team === 'friendly' ? 1 : -1) }];
    try { validateSpawns(poses, next.friendlyBots.length + 1, next.enemies.length, land); break; } catch { /* Try the next open berth. */ }
  }
  return { ...next, spawns: poses };
}
export function removeCustomBot(setup: BattleSetup, team: Team, index: number): BattleSetup {
  const key = teamKey(team), slot = index + (team === 'friendly' ? 1 : 0);
  return { ...setup, [key]: setup[key].filter((_, i) => i !== index),
    spawns: setup.spawns ? { ...setup.spawns, [team]: setup.spawns[team].filter((_, i) => i !== slot) } : undefined };
}
/** Catalog drops add a bot or take command; moving a bot keeps its AI level. The commanded ship never becomes a bot by dragging. */
export function transferCustomShip(setup: BattleSetup, transfer: FleetTransfer, target: CustomTarget): { setup: BattleSetup; error?: string } {
  if (transfer.kind === 'catalog') {
    if (!(transfer.id in shipPresets)) return { setup, error: 'That ship is unavailable.' };
    if (target === 'player') return { setup: setup.playerShipId === transfer.id ? setup : { ...setup, playerShipId: transfer.id } };
    if (customTeamFull(setup, target)) return { setup, error: `The ${target} team is full (${MAX_TEAM_SHIPS} ships).` };
    return { setup: addCustomBot(setup, target, { shipId: transfer.id, aiLevel: 'normal' }) };
  }
  const unit = parseCustomUnit(transfer.id);
  if (!unit) return { setup, error: 'That ship is no longer in a lane.' };
  if (unit.team === 'friendly' && unit.slot === 0) return { setup, error: 'Choose another ship from the catalog to hand over command.' };
  const index = unit.slot - (unit.team === 'friendly' ? 1 : 0), selection = setup[teamKey(unit.team)][index];
  if (selection === undefined) return { setup, error: 'That ship is no longer in a lane.' };
  const bot = botSelection(selection), removed = removeCustomBot(setup, unit.team, index);
  if (target === 'player') return { setup: { ...removed, playerShipId: bot.shipId } };
  if (target === unit.team) return { setup };
  if (customTeamFull(setup, target)) return { setup, error: `The ${target} team is full (${MAX_TEAM_SHIPS} ships).` };
  return { setup: addCustomBot(removed, target, bot) };
}
export const customPlacementError = (setup: BattleSetup): string => {
  try { validateSpawns(setupSpawns(setup), setup.friendlyBots.length + 1, setup.enemies.length, customIslands(setup)); return ''; }
  catch (error) { return (error as Error).message; }
};

const definitions = new Map(Object.keys(shipPresets).map(id => [id, shipPreset(id)]));
export const duelUnitId = (index: number) => `fleet:${index}`;
export const parseDuelUnit = (id: string) => { const match = id.match(/^fleet:(\d+)$/); return match ? Number(match[1]) : undefined; };
export const duelBudget = (fleet: readonly string[]) => fleetBudget(fleet, definitions);
/** The first berth is the initial command ship; dropping onto it moves that ship to the front. */
export function transferDuelShip(fleet: string[], transfer: FleetTransfer, target: 'fleet' | 'command'): { fleet: string[]; error?: string } {
  if (transfer.kind === 'catalog') {
    if (!definitions.has(transfer.id)) return { fleet, error: 'That ship is unavailable.' };
    const next = target === 'command' ? [transfer.id, ...fleet] : [...fleet, transfer.id];
    const error = duelBudget(next).error;
    return error ? { fleet, error } : { fleet: next };
  }
  const index = parseDuelUnit(transfer.id);
  if (index === undefined || fleet[index] === undefined) return { fleet, error: 'That ship is no longer in the fleet.' };
  if (target === 'fleet' || index === 0) return { fleet };
  return { fleet: [fleet[index], ...fleet.filter((_, i) => i !== index)] };
}
