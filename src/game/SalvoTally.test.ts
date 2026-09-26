import { expect, test } from 'bun:test';
import { SalvoTally } from './SalvoTally';
import type { CombatEvent } from './session/elements';

type Impact = NonNullable<CombatEvent['impact']>;
const impact = (sequence: number, shellId: number, overrides: Partial<Impact> = {}, kind: CombatEvent['kind'] = 'penetration'): CombatEvent => ({
  sequence, tick: 0, kind, shipId: 'enemy', sourceId: 'player', position: [0, 0, 0], message: 'impact',
  impact: { shellId, shipId: 'enemy', targetId: 'belt', targetName: 'Main belt', kind: 'armor', position: [0, 0, 0],
    penetrationBeforeMm: 500, penetrationAfterMm: 100, outcome: 'penetrated', hullDamage: 100, ...overrides },
});

test('one salvo reads as one total, however far apart its mounts fire, with one outcome per shell', () => {
  const tally = new SalvoTally();
  // Shell 1 goes through the belt and bursts inside: one penetration, both layers' damage.
  tally.add(impact(1, 1), 10, true);
  tally.add(impact(2, 1, { kind: 'burst', outcome: 'detonation', hullDamage: 400 }, 'burst'), 10, true);
  tally.add(impact(3, 2, { outcome: 'detonation', hullDamage: 50 }, 'burst'), 10.2, true);
  tally.add(impact(4, 3, { outcome: 'ricochet', hullDamage: 0 }, 'ricochet'), 10.9, true);
  // The mount that came on aim a second later still joins the salvo on screen.
  tally.add(impact(5, 4, { outcome: 'stopped', hullDamage: 0 }, 'stopped'), 11.8, true);
  tally.add({ sequence: 6, tick: 0, kind: 'torpedo-hit', shipId: 'enemy', sourceId: 'player', position: [0, 0, 0], message: 'Torpedo hit',
    hullDamage: 900, torpedo: { id: 9, velocity: [0, 0, -20], diameterM: .533 } }, 12, true);
  expect(tally.read(12)).toMatchObject({ damage: 1450, hits: 5, opacity: 1,
    kinds: { penetrated: 1, burst: 1, ricochet: 1, stopped: 1, torpedo: 1 } });
  // Others' hits never join your total.
  tally.add({ ...impact(7, 20), sourceId: 'ally' }, 12, false);
  expect(tally.read(12).damage).toBe(1450);
  expect(tally.read(14.3).opacity).toBeCloseTo(.5);
  expect(tally.read(14.7).opacity).toBe(0);
  // Once it has faded, the next hit starts a new salvo.
  tally.add(impact(8, 30), 20, true);
  expect(tally.read(20)).toMatchObject({ damage: 100, hits: 1, kinds: { penetrated: 1, burst: 0 } });
});

test('a ram adds to the total without counting as a hit', () => {
  const tally = new SalvoTally();
  tally.add({ sequence: 1, tick: 0, kind: 'contact', shipId: 'enemy', sourceId: 'player', position: [0, 0, 0], message: 'Ram', hullDamage: 300 }, 1, true);
  expect(tally.read(1)).toMatchObject({ damage: 300, hits: 0, opacity: 1 });
});

test('lost equipment shows separately from the total, from any source, once per part', () => {
  const tally = new SalvoTally();
  const gun = (sequence: number, targetId: string, outcome: Impact['outcome'], extra: Partial<Impact> = {}) =>
    impact(sequence, sequence, { kind: 'mount', targetId, targetName: 'Anton', outcome, damage: 40, ...extra });
  tally.add(gun(1, 'anton', 'damaged'), 1, true, 'Main gun');
  tally.add(gun(2, 'anton', 'destroyed'), 1.1, true, 'Main gun');
  tally.add(gun(3, 'anton', 'damaged'), 1.2, true, 'Main gun');
  tally.add(gun(4, 'bruno', 'damaged'), 1.3, false, 'Main gun');
  tally.add(gun(5, 'caesar', 'damaged'), 1.4, true, 'Main gun');
  // Wreckage struck again and scratches without damage are not losses.
  tally.add(gun(6, 'dora', 'damaged', { throughWreckage: true }), 1.5, true, 'Main gun');
  tally.add(gun(7, 'dora', 'damaged', { damage: 0 }), 1.5, true, 'Main gun');
  tally.add(impact(8, 8, { kind: 'module', targetId: 'boiler', outcome: 'damaged', damage: 10 }), 1.5, true);
  expect(tally.read(2).equipment).toEqual([
    { label: 'Main gun', destroyed: true, count: 1, opacity: 1 },
    { label: 'Main gun', destroyed: false, count: 2, opacity: 1 },
  ]);
  expect(tally.read(4.8).equipment.map(cue => cue.opacity)).toEqual([expect.closeTo(.5), expect.closeTo(.75)]);
  expect(tally.read(6).equipment).toEqual([]);
});

test('a battle reset clears the tally', () => {
  const tally = new SalvoTally();
  tally.add(impact(1, 1, { kind: 'module', targetId: 'boiler', outcome: 'destroyed', damage: 10 }), 30, true, 'Engine');
  expect(tally.read(30)).toMatchObject({ damage: 100, hits: 1 });
  expect(tally.read(0)).toMatchObject({ damage: 0, hits: 0, opacity: 0, equipment: [] });
});
