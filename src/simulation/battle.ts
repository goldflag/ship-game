/** The retired engine's hull and fleet types; the setup itself is the seam's
 * (`src/game/session/battleSetup.ts`). */
import type { OceanMapId } from '../maps/catalog';
import type { WeatherId } from '../maps/conditions';
import type { ShipDefinition } from '../ships/blueprint';
import type { Combatant } from './damage';
import type { BotState } from './bots';
import type { ShipAiLevel } from '../game/session/aiLevels';
import { botSelection, setupSpawns, type BattleSetup, type BotSelection, type SpawnPositions, type Team } from '../game/session/battleSetup';
export * from '../game/session/battleSetup';
export type { BattleResult } from '../game/session/BattleSession';
export type BattleBot = ShipDefinition | { definition: ShipDefinition; aiLevel: ShipAiLevel };
export interface BattleFleet { friendlyBots: BattleBot[]; enemies: BattleBot[]; spawnDistance?: number; seed?: number; mapId?: OceanMapId; weather?: WeatherId; windSpeed?: number; spawns?: SpawnPositions; }
export interface FleetActor extends Combatant {
  definition: ShipDefinition;
  presetId: string;
  team: Team;
  controller: 'player' | 'bot' | 'idle';
  /** Last applied helm command, for instrument readouts. */
  helm: import('../game/session/motion').HelmCommand;
  targetId?: string;
  tubeLaunchCooldown: number;
  depthChargeCooldown: number;
  bot?: BotState;
}

export function resolveBattleFleet(setup: BattleSetup, definitionFor: (id: string) => ShipDefinition): BattleFleet {
  const resolve = (selection: BotSelection): BattleBot => {
    const { shipId, aiLevel } = botSelection(selection);
    return { definition: definitionFor(shipId), aiLevel };
  };
  return { friendlyBots: setup.friendlyBots.map(resolve), enemies: setup.enemies.map(resolve), spawnDistance: setup.spawnDistance, mapId: setup.mapId, weather: setup.weather ?? 'map', windSpeed: setup.windSpeed, spawns: setupSpawns(setup) };
}

