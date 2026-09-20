import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { BattleDebrief, DebriefShip } from '../../game/session/BattleSession';
import { AfterActionReport } from './AfterActionReport';
import { batteredSide, facesCamera } from './HitModel';
import { hitRows } from './afterAction';

const ship = (partial: Partial<DebriefShip> & Pick<DebriefShip, 'id' | 'team'>): DebriefShip => ({ presetId: 'bismarck', name: 'Bismarck', status: 'operational', isPlayer: false, integrity: 1,
  damageDealt: 0, armorBlocked: 0, frags: 0, aircraftRemaining: 0, report: { damageTaken: 0, shotsFired: 0, hitsLanded: 0, dealtByWeapon: {}, dealtTo: {}, hits: [], hitsOmitted: 0 }, ...partial });
const debrief: BattleDebrief = { seed: 1, tick: 52320, timeline: [{ tick: 3600, own: 900, enemy: 200 }], ships: [
  ship({ id: 'p', team: 'friendly', presetId: 'local-7', name: 'Valiant', isPlayer: true, integrity: .63, damageDealt: 41260, armorBlocked: 10050,
    report: { damageTaken: 4850, shotsFired: 142, hitsLanded: 23, dealtByWeapon: { '406 mm AP': 38900, '127 mm HE': 2360 }, dealtTo: { e: 41260 }, hitsOmitted: 0, hits: [
      { tick: 30660, sourceId: 'e', weapon: '610 mm Type 93 · Torpedo', kind: 'torpedo', position: [14, -4, 100], struck: 'Steering flat', outcome: 'detonated', damage: 4850, breachAreaM2: 1,
        flooded: ['Steering flat'], modules: [{ id: 'rudder-s', name: 'Rudder, starboard', damage: 80, destroyed: true }] },
      { tick: 9000, sourceId: 'e', weapon: '380 mm AP', kind: 'shell', ammunition: 'ap', position: [-16, 3, -10], struck: 'Main belt', outcome: 'stopped', damage: 0, breachAreaM2: 0, flooded: [], modules: [],
        plate: { name: 'Main belt', thicknessMm: 310, obliquityDeg: 24 } }] } }),
  ship({ id: 'e', team: 'enemy', status: 'sunk', integrity: 0, damageDealt: 4850, report: { damageTaken: 41260, shotsFired: 168, hitsLanded: 2, dealtByWeapon: {}, dealtTo: {}, hits: [], hitsOmitted: 0, lostTick: 49860, sunkBy: 'p' } }),
] };
const props = { mode: 'Custom battle', result: 'victory' as const, outcome: { winnerTeamId: 'a' as const, reason: 'destruction' as const, finalTick: 52320, afloatKg: [1, 0] as [number, number] }, debrief,
  actions: [{ label: 'Battle again', hint: 'Same fleets', run() {} }, { label: 'Return to port', run() {} }], loadModel: () => Promise.reject(new Error('no renderer in tests')), releasePointer() {} };

test('the report opens on the results: outcome, both fleets, the tab that holds the ship', () => {
  const html = renderToStaticMarkup(<AfterActionReport {...props} />);
  expect(html).toContain('Custom battle · Battle complete');
  expect(html).toContain('<h1>Victory</h1>');
  expect(html).toContain('The enemy fleet can no longer fight · <span class="aar-num">14:32</span> elapsed');
  expect(html).toContain('Your fleet · 0 of 1 lost');
  expect(html).toContain('Enemy fleet · 1 of 1 lost');
  expect(html).toContain('Sunk 13:51 by Valiant');
  expect(html).toContain('<span>406 mm AP <b>38,900</b></span><span>127 mm HE <b>2,360</b></span>');
  expect(html).toContain('23 / 142');
  expect(html).toContain('Your ship<small>2 hits · 4,850 damage</small>');
  expect(html).toContain('BISMARCK sunk');
  expect(html).toMatch(/primary-button[^>]*>Battle again<small>Same fleets<\/small>/);
});

test('hits start on the battered side and hide behind the hull they struck', () => {
  const rows = hitRows(debrief, 'p');
  expect(batteredSide(rows)).toBe(1);
  const fromStarboard = { x: .8, y: .4, z: -.4 };
  expect(facesCamera([14, -4, 100], 17, 7, fromStarboard)).toBe(true);
  expect(facesCamera([-16, 3, -10], 17, 7, fromStarboard)).toBe(false);
  expect(facesCamera([-3, 18, -15], 17, 7, fromStarboard)).toBe(true);
});
