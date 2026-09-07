import { shipPreset } from '../../src/ships/presets';
import { CombatSimulation } from '../../src/simulation/combat';

// Each team contains battleships, a cruiser, carrier, submarine, destroyer,
// corvette and merchant hulls. Stable order and seed keep comparisons repeatable.
export const MIXED_SHIPS = ['bismarck', 'yamato', 'baltimore', 'enterprise-cv6', 'type-viic', 'fletcher', 'flower-corvette', 'liberty-cargo', 'liberty-collier', 'victory-cargo'];
export function mixedSetup(perTeam = 10) {
  if (!Number.isInteger(perTeam) || perTeam < 2 || perTeam > 30) throw new Error('Choose 2–30 ships per team.');
  const team = Array.from({ length: perTeam }, (_, i) => MIXED_SHIPS[i % MIXED_SHIPS.length]);
  return { playerShipId: team[0], friendlyBots: team.slice(1), enemies: [...team], spawnDistance: 5000 };
}
export function mixedSimulation(perTeam = 10) {
  const setup = mixedSetup(perTeam);
  return new CombatSimulation(shipPreset(setup.playerShipId), {
    friendlyBots: setup.friendlyBots.map(shipPreset), enemies: setup.enemies.map(shipPreset), spawnDistance: setup.spawnDistance, seed: 0x6e617661,
  });
}
export const reviewHelm = { throttle: .5, rudder: 0 };
export const reviewIntent = { aim: [0, .5, -5000] as [number, number, number], fire: false, battery: 'main' as const };
