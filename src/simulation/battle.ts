import type { ShipDefinition } from '../ships/blueprint';
import type { Combatant } from './damage';

export const BATTLE_SPAWN_DISTANCE = 5000;
export const MAX_TEAM_SHIPS = 5;
export type Team = 'friendly' | 'enemy';
export type BattleResult = 'active' | 'victory' | 'defeat' | 'draw';
export interface BattleSetup { playerShipId: string; friendlyBots: string[]; enemies: string[]; }
export interface BattleFleet { friendlyBots: ShipDefinition[]; enemies: ShipDefinition[]; }
export interface FleetActor extends Combatant {
  definition: ShipDefinition;
  team: Team;
  controller: 'player' | 'bot' | 'idle';
  targetId?: string;
}

export function validateBattleSetup(setup: BattleSetup, availableIds: readonly string[]): void {
  if (!setup || !Array.isArray(setup.friendlyBots) || !Array.isArray(setup.enemies)) throw new Error('Choose ships for both fleets.');
  if (setup.friendlyBots.length >= MAX_TEAM_SHIPS || setup.enemies.length > MAX_TEAM_SHIPS) throw new Error(`Each team can have up to ${MAX_TEAM_SHIPS} ships.`);
  if (!setup.enemies.length) throw new Error('Add at least one enemy ship.');
  if (![setup.playerShipId, ...setup.friendlyBots, ...setup.enemies].every(id => availableIds.includes(id))) throw new Error('A selected ship is unavailable. Choose a registered ship.');
}

/** Player leads the friendly line; corresponding fleet slots are exactly 5 km apart. */
export function deployment(index: number, team: Team) {
  const offset = index === 0 ? 0 : Math.ceil(index / 2) * (index % 2 ? 1 : -1);
  return { x: offset * 650, z: team === 'friendly' ? 0 : -BATTLE_SPAWN_DISTANCE,
    heading: team === 'friendly' ? Math.PI / 2 : Math.PI * 1.5 };
}
