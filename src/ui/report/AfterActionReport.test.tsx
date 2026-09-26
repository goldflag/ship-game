import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { BattleDebrief, DebriefShip } from '../../game/session/BattleSession';
import { AfterActionReport } from './AfterActionReport';
import { BattlePlot } from './BattlePlot';
import { CaptainsLog } from './CaptainsLog';
import { FleetLedger } from './FleetLedger';
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
  ship({ id: 'e', team: 'enemy', status: 'sunk', integrity: 0, damageDealt: 4850,
    report: { damageTaken: 41260, shotsFired: 168, hitsLanded: 2, dealtByWeapon: {}, dealtTo: { p: 4850 }, hits: [], hitsOmitted: 0, lostTick: 49860, sunkBy: 'p' } }),
] };
const props = { mode: 'Custom battle', result: 'victory' as const, outcome: { winnerTeamId: 'a' as const, reason: 'destruction' as const, finalTick: 52320, afloatKg: [1, 0] as [number, number] }, debrief,
  actions: [{ label: 'Battle again', hint: 'Same fleets', run() {} }, { label: 'Return to port', run() {} }], loadModel: () => Promise.reject(new Error('no renderer in tests')), releasePointer() {} };

test('the end screen opens on the sea: a rail with the result, your ship and both fleets, and the way on', () => {
  const html = renderToStaticMarkup(<AfterActionReport {...props} />);
  expect(html).toContain('data-view="sea"');
  expect(html).toContain('Custom battle · <span class="aar-num">14:32</span>');
  expect(html).toContain('<h1>Victory</h1>');
  expect(html).toContain('The enemy fleet can no longer fight');
  expect(html).toContain('<strong>Valiant</strong><em>You</em><span>Afloat · 63%</span>');
  expect(html).toContain('<dt>Dealt</dt><dd>41,260</dd>');
  expect(html).toContain('<dt>Hit rate</dt><dd>16%</dd>');
  expect(html).toContain('<dt>BISMARCK</dt><dd>100%<span> yours</span></dd>');
  expect(html).toContain('All 1 afloat');
  expect(html).toContain('All 1 sunk');
  expect(html).toMatch(/primary-button[^>]*>Battle again<small>Same fleets<\/small>/);
  expect(html).toContain('Full report ›');
  expect(html).not.toContain('aar-tabs');
});

test('the rail carries the research XP the battle earned', () => {
  const award = { total: 376, nations: { usa: 338 }, free: 38, breakdown: { sinking: 0, damage: 190, time: 80, odds: 1.5, outcome: 1.5 } };
  const html = renderToStaticMarkup(<AfterActionReport {...props} xp={{ state: { status: 'awarded', award }, retry() {} }} />);
  expect(html).toMatch(/can no longer fight<\/p><div class="xp-progress"><p class="xp-award" data-state="awarded" role="status">/);
  expect(html).toContain('+376 XP');
  expect(html).toContain('United States 338 · Free 38');
  expect(renderToStaticMarkup(<AfterActionReport {...props} xp={{ state: { status: 'saving' }, retry() {} }} />)).toContain('Saving XP…');
  expect(renderToStaticMarkup(<AfterActionReport {...props} />)).not.toContain('xp-award');
});

test('your battle leads with your numbers, what hurt you and where your shells went', () => {
  const own = debrief.ships[0];
  const html = renderToStaticMarkup(<CaptainsLog debrief={debrief} own={own} loadModel={props.loadModel} onHit={() => {}} onShip={() => {}} />);
  expect(html).toContain('<dt>Damage dealt</dt><dd class="aar-num">41,260</dd><small>Sank BISMARCK</small>');
  expect(html).toContain('<small>100% of it from BISMARCK</small>');
  expect(html).toContain('<dt>Stopped by armor</dt><dd class="aar-num">1<span> of 2 hits</span></dd><small>10,050 damage turned away</small>');
  expect(html).toContain('610 mm Type 93 · Torpedo × 1<small>from BISMARCK</small>');
  expect(html).toContain('Sunk 13:51 · final blow Valiant');
  expect(html).toContain('<b>41,260</b> yours · 100%');
  expect(html).toContain('Your fleet · 0 of 1 lost · 41,260 dealt');
  // A ship whose content this client does not hold has no model to draw.
  expect(html).not.toContain('aar-drawing');
});

test('the fleets tab tabulates both fleets, who hit whom and the selected ship', () => {
  const html = renderToStaticMarkup(<FleetLedger debrief={debrief} outcome={props.outcome} selected="e" onSelect={() => {}} loadModel={props.loadModel} onInspect={() => {}} />);
  expect(html).toContain('Enemy fleet · 1 of 1 lost · <b class="aar-num">4,850</b> dealt');
  expect(html).toMatch(/aria-pressed="false"[^>]*>Valiant<\/button><em>You<\/em>/);
  expect(html).toMatch(/aria-pressed="true"[^>]*>BISMARCK<\/button><small>Battleship<\/small>/);
  expect(html).toContain('Sunk 13:51 by Valiant');
  expect(html).toContain('23 / 142<small>16%</small>');
  expect(html).toContain('title="Valiant → BISMARCK: 41,260"');
  expect(html).toContain('Damage dealt over the battle');
  expect(html).toContain('BISMARCK sunk 13:51');
  expect(html).toContain('<strong>BISMARCK</strong>');
  expect(html).toContain('Taken from</span>Valiant 41,260');
  expect(html).toContain('title="BISMARCK → Valiant: 4,850"');
});

test('the battle plot draws a lane of hits per ship and marks each loss', () => {
  const html = renderToStaticMarkup(<BattlePlot debrief={debrief} outcome={props.outcome} />);
  expect(html).toContain('aria-label="Valiant: 2 hits"');
  expect(html).toContain('aria-label="BISMARCK: 0 hits, sunk at 13:51"');
  expect(html).toContain('title="Sunk 13:51"');
  expect(html).toContain('8:31 · 610 mm Type 93 · Torpedo from BISMARCK · 4,850 damage');
});

test('hits start on the battered side and hide behind the hull they struck', () => {
  const rows = hitRows(debrief, 'p');
  expect(batteredSide(rows)).toBe(1);
  const fromStarboard = { x: .8, y: .4, z: -.4 };
  expect(facesCamera([14, -4, 100], 17, 7, fromStarboard)).toBe(true);
  expect(facesCamera([-16, 3, -10], 17, 7, fromStarboard)).toBe(false);
  expect(facesCamera([-3, 18, -15], 17, 7, fromStarboard)).toBe(true);
});

test('a scenario is judged on points: both totals, where they came from, why the raid left and its plan revealed', () => {
  const scenario = { id: 'savo-island', plan: 'south-sweep', weather: 'overcast', withdrawal: 'losses' as const, points: [32, 14] as [number, number], lines: [
    { team: 'friendly' as const, kind: 'sunk' as const, shipId: 'e', presetId: 'takao', points: 17 },
    { team: 'friendly' as const, kind: 'sunk' as const, shipId: 'x', presetId: 'mogami', points: 15 },
    { team: 'enemy' as const, kind: 'protected' as const, shipId: 'barnett', presetId: 'victory-cargo', points: 12 },
    { team: 'enemy' as const, kind: 'sunk' as const, shipId: 'blue', presetId: 'gleaves', points: 2 },
  ] };
  const html = renderToStaticMarkup(<AfterActionReport {...props} mode="Savo Island" outcome={{ ...props.outcome, reason: 'withdrawal' }} debrief={{ ...debrief, scenario }} />);
  expect(html).toContain('Savo Island · <span class="aar-num">14:32</span>');
  expect(html).toContain('The raiders broke off after heavy losses');
  expect(html).toContain('Victory points');
  expect(html).toContain('<strong class="aar-num">32</strong><span>You</span><small>2 warships sunk 32</small>');
  expect(html).toContain('<strong class="aar-num">14</strong><span>The raiders</span><small>1 transport sunk 12 · 1 warship sunk 2</small>');
  expect(html).toContain('The raid came through the south channel for your cruisers, as Mikawa did.');
  // Dawn names the raiders it caught.
  const dawn = renderToStaticMarkup(<AfterActionReport {...props} mode="Savo Island" outcome={{ ...props.outcome, reason: 'time-limit' }}
    debrief={{ ...debrief, scenario: { ...scenario, withdrawal: null, lines: [...scenario.lines, { team: 'friendly' as const, kind: 'exposed' as const, shipId: 'y', presetId: 'mogami', points: 8 }] } }} />);
  expect(dawn).toContain('Dawn found 1 raider still in the sound');
  expect(dawn).toContain('1 caught at dawn 8');
});
