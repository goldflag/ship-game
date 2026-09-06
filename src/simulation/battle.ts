import { isOceanMapId, type OceanMapId } from '../maps/catalog';
import type { ShipDefinition } from '../ships/blueprint';
import type { Combatant } from './damage';
import type { TubeState } from './torpedoes';
import type { BotState } from './bots';

export const BATTLE_SPAWN_DISTANCE = 5000;
export const MIN_BATTLE_SPAWN_DISTANCE = 1000;
export const MAX_BATTLE_SPAWN_DISTANCE = 20000;
export const MAX_TEAM_SHIPS = 30;
export type Team = 'friendly' | 'enemy';
export type BattleResult = 'active' | 'victory' | 'defeat' | 'draw';
export interface BattleSetup { playerShipId: string; friendlyBots: string[]; enemies: string[]; spawnDistance: number; mapId?: OceanMapId; sea?: 'Fair' | 'Atlantic' | 'Heavy'; }
export interface BattleFleet { friendlyBots: ShipDefinition[]; enemies: ShipDefinition[]; spawnDistance?: number; seed?: number; mapId?: OceanMapId; }
export interface FleetActor extends Combatant {
  definition: ShipDefinition;
  team: Team;
  controller: 'player' | 'bot' | 'idle';
  targetId?: string;
  torpedoTubes?: TubeState[];
  tubeLaunchCooldown?: number;
  bot?: BotState;
}

export function validateBattleSetup(setup: BattleSetup, availableIds: readonly string[]): void {
  if (!setup || !Array.isArray(setup.friendlyBots) || !Array.isArray(setup.enemies)) throw new Error('Choose ships for both fleets.');
  if (setup.friendlyBots.length >= MAX_TEAM_SHIPS || setup.enemies.length > MAX_TEAM_SHIPS) throw new Error(`Each team can have up to ${MAX_TEAM_SHIPS} ships.`);
  if (!setup.enemies.length) throw new Error('Add at least one enemy ship.');
  if (![setup.playerShipId, ...setup.friendlyBots, ...setup.enemies].every(id => availableIds.includes(id))) throw new Error('A selected ship is unavailable. Choose a registered ship.');
  if (setup.mapId !== undefined && !isOceanMapId(setup.mapId)) throw new Error('Choose an available ocean map.');
  if (setup.sea !== undefined && !['Fair', 'Atlantic', 'Heavy'].includes(setup.sea)) throw new Error('Choose available sea conditions.');
  validateSpawnDistance(setup.spawnDistance);
}

export function validateSpawnDistance(distance: number): void {
  if (!Number.isFinite(distance) || distance < MIN_BATTLE_SPAWN_DISTANCE || distance > MAX_BATTLE_SPAWN_DISTANCE) {
    throw new Error(`Choose a spawn distance between ${MIN_BATTLE_SPAWN_DISTANCE / 1000} and ${MAX_BATTLE_SPAWN_DISTANCE / 1000} km.`);
  }
}

/** Corresponding fleet slots share a lane, with bows facing the opposing line. */
export function deployment(index: number, team: Team, distance = BATTLE_SPAWN_DISTANCE) {
  const offset = index === 0 ? 0 : Math.ceil(index / 2) * (index % 2 ? 1 : -1);
  return { x: offset * 650, z: team === 'friendly' ? 0 : -distance,
    heading: team === 'friendly' ? 0 : Math.PI };
}
