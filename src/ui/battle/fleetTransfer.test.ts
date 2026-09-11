import { expect, test } from 'bun:test';
import type { BattleSetup } from '../../simulation/battle';
import { customTeamFull, customUnitId, parseCustomUnit, removeCustomBot, transferCustomShip, transferDuelShip } from './fleetTransfer';

const setup = (): BattleSetup => ({ playerShipId: 'bismarck', friendlyBots: [{ shipId: 'fletcher', aiLevel: 'hard' }], enemies: ['yamato'], spawnDistance: 5000, mapId: 'north-atlantic' });

test('catalog drops add bots at Normal, take command, and respect the team limit', () => {
  const friendly = transferCustomShip(setup(), { kind: 'catalog', id: 'cleveland' }, 'friendly');
  expect(friendly.error).toBeUndefined();
  expect(friendly.setup.friendlyBots).toEqual([{ shipId: 'fletcher', aiLevel: 'hard' }, { shipId: 'cleveland', aiLevel: 'normal' }]);
  const command = transferCustomShip(setup(), { kind: 'catalog', id: 'iowa' }, 'player');
  expect(command.setup.playerShipId).toBe('iowa');
  expect(command.setup.friendlyBots).toHaveLength(1);
  const full: BattleSetup = { ...setup(), enemies: Array.from({ length: 30 }, () => 'fubuki') };
  expect(customTeamFull(full, 'enemy')).toBe(true);
  expect(transferCustomShip(full, { kind: 'catalog', id: 'fubuki' }, 'enemy').error).toContain('full');
  expect(transferCustomShip(setup(), { kind: 'catalog', id: 'nope' }, 'enemy').error).toContain('unavailable');
});

test('moving a bot between lanes keeps its AI level, and the commanded ship never drags into a lane', () => {
  const moved = transferCustomShip(setup(), { kind: 'unit', id: customUnitId('friendly', 1) }, 'enemy');
  expect(moved.error).toBeUndefined();
  expect(moved.setup.friendlyBots).toEqual([]);
  expect(moved.setup.enemies).toEqual(['yamato', { shipId: 'fletcher', aiLevel: 'hard' }]);
  const promoted = transferCustomShip(setup(), { kind: 'unit', id: customUnitId('enemy', 0) }, 'player');
  expect(promoted.setup.playerShipId).toBe('yamato');
  expect(promoted.setup.enemies).toEqual([]);
  expect(transferCustomShip(setup(), { kind: 'unit', id: customUnitId('friendly', 0) }, 'enemy').error).toContain('command');
  expect(transferCustomShip(setup(), { kind: 'unit', id: 'enemy:7' }, 'friendly').error).toContain('no longer');
  expect(transferCustomShip(setup(), { kind: 'unit', id: customUnitId('enemy', 0) }, 'enemy').setup).toEqual(setup());
  expect(parseCustomUnit('friendly:3')).toEqual({ team: 'friendly', slot: 3 });
  expect(parseCustomUnit('unit-3')).toBeUndefined();
});

test('roster edits keep plotted positions for the remaining ships', () => {
  const plotted: BattleSetup = { ...setup(), spawns: { friendly: [{ x: 0, z: 0, heading: 0 }, { x: 800, z: 100, heading: .2 }], enemy: [{ x: 0, z: -5000, heading: Math.PI }] } };
  const added = transferCustomShip(plotted, { kind: 'catalog', id: 'cleveland' }, 'enemy').setup;
  expect(added.spawns!.friendly).toEqual(plotted.spawns!.friendly);
  expect(added.spawns!.enemy).toHaveLength(2);
  expect(added.spawns!.enemy[1]).toEqual({ x: 650, z: -5000, heading: Math.PI });
  const removed = removeCustomBot(added, 'friendly', 0);
  expect(removed.friendlyBots).toEqual([]);
  expect(removed.spawns!.friendly).toEqual([{ x: 0, z: 0, heading: 0 }]);
  expect(removed.spawns!.enemy).toHaveLength(2);
});

test('1v1 berths enforce the fleet rules and the first berth is the command ship', () => {
  const fleet = ['iowa', 'fletcher'];
  expect(transferDuelShip(fleet, { kind: 'catalog', id: 'cleveland' }, 'fleet').fleet).toEqual(['iowa', 'fletcher', 'cleveland']);
  expect(transferDuelShip(fleet, { kind: 'catalog', id: 'cleveland' }, 'command').fleet).toEqual(['cleveland', 'iowa', 'fletcher']);
  expect(transferDuelShip(fleet, { kind: 'unit', id: 'fleet:1' }, 'command').fleet).toEqual(['fletcher', 'iowa']);
  expect(transferDuelShip(fleet, { kind: 'unit', id: 'fleet:1' }, 'fleet').fleet).toBe(fleet);
  expect(transferDuelShip(['yamato', 'yamato', 'iowa'], { kind: 'catalog', id: 'iowa' }, 'fleet').error).toContain('200,000');
  expect(transferDuelShip(['enterprise-cv6', 'shokaku'], { kind: 'catalog', id: 'shokaku' }, 'fleet').error).toContain('carriers');
  expect(transferDuelShip(fleet, { kind: 'unit', id: 'fleet:9' }, 'command').error).toContain('no longer');
});
