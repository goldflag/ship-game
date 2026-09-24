import { expect, test } from 'bun:test';
import type { BattleDebrief, DebriefShip } from '../../game/session/BattleSession';
import type { HitReport } from '../../multiplayer/generated/HitReport';
import { damageRace, fleetRows, hitRows, hurtBy, magazineFloods, pairDamage, roomName, shortState, stackLabels, targetShares } from './afterAction';

const hit = (partial: Partial<HitReport>): HitReport => ({ tick: 600, sourceId: 'e1', weapon: '380 mm AP', kind: 'shell', ammunition: 'ap', position: [10, -2, -20], struck: 'Main belt',
  outcome: 'penetrated', damage: 100, breachAreaM2: 0, flooded: [], modules: [], ...partial });
const ship = (partial: Partial<DebriefShip> & Pick<DebriefShip, 'id' | 'team'>): DebriefShip => ({ presetId: 'bismarck', name: 'Bismarck', status: 'operational', isPlayer: false, integrity: 1,
  damageDealt: 0, armorBlocked: 0, frags: 0, aircraftRemaining: 0, report: { damageTaken: 0, shotsFired: 0, hitsLanded: 0, dealtByWeapon: {}, dealtTo: {}, hits: [], hitsOmitted: 0 }, ...partial });
const debrief: BattleDebrief = {
  seed: 1, tick: 7200, timeline: [{ tick: 300, own: 50, enemy: 0 }, { tick: 3600, own: 400, enemy: 900 }, { tick: 7200, own: 1, enemy: 1 }],
  ships: [
    ship({ id: 'p', team: 'friendly', presetId: 'local-1', name: 'Valiant', isPlayer: true, integrity: .634, damageDealt: 1000,
      report: { damageTaken: 1000, shotsFired: 140, hitsLanded: 23, dealtByWeapon: { '16 in AP': 900, '5 in HE': 60, Ramming: 30, '40 mm': 10 }, dealtTo: { e1: 1000 }, hitsOmitted: 0, hits: [
        hit({ damage: 0, outcome: 'ricochet', plate: { name: 'Turret face', thicknessMm: 432, obliquityDeg: 58.2, resistanceMm: 818.6 } }),
        hit({ tick: 3000, damage: 500, modules: [{ id: 'engine-2', name: 'Engine 2', damage: 40, destroyed: false }], flooded: ['Engine room 2'] }),
        hit({ tick: 3300, damage: 60, ammunition: 'he', outcome: 'burst' }),
        hit({ tick: 3900, damage: 440, kind: 'torpedo', ammunition: undefined, outcome: 'detonated', sourceId: 'e2' }),
      ] } }),
    ship({ id: 'e1', team: 'enemy', status: 'sunk', integrity: 0, damageDealt: 560, report: { damageTaken: 1000, shotsFired: 90, hitsLanded: 3, dealtByWeapon: {}, dealtTo: {}, hits: [], hitsOmitted: 0, lostTick: 6900, sunkBy: 'p' } }),
    ship({ id: 'e2', team: 'enemy', damageDealt: 440 }),
  ],
};

test('fleet rows state each ship, fold minor weapons and name what it sank', () => {
  const [valiant] = fleetRows(debrief, 'friendly');
  expect(valiant).toMatchObject({ title: 'Valiant', state: 'Afloat · 63%', lost: false, hits: '23 / 140', sank: 'BISMARCK 1' });
  expect(valiant.byWeapon).toEqual([{ label: '16 in AP', damage: 900 }, { label: '5 in HE', damage: 60 }, { label: 'Other', damage: 40 }]);
  const [first, second] = fleetRows(debrief, 'enemy');
  expect(first).toMatchObject({ title: 'BISMARCK 1', state: 'Sunk 1:55 by Valiant', lost: true });
  expect(second.title).toBe('BISMARCK 2');
});

test('hit rows number the hits and say what each one did', () => {
  const rows = hitRows(debrief, 'p');
  expect(rows.map(row => [row.n, row.tone, row.outcome, row.size])).toEqual([
    [1, 'blocked', 'Ricochet', 's'], [2, 'penetrated', 'Penetrated', 'l'], [3, 'explosive', 'Burst outside', 'm'], [4, 'torpedo', 'Detonated', 'l'],
  ]);
  expect(rows[0].plate).toBe('432 mm Turret face at 58° · 819 mm effective');
  expect(rows[1]).toMatchObject({ time: '0:50', from: 'BISMARCK 1', effects: [{ name: 'Engine 2', effect: 'Damaged' }, { name: 'Engine room 2', effect: 'Flooding' }] });
  expect(rows[3].from).toBe('BISMARCK 2');
  expect(hitRows(debrief, 'missing')).toEqual([]);
});

test('the damage race starts at zero, ends on the final totals and marks the sinkings', () => {
  const race = damageRace(debrief);
  expect(race.samples[0]).toEqual({ tick: 0, own: 0, enemy: 0 });
  expect(race.samples.at(-1)).toEqual({ tick: 7200, own: 1000, enemy: 1000 });
  expect(race.samples).toHaveLength(4);
  expect(race.marks).toEqual([{ tick: 6900, label: 'BISMARCK 1 sunk', friendly: false }]);
});

test('shares say how much of each enemy was this ship, and who had the final blow', () => {
  const [bismarck, second] = targetShares(debrief, 'p');
  expect(bismarck).toMatchObject({ title: 'BISMARCK 1', state: 'Sunk 1:55', mine: 1000, total: 1000, finalBlow: 'Valiant', by: [{ id: 'p', title: 'Valiant', damage: 1000 }] });
  expect(second).toMatchObject({ title: 'BISMARCK 2', state: 'Afloat · 100%', mine: 0, total: 0, by: [] });
  expect(second.finalBlow).toBeUndefined();
  expect(targetShares(debrief, 'missing')).toEqual([]);
});

test('what hurt most groups hits by enemy and gun, heaviest first', () => {
  expect(hurtBy(debrief, 'p')).toEqual([
    { from: 'BISMARCK 1', weapon: '380 mm AP', hits: 3, damage: 560, share: .56 },
    { from: 'BISMARCK 2', weapon: '380 mm AP', hits: 1, damage: 440, share: .44 },
  ]);
  expect(hurtBy(debrief, 'p', 1)).toHaveLength(1);
});

test('who hit whom lays each fleet against the other', () => {
  expect(pairDamage(debrief, 'friendly')).toEqual({ rows: [{ id: 'p', title: 'Valiant' }], columns: [{ id: 'e1', title: 'BISMARCK 1' }, { id: 'e2', title: 'BISMARCK 2' }], cells: [[1000, 0]], max: 1000 });
  expect(pairDamage(debrief, 'enemy').cells).toEqual([[0], [0]]);
});

test('magazine floods keep the first flooding of each, and room names drop the compiler\'s estimate', () => {
  const flooded = ship({ id: 'x', team: 'friendly', report: { damageTaken: 10, shotsFired: 0, hitsLanded: 0, dealtByWeapon: {}, dealtTo: {}, hitsOmitted: 0, hits: [
    hit({ tick: 900, flooded: ['Aft magazines', 'Engine room'] }), hit({ tick: 600, flooded: ['Torpedo Magazine (estimated)'] }), hit({ tick: 1200, flooded: ['Aft magazines'] })] } });
  expect(magazineFloods(flooded)).toEqual([{ room: 'Torpedo Magazine', tick: 600 }, { room: 'Aft magazines', tick: 900 }]);
  expect(roomName('Starboard reserve space 1 · estimated')).toBe('Starboard reserve space 1');
  expect(shortState(ship({ id: 'y', team: 'enemy', status: 'incapacitated' }))).toBe('Out of action');
});

test('labels over a time axis stack into rows instead of overlapping, and flip at the end', () => {
  const stacked = stackLabels([{ at: .5, label: 'C' }, { at: .1, label: 'AAAA' }, { at: .11, label: 'BBBB' }, { at: .99, label: 'DDDD' }]);
  expect(stacked.map(label => [label.label, label.row, label.flip])).toEqual([['AAAA', 0, false], ['BBBB', 1, false], ['C', 0, false], ['DDDD', 0, true]]);
});
