import { describe, expect, test } from 'bun:test';
import type { PveRequest } from '../../multiplayer/generated/PveRequest';
import { emptyProfile, openProfile } from '../../progression/rules';
import type { ProgressSnapshot } from '../../progression/store';
import type { BattleSetup } from '../../game/session/battleSetup';
import { commandFallback, customOwnFleet, fleetRule, openCustomFleet, openDuelFleet, openPveFleet, ownFleetOpen, removalNotice } from './fleetAccess';
import { transferCustomShip, transferDuelShip, customUnitId } from './fleetTransfer';

const snapshot = (status: ProgressSnapshot['status'], profile = emptyProfile()): ProgressSnapshot => ({ status, profile, source: 'harness' });
const fresh = fleetRule(snapshot('ready'));
const setup = (): BattleSetup => ({ playerShipId: 'gleaves', friendlyBots: [{ shipId: 'fletcher', aiLevel: 'hard' }, 'cleveland', 'liberty-cargo'], enemies: ['yamato'], spawnDistance: 5000, mapId: 'north-atlantic' });

describe('who may sail in the player\'s fleet', () => {
  test('starters and designs are open, tree ships locked until researched, fictional and merchant ships enemy-only', () => {
    expect(fresh('gleaves')).toBe('open');
    expect(fresh('local-4f2a')).toBe('open');
    expect(fresh('fletcher')).toBe('locked');
    expect(fresh('valiant')).toBe('enemy-only');
    expect(fresh('liberty-cargo')).toBe('enemy-only');
    // Everything in the trees is open while research loads or cannot load; enemy-only ships never are.
    for (const status of ['loading', 'unavailable'] as const) {
      expect(fleetRule(snapshot(status))('fletcher')).toBe('open');
      expect(fleetRule(snapshot(status))('resolute')).toBe('enemy-only');
    }
    // The account-free harness owns every tree ship.
    expect(fleetRule(snapshot('ready', openProfile()))('yamato')).toBe('open');
    expect(fleetRule(snapshot('ready', openProfile()))('victory-cargo')).toBe('enemy-only');
  });

  test('the command berth and friendly lane refuse what the enemy lane accepts, by drag, click or keyboard alike', () => {
    expect(transferCustomShip(setup(), { kind: 'catalog', id: 'iowa' }, 'player', fresh).error).toBe('USS IOWA is locked. Unlock it in the tech tree to sail it in your fleet.');
    expect(transferCustomShip(setup(), { kind: 'catalog', id: 'valiant' }, 'friendly', fresh).error).toBe('VALIANT sails only with the enemy.');
    const enemy = transferCustomShip(setup(), { kind: 'catalog', id: 'iowa' }, 'enemy', fresh);
    expect(enemy.error).toBeUndefined();
    expect(enemy.setup.enemies).toHaveLength(2);
    // An enemy bot cannot defect to a berth it may not hold.
    expect(transferCustomShip(setup(), { kind: 'unit', id: customUnitId('enemy', 0) }, 'friendly', fresh).error).toContain('YAMATO is locked');
    expect(transferCustomShip(setup(), { kind: 'unit', id: customUnitId('enemy', 0) }, 'player', fresh).error).toContain('YAMATO is locked');
    // A friendly bot may still leave for the enemy lane.
    expect(transferCustomShip(setup(), { kind: 'unit', id: customUnitId('friendly', 1) }, 'enemy', fresh).error).toBeUndefined();
    expect(transferCustomShip(setup(), { kind: 'catalog', id: 'mogami' }, 'player', fresh).setup.playerShipId).toBe('mogami');
    // 1v1 berths are all the player's own.
    expect(transferDuelShip(['gleaves'], { kind: 'catalog', id: 'baltimore' }, 'fleet', fresh).error).toContain('BALTIMORE is locked');
    expect(transferDuelShip(['gleaves'], { kind: 'catalog', id: 'liberty-collier' }, 'command', fresh).error).toContain('sails only with the enemy');
    expect(transferDuelShip(['gleaves'], { kind: 'catalog', id: 'cleveland' }, 'fleet', fresh).fleet).toEqual(['gleaves', 'cleveland']);
  });

  test('a remembered roster loses the ships it may not bring, and the command berth takes an open ship', () => {
    const plotted: BattleSetup = { ...setup(), playerShipId: 'iowa',
      spawns: { friendly: [0, 1, 2, 3].map(x => ({ x, z: 0, heading: 0 })), enemy: [{ x: 0, z: -5000, heading: Math.PI }] } };
    const fixed = openCustomFleet(plotted, fresh, () => commandFallback(fresh, ['bismarck', 'local-none'], ['valiant', 'admiral-hipper']));
    expect(fixed.setup.playerShipId).toBe('admiral-hipper');
    expect(fixed.setup.friendlyBots).toEqual(['cleveland']);
    expect(fixed.setup.spawns!.friendly.map(pose => pose.x)).toEqual([0, 2]);
    expect(fixed.setup.enemies).toEqual(['yamato']);
    expect(fixed.removed).toEqual([{ id: 'iowa', access: 'locked' }, { id: 'fletcher', access: 'locked' }, { id: 'liberty-cargo', access: 'enemy-only' }]);
    expect(ownFleetOpen(customOwnFleet(fixed.setup), fresh)).toBe(true);
    expect(ownFleetOpen(customOwnFleet(plotted), fresh)).toBe(false);
    const clean = { ...setup(), friendlyBots: ['cleveland'] };
    expect(openCustomFleet(clean, fresh, () => undefined).setup).toBe(clean);
    // With nothing open to command, the berth keeps its ship and the launch guard holds the battle.
    const stuck = openCustomFleet({ ...clean, playerShipId: 'iowa' }, fresh, () => undefined);
    expect(stuck.setup.playerShipId).toBe('iowa');
    expect(ownFleetOpen(customOwnFleet(stuck.setup), fresh)).toBe(false);
  });

  test('fleet command groups and 1v1 berths drop what they may not bring', () => {
    const request: PveRequest = { version: 1, seed: 1, mapId: 'iron-bottom-sound', weather: 'clear', difficulty: 'normal', groups: [{ id: 'front', name: 'Group 1', station: 'front' }],
      ships: [{ id: 'u1', presetId: 'fubuki', groupId: 'front' }, { id: 'u2', presetId: 'yamato', groupId: 'front' }] };
    const pve = openPveFleet(request, fresh);
    expect(pve.request.ships.map(ship => ship.presetId)).toEqual(['fubuki']);
    expect(openPveFleet(pve.request, fresh).request).toBe(pve.request);
    expect(openDuelFleet(['iowa', 'gleaves'], fresh, () => 'mogami').fleet).toEqual(['gleaves']);
    expect(openDuelFleet(['iowa'], fresh, () => 'mogami').fleet).toEqual(['mogami']);
    const kept = ['gleaves'];
    expect(openDuelFleet(kept, fresh, () => 'mogami').fleet).toBe(kept);
  });

  test('the status line names what left and why', () => {
    const name = (id: string) => id.toUpperCase();
    expect(removalNotice([{ id: 'iowa', access: 'locked' }], name, 'gleaves')).toBe('IOWA is locked (unlock in the tech tree), so it left your fleet. You command GLEAVES.');
    expect(removalNotice([{ id: 'iowa', access: 'locked' }, { id: 'fletcher', access: 'locked' }, { id: 'baltimore', access: 'locked' }, { id: 'valiant', access: 'enemy-only' }], name))
      .toBe('IOWA, FLETCHER and BALTIMORE are locked (unlock in the tech tree); VALIANT sails only with the enemy, so they left your fleet.');
    expect(removalNotice([], name)).toBe('');
  });
});
