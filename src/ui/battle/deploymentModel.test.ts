import { expect, test } from 'bun:test';
import type { BattleSetup } from '../../simulation/battle';
import type { PveBriefing } from '../../multiplayer/generated/PveBriefing';
import mission from '../../../assets/gameplay/pve-mission.v1.json';
import { applyCustomDeployment, applyPveDeployment, arrangeFormation, customDeployment, fitRadius, formatHeading, pveDeployment } from './deploymentModel';
import { roleInterval, SCREEN_OUTER_RADIUS_M } from '../formationStations';
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

test('a formation preset stations a group around its guide and leaves every other group alone', () => {
  const briefing = { generationVersion: 1, setup: { ships: [], mapId: 'pacific-islands', weather: 'clear', seed: 1, spawnDistance: 16000, windSpeed: null, missionRules: mission },
    groups: [{ id: 'front', name: 'Screen', station: 'front' }], assignments: [{ id: 'dd', presetId: 'fletcher', groupId: 'front' }], totals: { displacementKg: 1, ships: 1, aircraft: 0 }, eligiblePresets: ['fletcher'], deploymentMinZ: 7000 } as unknown as PveBriefing;
  const unit = (id: string, presetId: string, groupId: string, x: number, z: number, heading = 0) =>
    ({ id, presetId, name: id, side: 'friendly' as const, groupId, spawn: { x, z, heading } });
  const units = [unit('bb', 'bismarck', 'front', 1000, 12000, Math.PI / 2), unit('dd', 'fletcher', 'front', -4000, 19000), unit('ca', 'baltimore', 'front', 6000, 3000), unit('cv', 'enterprise-cv6', 'rear', 0, 16000)];

  const column = arrangeFormation(units, 'front', 'column');
  const d = roleInterval('battleship');
  expect(column[0].spawn).toEqual(units[0].spawn); // The guide keeps the place and the course the player gave it.
  expect(column[3]).toBe(units[3]); // Another group is never touched.
  // Heading 090 puts astern to the west: the cruiser takes the first station, the destroyer the second.
  expect(column[2].spawn.x).toBeCloseTo(1000 - d); expect(column[2].spawn.z).toBeCloseTo(12000);
  expect(column[1].spawn.x).toBeCloseTo(1000 - d * 2); expect(column[1].spawn.heading).toBeCloseTo(Math.PI / 2);

  const screen = arrangeFormation(units, 'front', 'screen');
  const dd = screen.find(ship => ship.id === 'dd')!; // Destroyers ride the outer ring, dead ahead of the guide.
  expect(Math.hypot(dd.spawn.x - 1000, dd.spawn.z - 12000)).toBeCloseTo(SCREEN_OUTER_RADIUS_M);
  expect(dd.spawn.x).toBeCloseTo(1000 + SCREEN_OUTER_RADIUS_M);

  const abreast = arrangeFormation(units, 'front', 'line-abreast');
  expect(abreast.find(ship => ship.id === 'ca')!.spawn.z).toBeCloseTo(12000 + d);

  // Heading 090 turns the columns' [starboard, aft] offsets a quarter turn: starboard is
  // south (+z), astern is west (−x). The cruiser leads the second column abeam of the guide.
  const doubled = arrangeFormation(units, 'front', 'double-column');
  const doubledCa = doubled.find(ship => ship.id === 'ca')!, doubledDd = doubled.find(ship => ship.id === 'dd')!;
  expect(doubledCa.spawn.x).toBeCloseTo(1000); expect(doubledCa.spawn.z).toBeCloseTo(12000 + d);
  expect(doubledDd.spawn.x).toBeCloseTo(1000 - d); expect(doubledDd.spawn.z).toBeCloseTo(12000);
  const tripled = arrangeFormation(units, 'front', 'triple-column');
  expect(tripled.find(ship => ship.id === 'ca')!.spawn.z).toBeCloseTo(12000 - d); // Port wing, abeam.
  expect(tripled.find(ship => ship.id === 'dd')!.spawn.z).toBeCloseTo(12000 + d); // Starboard wing, abeam.
  expect(arrangeFormation([units[3]], 'rear', 'screen')).toEqual([units[3]]); // A single ship is already in formation.

  // The chart reports the chosen formation, and an arrangement that breaks the rules still shows the usual error.
  expect(pveDeployment(briefing, [{ id: 'dd', spawn: { x: 0, z: 12000, heading: 0 } }], { front: 'screen' }).groups).toEqual([{ id: 'front', name: 'Screen', side: 'friendly', formation: 'screen' }]);
});
