import { describe, expect, test } from 'bun:test';
import type { BattleDebrief, DebriefShip } from '../game/session/BattleSession';
import { runtimeSetup, type BattleSetup } from '../game/session/battleSetup';
import { shipPreset } from '../ships/presets';
import { battleSummary, customOpposition, earnsXp, passiveOpposition, stableBattleId, startBattle, type BattleStart } from './battleSummary';
import { awardFor, validateSummary, XP_RULES } from './xp';

const ship = (partial: Partial<DebriefShip> & Pick<DebriefShip, 'id' | 'team' | 'presetId'>): DebriefShip => ({
  name: partial.presetId, definition: partial.presetId.startsWith('local-') ? { ...shipPreset('fletcher'), id: partial.presetId } : shipPreset(partial.presetId),
  status: 'operational', isPlayer: false, integrity: 1, damageDealt: 0, armorBlocked: 0, frags: 0, aircraftRemaining: 0,
  report: { damageTaken: 0, shotsFired: 0, hitsLanded: 0, dealtByWeapon: {}, dealtTo: {}, hits: [], hitsOmitted: 0 }, ...partial,
});
const debrief: Pick<BattleDebrief, 'ships'> = { ships: [
  ship({ id: 'player', team: 'friendly', presetId: 'local-abc', isPlayer: true, integrity: .63 }),
  ship({ id: 'friendly-1', team: 'friendly', presetId: 'fletcher', status: 'incapacitated', integrity: .2 }),
  ship({ id: 'enemy-1', team: 'enemy', presetId: 'mogami', status: 'sunk', integrity: -.4 }),
  ship({ id: 'enemy-2', team: 'enemy', presetId: 'yamato', integrity: 1.3 }),
] };
const outcome = { reason: 'destruction' as const, finalTick: 52320 };
const setup: BattleSetup = { playerShipId: 'local-abc', friendlyBots: ['fletcher'], enemies: [{ shipId: 'mogami', aiLevel: 'hard' }, { shipId: 'yamato', aiLevel: 'static' }], spawnDistance: 5000 };

describe('battle summary', () => {
  test('custom bots keep their AI level under the ids the battle gives them', () => {
    const levels = customOpposition(setup);
    expect(levels).toEqual({ 'enemy-1': 'hard', 'enemy-2': 'static' });
    // The ids are the ones `runtimeSetup` hands the Rust battle.
    const enemies = runtimeSetup(setup, 1).ships.filter(entry => entry.team === 'b');
    expect(Object.fromEntries(enemies.map(entry => [entry.id, entry.aiLevel as string]))).toEqual(levels);
    expect(customOpposition({ enemies: ['fletcher'] })).toEqual({ 'enemy-1': 'normal' });
  });

  test('designs report no preset, losses count sunk and disabled hulls, integrity is clamped and time is the deciding tick', () => {
    const start: BattleStart = { id: 'x', mode: 'custom', opposition: customOpposition(setup) };
    const summary = battleSummary(start, 'victory', outcome, debrief)!;
    expect(summary.mode).toBe('custom');
    expect(summary.result).toBe('victory');
    expect(summary.durationS).toBeCloseTo(872);
    expect(summary.friendly).toEqual([
      { presetId: null, massKg: shipPreset('fletcher').hull.massKg, lost: false, integrity: .63 },
      { presetId: 'fletcher', massKg: shipPreset('fletcher').hull.massKg, lost: true, integrity: .2 },
    ]);
    expect(summary.enemy).toEqual([
      { presetId: 'mogami', massKg: shipPreset('mogami').hull.massKg, lost: true, integrity: 0, opposition: 'hard' },
      { presetId: 'yamato', massKg: shipPreset('yamato').hull.massKg, lost: false, integrity: 1, opposition: 'static' },
    ]);
    expect(validateSummary(summary)).toEqual(summary);
    expect(awardFor(summary).total).toBeGreaterThan(0);
  });

  test('fleet command enemies count as Normal and a 1v1 opponent as a human', () => {
    const pve = battleSummary({ id: 'x', mode: 'pve' }, 'defeat', outcome, debrief)!;
    expect(pve.enemy.map(entry => entry.opposition)).toEqual(['normal', 'normal']);
    const duel = battleSummary({ id: 'x', mode: 'duel', opposition: { 'enemy-1': 'static' } }, 'draw', outcome, debrief)!;
    expect(duel.enemy.map(entry => entry.opposition)).toEqual(['human', 'human']);
    // A custom enemy the client did not record (the roster grew after the start) falls back to Normal.
    expect(battleSummary({ id: 'x', mode: 'custom' }, 'victory', outcome, debrief)!.enemy[0].opposition).toBe('normal');
  });

  test('undecided, interrupted and abandoned battles earn nothing', () => {
    const start = startBattle('custom', setup);
    expect(start.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(start.opposition).toEqual(customOpposition(setup));
    expect(startBattle('pve').opposition).toBeUndefined();
    expect(battleSummary(start, 'active', undefined, debrief)).toBeUndefined();
    expect(battleSummary(start, 'victory', { reason: 'infrastructure', finalTick: 10 }, debrief)).toBeUndefined();
    expect(battleSummary(start, 'defeat', { reason: 'abandoned', finalTick: 10 }, debrief)).toBeUndefined();
    expect(battleSummary(start, 'victory', outcome, undefined)).toBeUndefined();
    expect(earnsXp('draw', { reason: 'time-limit' })).toBe(true);
    expect(earnsXp('victory', { reason: 'forfeit' })).toBe(true);
  });

  test('long missions and huge designs stay inside what the accounts API accepts', () => {
    const giant = ship({ id: 'player', team: 'friendly', presetId: 'local-big', isPlayer: true });
    const heavy = { ...giant, definition: { ...giant.definition!, hull: { ...giant.definition!.hull, massKg: 900_000_000 } } };
    const summary = battleSummary({ id: 'x', mode: 'pve' }, 'victory', { reason: 'destruction', finalTick: 60 * 60 * 90 },
      { ships: [heavy, ...Array.from({ length: 40 }, (_, i) => ship({ id: `e${i}`, team: 'enemy', presetId: 'fletcher' }))] })!;
    expect(summary.durationS).toBe(XP_RULES.maxDurationS);
    expect(summary.friendly[0].massKg).toBe(XP_RULES.maxMassKg);
    expect(summary.enemy).toHaveLength(XP_RULES.maxShipsPerSide);
    expect(() => validateSummary(summary)).not.toThrow();
  });

  test('a battle against targets that neither move nor shoot says why it paid nothing', () => {
    const summary = battleSummary({ id: 'x', mode: 'custom', opposition: { 'enemy-1': 'static', 'enemy-2': 'moving' } }, 'victory', outcome, debrief)!;
    expect(awardFor(summary).total).toBe(0);
    expect(passiveOpposition(summary)).toBe(true);
    expect(passiveOpposition(battleSummary({ id: 'x', mode: 'pve' }, 'victory', outcome, debrief)!)).toBe(false);
  });
});

test('a 1v1 keeps one battle id across reconnects: the same match and team give the same UUID', () => {
  const id = stableBattleId('duel:match-7:0');
  expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  expect(stableBattleId('duel:match-7:0')).toBe(id);
  expect(stableBattleId('duel:match-7:1')).not.toBe(id);
  expect(stableBattleId('duel:match-8:0')).not.toBe(id);
  expect(startBattle('duel', undefined, id).id).toBe(id);
});
