import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { BattleDialog } from './BattleDialog';
import { ShipCatalogCard, ShipChip } from './ShipCard';
import { DeployScreen } from './DeployScreen';
import { customDeployment, type Deployment } from './deploymentModel';
import type { BattleSetup } from '../../simulation/battle';

const setup: BattleSetup = { playerShipId: 'bismarck', friendlyBots: [{ shipId: 'fletcher', aiLevel: 'hard' }], enemies: ['mogami'], spawnDistance: 5000, mapId: 'north-atlantic', timeHours: 14.5, cloudCover: 40, windSpeed: 8 };
const render = (mode: 'custom' | 'pve' | 'duel') => renderToStaticMarkup(<BattleDialog initialMode={mode} initialShipId="bismarck" loading={false} onClose={() => {}} setup={setup} onSetupChange={() => {}} onLaunchCustom={() => {}} customError="" onLaunchPve={async () => {}} onOnlineBattle={async () => {}}/>);

test('ship cards name the class and the nation, and carriers show their aircraft', () => {
  const card = renderToStaticMarkup(<ul><ShipCatalogCard presetId="mogami"/></ul>);
  expect(card).toContain('IJN Mogami'); expect(card).toContain('Heavy cruiser'); expect(card).toContain('Japan'); expect(card).toContain('nation-flag'); expect(card).toContain('15,332 t');
  const carrier = renderToStaticMarkup(<ul><ShipChip presetId="enterprise-cv6"/></ul>);
  expect(carrier).toContain('Carrier'); expect(carrier).toContain('USA'); expect(carrier).toContain('ship-aircraft'); expect(carrier).toContain('>48<');
  const unavailable = renderToStaticMarkup(<ul><ShipCatalogCard presetId="yamato" unavailable="Over 200,000 t"/></ul>);
  expect(unavailable).toContain('is-unavailable'); expect(unavailable).toContain('Over 200,000 t'); expect(unavailable).toContain('disabled');
});

test('every mode renders inside one board with mode tabs, the shared catalog and a mode-specific lane set', () => {
  const custom = render('custom');
  expect(custom).toContain('role="tablist"'); expect(custom).toContain('Custom battle'); expect(custom).toContain('Fleet command'); expect(custom).toContain('1v1 online');
  expect(custom).toContain('battle-catalog'); expect(custom).toContain('You command'); expect(custom).toContain('Friendly team'); expect(custom).toContain('Enemy team');
  expect(custom).toContain('AI level for friendly bot 1'); expect(custom).toContain('Deploy fleet'); expect(custom).toContain('Spawn distance'); expect(custom).toContain('14:30');
  expect(custom).toContain('Germany'); expect(custom).toContain('Battleship');
  const duel = render('duel');
  expect(duel).toContain('Initial command ship'); expect(duel).toContain('Berth 2'); expect(duel).toContain('Berth 8'); expect(duel).toContain('Find opponent'); expect(duel).toContain('Create invite'); expect(duel).toContain('drawn when matched');
  expect(duel).toContain('43,978 / 200,000 t'); expect(duel).not.toContain('Enemy team');
  const pve = render('pve');
  expect(pve).toContain('Loading mission content'); expect(pve).toContain('Mission seed'); expect(pve).toContain('Difficulty'); expect(pve).not.toContain('Enemy team');
});

test('the deploy screen lists formations with a scope toggle, heading dial and the chart', () => {
  const html = renderToStaticMarkup(<DeployScreen deployment={customDeployment(setup)} onChange={() => {}} onReset={() => {}} disabled={false} fitKey="x"/>);
  expect(html).toContain('Group <kbd>G</kbd>'); expect(html).toContain('Ship <kbd>S</kbd>');
  expect(html).toContain('Friendly formation'); expect(html).toContain('Enemy formation'); expect(html).toContain('Bismarck · You');
  expect(html).toContain('deploy-dial'); expect(html).toContain('chart-frame'); expect(html).toContain('chart-tag'); expect(html).toContain('chart-ring'); expect(html).toContain('chart-handle');
  expect(html).toContain('FRIENDLY FORMATION · 2 SHIPS'); expect(html).toContain('Placement clear.'); expect(html).toContain('Reset positions');
});

test('the PvE deploy panel offers a cruising formation for the selected group; custom battles keep their spawn presets', () => {
  const deployment: Deployment = {
    units: [{ id: 'bb', presetId: 'bismarck', name: 'Bismarck', side: 'friendly', groupId: 'front', spawn: { x: 0, z: 12000, heading: 0 } },
      { id: 'dd', presetId: 'fletcher', name: 'Fletcher', side: 'friendly', groupId: 'front', spawn: { x: 900, z: 12000, heading: 0 } }],
    groups: [{ id: 'front', name: 'Group 1', side: 'friendly', formation: 'screen' }],
    islands: [], bounds: { kind: 'circle', radius: 25000 }, friendlyMinZ: 7000, focus: { x: 0, z: 0 }, labels: {}, error: '',
  };
  const pve = renderToStaticMarkup(<DeployScreen deployment={deployment} onChange={() => {}} onReset={() => {}} disabled={false} fitKey="x" onFormation={() => {}}/>);
  expect(pve).toContain('Cruising formation');
  expect(pve).toContain('Formation · Group 1');
  for (const label of ['Column', 'Double column', 'Triple column', 'Screen', 'Line abreast']) expect(pve).toContain(`>${label}</`);
  expect(pve).toContain('destroyers on an outer ring'); // The hint follows the group's own choice.
  expect(pve).toContain('GROUP 1 · 2 SHIPS · SCREEN');
  // Custom battles have no task groups, so the panel keeps only the line/column/wedge spawn preset.
  const custom = renderToStaticMarkup(<DeployScreen deployment={customDeployment(setup)} onChange={() => {}} onReset={() => {}} disabled={false} fitKey="x"/>);
  expect(custom).not.toContain('Cruising formation');
  expect(custom).toContain('FRIENDLY FORMATION · 2 SHIPS<');
});
