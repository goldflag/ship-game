import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { BattleLoadingScreen } from './BattleLoadingScreen';
import type { PveBriefing } from '../multiplayer/generated/PveBriefing';
import mission from '../../assets/gameplay/pve-mission.v1.json';

test('PvE loading uses only its friendly briefing and never displays the previous Custom opponent', () => {
  const briefing = { generationVersion: 1, setup: { ships: [{ id: 'dd', presetId: 'fletcher', team: 'a', controller: 'bot', aiLevel: 'normal', spawn: { x: 0, z: 8000, heading: 0 } }], mapId: 'pacific-islands', weather: 'clear', seed: 1, spawnDistance: 16000, windSpeed: null, missionRules: mission }, groups: [], assignments: [], totals: { displacementKg: 2924000, ships: 1, aircraft: 0 }, eligiblePresets: ['fletcher'], deploymentMinZ: 7000 } as PveBriefing;
  const html = renderToStaticMarkup(<BattleLoadingScreen briefing={briefing} setup={{ playerShipId: 'enterprise-cv6', friendlyBots: [], enemies: ['yamato'], mapId: 'north-atlantic', spawnDistance: 5000 }} state={{ label: 'Preparing ship recognition models', progress: .5, leaving: false }} onLeft={() => {}}/>);
  expect(html).toContain('PvE fleet command'); expect(html).toContain('Unknown'); expect(html).toContain('Fletcher');
  expect(html).not.toContain('Yamato'); expect(html).not.toContain('Enterprise'); expect(html).not.toContain('Custom battle');
  expect(html).not.toContain('>You<'); expect(html).toContain('25 km radius');
});
