import { expect, test } from 'bun:test';
import type { BattleSetup } from '../../simulation/battle';
import type { PveRequest } from '../../multiplayer/generated/PveRequest';
import { carryToCustom, carryToDuel, carryToPve, fleetForCarry, isBattleMode } from './battleModes';

const setup: BattleSetup = { playerShipId: 'bismarck', friendlyBots: ['fletcher', { shipId: 'cleveland', aiLevel: 'easy' }], enemies: ['yamato'], spawnDistance: 5000 };
const request = (): PveRequest => ({ version: 1, seed: 1, mapId: 'pacific-islands', weather: 'clear', difficulty: 'normal', groups: [{ id: 'front', name: 'Group 1', station: 'front' }], ships: [] });
const budget = { maxShips: 3, maxAircraft: 100, maxDisplacementKg: 200000000 };

test('the commanded ship leads the fleet that carries between modes', () => {
  expect(fleetForCarry('custom', { setup, duel: [] })).toEqual(['bismarck', 'fletcher', 'cleveland']);
  expect(fleetForCarry('pve', { setup, request: { ...request(), ships: [{ id: 'u1', presetId: 'iowa', groupId: 'front' }] }, duel: [] })).toEqual(['iowa']);
  expect(fleetForCarry('pve', { setup, duel: ['x'] })).toEqual([]);
  expect(fleetForCarry('duel', { setup, duel: ['iowa', 'fletcher'] })).toEqual(['iowa', 'fletcher']);
  expect(isBattleMode('duel')).toBe(true); expect(isBattleMode('online')).toBe(false);
});

test('a fleet only carries into an untouched mode, trimmed to that mode\'s rules', () => {
  const empty: BattleSetup = { ...setup, friendlyBots: [], enemies: [] };
  const custom = carryToCustom(empty, ['iowa', 'fletcher']);
  expect(custom.playerShipId).toBe('iowa');
  expect(custom.friendlyBots).toEqual([{ shipId: 'fletcher', aiLevel: 'normal' }]);
  expect(carryToCustom(setup, ['iowa'])).toBe(setup);
  expect(carryToDuel(['bismarck'], 'bismarck', ['yamato', 'yamato', 'yamato', 'iowa'])).toEqual(['yamato', 'yamato', 'iowa']);
  expect(carryToDuel(['iowa', 'fletcher'], 'bismarck', ['yamato'])).toEqual(['iowa', 'fletcher']);
  expect(carryToDuel(['bismarck'], 'bismarck', [])).toEqual(['bismarck']);
  let n = 0;
  const pve = carryToPve(request(), ['bismarck', 'type-viic', 'fletcher', 'cleveland', 'iowa'], ['bismarck', 'fletcher', 'cleveland', 'iowa'], budget, () => `unit-${++n}`);
  expect(pve.ships.map(ship => ship.presetId)).toEqual(['bismarck', 'fletcher', 'cleveland']);
  expect(pve.ships.every(ship => ship.groupId === 'front')).toBe(true);
  const filled = { ...request(), ships: [{ id: 'u1', presetId: 'iowa', groupId: 'front' }] };
  expect(carryToPve(filled, ['bismarck'], ['bismarck'], budget, () => 'x')).toBe(filled);
});
