import { expect, test } from 'bun:test';
import type { BattleSetup } from '../../simulation/battle';
import type { PveBriefing } from '../../multiplayer/generated/PveBriefing';
import mission from '../../../assets/gameplay/pve-mission.v1.json';
import { applyCustomDeployment, applyPveDeployment, arrangeFormation, customDeployment, fitRadius, formatHeading, initialPvePlacements, pveDeployment } from './deploymentModel';
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
  expect(arrangeFormation([units[3]], 'rear', 'screen')).toEqual([units[3]]); // A single ship is already in formation.

  // The chart reports the chosen formation, and an arrangement that breaks the rules still shows the usual error.
  expect(pveDeployment(briefing, [{ id: 'dd', spawn: { x: 0, z: 12000, heading: 0 } }], { front: 'screen' }).groups).toEqual([{ id: 'front', name: 'Screen', side: 'friendly', formation: 'screen' }]);
});

test('the first chart puts each group on its formation stations around the centre the worker chose', () => {
  // The worker packs a group two abreast whatever formation it will sail; the chart must not show that.
  const ship = (id: string, presetId: string, x: number, z: number) => ({ id, presetId, team: 'a', controller: 'bot', aiLevel: 'normal', spawn: { x, z, heading: 0 } });
  const briefing = { generationVersion: 1, setup: { ships: [ship('bb', 'bismarck', -400, 8000), ship('ca', 'baltimore', 400, 8000), ship('dd', 'fletcher', -400, 8700), ship('cv', 'enterprise-cv6', -400, 16500), ship('cl', 'atlanta', 400, 16500), ship('lone', 'fletcher', 0, 12000)],
    mapId: 'pacific-islands', weather: 'clear', seed: 1, spawnDistance: 16000, windSpeed: null, missionRules: mission },
    groups: [{ id: 'front', name: 'Screen', station: 'front' }, { id: 'rear', name: 'Carriers', station: 'rear', formation: 'line-abreast' }, { id: 'solo', name: 'Picket', station: 'front' }],
    assignments: [{ id: 'bb', presetId: 'bismarck', groupId: 'front' }, { id: 'ca', presetId: 'baltimore', groupId: 'front' }, { id: 'dd', presetId: 'fletcher', groupId: 'front' }, { id: 'cv', presetId: 'enterprise-cv6', groupId: 'rear' }, { id: 'cl', presetId: 'atlanta', groupId: 'rear' }, { id: 'lone', presetId: 'fletcher', groupId: 'solo' }],
    totals: { displacementKg: 1, ships: 6, aircraft: 48 }, eligiblePresets: [], deploymentMinZ: 7000 } as unknown as PveBriefing;
  const placements = initialPvePlacements(briefing);
  const at = (id: string) => placements.find(p => p.id === id)!.spawn;
  // Column: one file astern of the guide, heavies first, at the guide's interval, centred where the pair block was.
  const d = roleInterval('battleship');
  expect(at('ca').x).toBeCloseTo(at('bb').x); expect(at('dd').x).toBeCloseTo(at('bb').x);
  expect(at('ca').z - at('bb').z).toBeCloseTo(d); expect(at('dd').z - at('ca').z).toBeCloseTo(d);
  expect((at('bb').z + at('ca').z + at('dd').z) / 3).toBeCloseTo((8000 + 8000 + 8700) / 3);
  expect((at('bb').x + at('ca').x + at('dd').x) / 3).toBeCloseTo(-400 / 3);
  expect(at('bb').heading).toBe(0);
  // The briefing's own formation is honoured, and a single ship stays put.
  expect(at('cl').z).toBeCloseTo(at('cv').z); expect(Math.abs(at('cl').x - at('cv').x)).toBeCloseTo(roleInterval('carrier'));
  expect(at('lone')).toEqual({ x: 0, z: 12000, heading: 0 });
  expect(pveDeployment(briefing, placements).error).toBe('');
  // The player's later pick wins over the briefing, and a group whose stations would leave the
  // battle area keeps the worker's layout instead of starting with a placement error.
  const rearColumn = initialPvePlacements(briefing, { rear: 'column' });
  expect(rearColumn.find(p => p.id === 'cl')!.spawn.x).toBeCloseTo(0); expect(rearColumn.find(p => p.id === 'cl')!.spawn.z - rearColumn.find(p => p.id === 'cv')!.spawn.z).toBeCloseTo(roleInterval('carrier'));
  const edge = { ...briefing, setup: { ...briefing.setup, ships: [ship('bb', 'bismarck', -400, 24500), ship('ca', 'baltimore', 400, 24500)] }, assignments: briefing.assignments.slice(0, 2) } as PveBriefing;
  expect(initialPvePlacements(edge).map(p => p.spawn)).toEqual([{ x: -400, z: 24500, heading: 0 }, { x: 400, z: 24500, heading: 0 }]);
  // A column whose recentred head would leave the friendly sector slides astern instead of giving up.
  const south = 7000; // The worker's pair block sits on the sector edge; the recentred column's head would cross it.
  const coast = { ...briefing, setup: { ...briefing.setup, ships: [ship('bb', 'bismarck', -400, south), ship('ca', 'baltimore', 400, south), ship('dd', 'fletcher', -400, south + 700), ship('cl', 'cleveland', 400, south + 700)] },
    assignments: [{ id: 'bb', presetId: 'bismarck', groupId: 'front' }, { id: 'ca', presetId: 'baltimore', groupId: 'front' }, { id: 'dd', presetId: 'fletcher', groupId: 'front' }, { id: 'cl', presetId: 'cleveland', groupId: 'front' }] } as PveBriefing;
  expect(pveDeployment(coast, coast.setup.ships.map(s => ({ id: s.id, spawn: s.spawn! }))).error).toBe('');
  const slid = initialPvePlacements(coast);
  expect(pveDeployment(coast, slid).error).toBe('');
  expect(new Set(slid.map(p => Math.round(p.spawn.x))).size).toBe(1); // One file.
  expect(Math.min(...slid.map(p => p.spawn.z))).toBeGreaterThanOrEqual(south); // Slid astern until the head is back in the sector.
  expect(Math.min(...slid.map(p => p.spawn.z))).toBeLessThan(south + 1000);
});
