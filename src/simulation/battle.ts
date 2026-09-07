import { isOceanMapId, type OceanMapId } from '../maps/catalog';
import { isTimeOfDayId, isWeatherId, type TimeOfDayId, type WeatherId } from '../maps/conditions';
import type { ShipDefinition } from '../ships/blueprint';
import type { Combatant } from './damage';
import type { TubeState } from './torpedoes';
import type { BotState } from './bots';
import { DEFAULT_AI_LEVEL, isShipAiLevel, type ShipAiLevel } from './aiLevels';

export const BATTLE_SPAWN_DISTANCE = 5000;
export const MIN_BATTLE_SPAWN_DISTANCE = 1000;
export const MAX_BATTLE_SPAWN_DISTANCE = 20000;
export const MAX_TEAM_SHIPS = 30;
export type Team = 'friendly' | 'enemy';
export type BattleResult = 'active' | 'victory' | 'defeat' | 'draw';
/** Plain IDs/definitions remain supported for existing scenarios; they use Normal AI. */
export type BotSelection = string | { shipId: string; aiLevel: ShipAiLevel };
export type BattleBot = ShipDefinition | { definition: ShipDefinition; aiLevel: ShipAiLevel };
export const botSelection = (selection: BotSelection): { shipId: string; aiLevel: ShipAiLevel } =>
  typeof selection === 'string' ? { shipId: selection, aiLevel: DEFAULT_AI_LEVEL } : selection;
export interface BattleSetup {
  playerShipId: string; friendlyBots: BotSelection[]; enemies: BotSelection[]; spawnDistance: number;
  mapId?: OceanMapId; timeOfDay?: TimeOfDayId; weather?: WeatherId;
}
export interface BattleFleet { friendlyBots: BattleBot[]; enemies: BattleBot[]; spawnDistance?: number; seed?: number; mapId?: OceanMapId; }
export interface FleetActor extends Combatant {
  definition: ShipDefinition;
  team: Team;
  controller: 'player' | 'bot' | 'idle';
  targetId?: string;
  torpedoTubes?: TubeState[];
  tubeLaunchCooldown?: number;
  depthChargeLaunchers?: import('./depthCharges').DepthChargeLauncherState[];
  depthChargeCooldown?: number;
  bot?: BotState;
}

export function validateBattleSetup(setup: BattleSetup, availableIds: readonly string[]): void {
  if (!setup || !Array.isArray(setup.friendlyBots) || !Array.isArray(setup.enemies)) throw new Error('Choose ships for both fleets.');
  if (setup.friendlyBots.length >= MAX_TEAM_SHIPS || setup.enemies.length > MAX_TEAM_SHIPS) throw new Error(`Each team can have up to ${MAX_TEAM_SHIPS} ships.`);
  if (!setup.enemies.length) throw new Error('Add at least one enemy ship.');
  const bots = [...setup.friendlyBots, ...setup.enemies].map(botSelection);
  if (![setup.playerShipId, ...bots.map(bot => bot?.shipId)].every(id => availableIds.includes(id))) throw new Error('A selected ship is unavailable. Choose a registered ship.');
  if (!bots.every(bot => isShipAiLevel(bot.aiLevel))) throw new Error('Choose an available AI level for each ship.');
  if (setup.mapId !== undefined && !isOceanMapId(setup.mapId)) throw new Error('Choose an available ocean map.');
  if (setup.timeOfDay !== undefined && !isTimeOfDayId(setup.timeOfDay)) throw new Error('Choose an available time of day.');
  if (setup.weather !== undefined && !isWeatherId(setup.weather)) throw new Error('Choose an available weather preset.');
  validateSpawnDistance(setup.spawnDistance);
}

export function resolveBattleFleet(setup: BattleSetup, definitionFor: (id: string) => ShipDefinition): BattleFleet {
  const resolve = (selection: BotSelection): BattleBot => {
    const { shipId, aiLevel } = botSelection(selection);
    return { definition: definitionFor(shipId), aiLevel };
  };
  return { friendlyBots: setup.friendlyBots.map(resolve), enemies: setup.enemies.map(resolve), spawnDistance: setup.spawnDistance, mapId: setup.mapId };
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
