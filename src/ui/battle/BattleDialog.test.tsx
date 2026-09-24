import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { BattleDialog } from './BattleDialog';
import { ShipCatalogCard, ShipChip } from './ShipCard';
import { DeployScreen } from './DeployScreen';
import { customDeployment, customTerrain, type Deployment } from './deploymentModel';
import type { BattleSetup } from '../../game/session/battleSetup';
import { OPEN_SEA } from '../../maps/heightfield';
import { OCEAN_MAPS, placedMapTerrain, type OceanMapId } from '../../maps/catalog';
import { installMapTerrain } from '../../maps/testing';
import { emptyProfile } from '../../progression/rules';
import type { ProgressStore } from '../../progression/store';
import { ProgressProvider } from '../useProgress';
import { ShipCatalog } from './ShipCatalog';
import { CustomLanes } from './CustomMode';
import { fleetRule } from './fleetAccess';

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

test('the waters are the open Atlantic and four battle sites, each tile naming its action and date', () => {
  const custom = render('custom');
  for (const name of ['North Atlantic', 'Iron Bottom Sound', 'Vestfjord', 'Sunda Strait', 'Strait of Dover']) expect(custom).toContain(`<span>${name}</span>`);
  expect(custom).toContain('<small>Atlantic Ocean</small>');
  expect(custom).toContain('<small>Savo Island, 9 August 1942</small>');
  expect(custom).toContain('<small>Action off Lofoten, 9 April 1940</small>');
  expect(custom).toContain('<small>Battle of Sunda Strait, 28 February – 1 March 1942</small>');
  expect(custom).toContain('<small>Channel Dash, 12 February 1942</small>');
  // The whole record, every action in these waters, is in the tile's title.
  expect(custom).toContain('title="Savo Island, 9 August 1942 · Naval Battle of Guadalcanal, 13–15 November 1942. ');
});

test('Start battle waits while the coast is charted, then opens on a placement clear of it', async () => {
  const deploy = (mapId: OceanMapId) => renderToStaticMarkup(<BattleDialog initialMode="custom" initialStep="deploy" initialShipId="bismarck" loading={false} onClose={() => {}} setup={{ ...setup, mapId }} onSetupChange={() => {}} onLaunchCustom={() => {}} customError="" onLaunchPve={async () => {}} onOnlineBattle={async () => {}}/>);
  const start = (html: string) => html.match(/<button[^>]*>Start battle/)![0];
  // The chart reads what the page has loaded, which one test process shares across files: find waters not yet charted.
  const uncharted = OCEAN_MAPS.find((map) => map.land.terrain && !placedMapTerrain(map.id, [0, 0]));
  if (uncharted) {
    const pending = deploy(uncharted.id);
    expect(pending).toContain('Charting the coast…');
    expect(pending).toContain(`${String(uncharted.bearing).padStart(3, '0')}° up`);
    expect(start(pending)).toContain('disabled=""');
  }
  // The deploy screen itself says so for any uncharted placement.
  const waiting = renderToStaticMarkup(<DeployScreen deployment={customDeployment({ ...setup, mapId: 'strait-of-dover' }, undefined)} onChange={() => {}} onReset={() => {}} disabled={false} fitKey="x"/>);
  expect(waiting).toContain('Charting the coast…');
  expect(waiting).toContain('045° up');
  expect(waiting).not.toContain('chart-coast');
  await installMapTerrain('strait-of-dover');
  const charted = deploy('strait-of-dover');
  expect(charted).toContain('Placement clear.');
  expect(charted).toContain('class="chart-land"');
  expect(start(charted)).not.toContain('disabled=""');
  const sound: BattleSetup = { ...setup, mapId: 'strait-of-dover' };
  expect(customDeployment(sound, customTerrain(sound)).terrain?.offset).toEqual([0, -2500]);
});

test('the deploy screen lists formations with a scope toggle, heading dial and the chart', () => {
  const html = renderToStaticMarkup(<DeployScreen deployment={customDeployment(setup, OPEN_SEA)} onChange={() => {}} onReset={() => {}} disabled={false} fitKey="x"/>);
  expect(html).toContain('Group <kbd>G</kbd>'); expect(html).toContain('Ship <kbd>S</kbd>');
  expect(html).toContain('Friendly formation'); expect(html).toContain('Enemy formation'); expect(html).toContain('Bismarck · You');
  expect(html).toContain('deploy-dial'); expect(html).toContain('chart-frame'); expect(html).toContain('chart-tag'); expect(html).toContain('chart-ring'); expect(html).toContain('chart-handle');
  expect(html).toContain('FRIENDLY FORMATION · 2 SHIPS'); expect(html).toContain('Placement clear.'); expect(html).toContain('Reset positions');
  expect(html).toContain('North up');
});

test('the PvE deploy panel offers a cruising formation for the selected group; custom battles keep their spawn presets', () => {
  const deployment: Deployment = {
    units: [{ id: 'bb', presetId: 'bismarck', name: 'Bismarck', side: 'friendly', groupId: 'front', spawn: { x: 0, z: 12000, heading: 0 } },
      { id: 'dd', presetId: 'fletcher', name: 'Fletcher', side: 'friendly', groupId: 'front', spawn: { x: 900, z: 12000, heading: 0 } }],
    groups: [{ id: 'front', name: 'Group 1', side: 'friendly', formation: 'screen' }],
    terrain: OPEN_SEA, bearing: 0, bounds: { kind: 'circle', radius: 25000 }, friendlyMinZ: 7000, focus: { x: 0, z: 0 }, labels: {}, error: '',
  };
  const pve = renderToStaticMarkup(<DeployScreen deployment={deployment} onChange={() => {}} onReset={() => {}} disabled={false} fitKey="x" onFormation={() => {}}/>);
  expect(pve).toContain('Cruising formation');
  expect(pve).toContain('Formation · Group 1');
  for (const label of ['Column', 'Double column', 'Triple column', 'Screen', 'Line abreast']) expect(pve).toContain(`>${label}</`);
  expect(pve).toContain('destroyers on an outer ring'); // The hint follows the group's own choice.
  expect(pve).toContain('GROUP 1 · 2 SHIPS · SCREEN');
  // Custom battles have no task groups, so the panel keeps only the line/column/wedge spawn preset.
  const custom = renderToStaticMarkup(<DeployScreen deployment={customDeployment(setup, OPEN_SEA)} onChange={() => {}} onReset={() => {}} disabled={false} fitKey="x"/>);
  expect(custom).not.toContain('Cruising formation');
  expect(custom).toContain('FRIENDLY FORMATION · 2 SHIPS<');
});

test('a new player sees which ships research still locks and which sail only with the enemy', () => {
  const snapshot = { status: 'ready' as const, profile: emptyProfile(), source: 'harness' as const };
  const store = { snapshot: () => snapshot, subscribe: () => () => {} } as unknown as ProgressStore;
  const rule = fleetRule(snapshot);
  // Custom battles keep every card usable: the enemy lane takes any ship.
  const catalog = renderToStaticMarkup(<ShipCatalog ships={['gleaves', 'fletcher', 'valiant']} hint="" unavailable={() => ''} access={rule} onPick={() => {}} onDragStart={() => {}} onDragEnd={() => {}}/>);
  const cards = catalog.split('<li class="ship-card').slice(1);
  expect(cards[0]).not.toContain('ship-restriction');
  expect(cards[1]).toContain('is-restricted'); expect(cards[1]).toContain('lock-glyph'); expect(cards[1]).toContain('Unlock in the tech tree'); expect(cards[1]).not.toContain('disabled=""');
  expect(cards[2]).toContain('Enemy only'); expect(cards[2]).not.toContain('lock-glyph');
  // A locked ship picked from the catalog lights the enemy lane only.
  const lanes = renderToStaticMarkup(<CustomLanes setup={{ ...setup, playerShipId: 'gleaves', friendlyBots: [] }} onChange={() => {}} transfer={{ kind: 'catalog', id: 'fletcher' }} onTransfer={() => {}} onError={() => {}} rule={rule}/>);
  expect(lanes).toMatch(/class="fleet-lane friendly[^"]*"/); expect(lanes).not.toMatch(/class="fleet-lane friendly[^"]*is-accepting/);
  expect(lanes).toMatch(/class="fleet-lane enemy[^"]*is-accepting/); expect(lanes).not.toMatch(/command-berth is-accepting/);
  const open = renderToStaticMarkup(<CustomLanes setup={{ ...setup, playerShipId: 'gleaves', friendlyBots: [] }} onChange={() => {}} transfer={{ kind: 'catalog', id: 'cleveland' }} onTransfer={() => {}} onError={() => {}} rule={rule}/>);
  expect(open).toMatch(/class="fleet-lane friendly[^"]*is-accepting/); expect(open).toMatch(/command-berth is-accepting/);
  // A 1v1 fleet is all the player's own, so its catalog disables them.
  const duel = renderToStaticMarkup(<ProgressProvider store={store}><BattleDialog initialMode="duel" initialShipId="gleaves" loading={false} onClose={() => {}} setup={setup} onSetupChange={() => {}} onLaunchCustom={() => {}} customError="" onLaunchPve={async () => {}} onOnlineBattle={async () => {}}/></ProgressProvider>);
  const fletcher = duel.split('<li class="ship-card').find(card => card.includes('Choose Fletcher,'))!;
  expect(fletcher).toContain('is-unavailable'); expect(fletcher).toContain('Unlock in the tech tree'); expect(fletcher).toContain('disabled=""');
  // The remembered custom roster commands a locked Bismarck until the dialog replaces it: the launch waits.
  const custom = renderToStaticMarkup(<ProgressProvider store={store}><BattleDialog initialMode="custom" initialShipId="gleaves" loading={false} onClose={() => {}} setup={setup} onSetupChange={() => {}} onLaunchCustom={() => {}} customError="" onLaunchPve={async () => {}} onOnlineBattle={async () => {}}/></ProgressProvider>);
  expect(custom).toContain('Choose an unlocked ship for the command berth.');
  expect(custom).toMatch(/<button[^>]*disabled=""[^>]*>Deploy fleet/);
});
