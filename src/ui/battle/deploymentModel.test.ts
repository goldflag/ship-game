import { expect, test } from 'bun:test';
import type { BattleSetup } from '../../simulation/battle';
import type { PveBriefing } from '../../multiplayer/generated/PveBriefing';
import mission from '../../../assets/gameplay/pve-mission.v1.json';
import { applyCustomDeployment, applyPveDeployment, customDeployment, fitRadius, formatHeading, pveDeployment } from './deploymentModel';
import { moveFormation } from '../pveSetup';

const setup: BattleSetup = { playerShipId: 'bismarck', friendlyBots: ['fletcher'], enemies: ['yamato', { shipId: 'fubuki', aiLevel: 'easy' }], spawnDistance: 6000, mapId: 'north-atlantic' };

test('custom battles put both formations on the chart and round edits back into spawns', () => {
  const deployment = customDeployment(setup);
  expect(deployment.units.map(unit => unit.id)).toEqual(['friendly:0', 'friendly:1', 'enemy:0', 'enemy:1']);
  expect(deployment.units[0].name).toBe('Bismarck · You');
  expect(deployment.units[2].side).toBe('enemy');
  expect(deployment.groups.map(group => group.id)).toEqual(['friendly', 'enemy']);
  expect(deployment.error).toBe('');
  expect(deployment.bounds).toEqual({ kind: 'square', half: 40000 });
  const moved = moveFormation(deployment.units, ['enemy:0', 'enemy:1'], 1234.6, -4000, Math.PI / 2);
  const next = applyCustomDeployment(setup, moved);
  expect(next.spawns!.friendly).toEqual(deployment.units.slice(0, 2).map(unit => unit.spawn));
  expect(next.spawns!.enemy[0].x % 10).toBe(0);
  expect(next.spawns!.enemy[0].heading).toBeCloseTo(Math.PI * 1.5);
  expect(customDeployment({ ...setup, spawns: { friendly: [{ x: 0, z: 0, heading: 0 }, { x: 100, z: 0, heading: 0 }], enemy: next.spawns!.enemy } }).error).toContain('350 m');
  expect(fitRadius(deployment)).toBeGreaterThan(6000);
});

test('PvE deployment mirrors placements and reports sector violations', () => {
  const briefing = { generationVersion: 1, setup: { ships: [{ id: 'dd', presetId: 'fletcher', team: 'a', controller: 'bot', aiLevel: 'normal', spawn: { x: 0, z: 8000, heading: 0 } }, { id: 'cv', presetId: 'enterprise-cv6', team: 'a', controller: 'bot', aiLevel: 'normal', spawn: { x: 0, z: 16000, heading: 0 } }], mapId: 'pacific-islands', weather: 'clear', seed: 1, spawnDistance: 16000, windSpeed: null, missionRules: mission },
    groups: [{ id: 'front', name: 'Screen', station: 'front' }, { id: 'rear', name: 'Carriers', station: 'rear' }, { id: 'empty', name: 'Empty', station: 'rear' }], assignments: [{ id: 'dd', presetId: 'fletcher', groupId: 'front' }, { id: 'cv', presetId: 'enterprise-cv6', groupId: 'rear' }],
    totals: { displacementKg: 1, ships: 2, aircraft: 48 }, eligiblePresets: ['fletcher', 'enterprise-cv6'], deploymentMinZ: 7000 } as PveBriefing;
  const placements = briefing.setup.ships.map(ship => ({ id: ship.id, spawn: ship.spawn! }));
  const deployment = pveDeployment(briefing, placements);
  expect(deployment.groups.map(group => group.name)).toEqual(['Screen', 'Carriers']);
  expect(deployment.units.map(unit => unit.groupId)).toEqual(['front', 'rear']);
  expect(deployment.bounds).toEqual({ kind: 'circle', radius: mission.area.radiusM });
  expect(deployment.friendlyMinZ).toBe(7000);
  expect(deployment.error).toBe('');
  const outside = pveDeployment(briefing, [{ id: 'dd', spawn: { x: 0, z: 2000, heading: 0 } }, placements[1]]);
  expect(outside.error).toContain('friendly sector');
  expect(applyPveDeployment(deployment.units)).toEqual(placements);
  expect(formatHeading(Math.PI / 2)).toBe('090°');
  expect(formatHeading(-Math.PI / 4)).toBe('315°');
});
