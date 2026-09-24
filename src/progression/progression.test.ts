import { describe, expect, test } from 'bun:test';
import { shipPresets } from '../ships/presets';
import { NATION_IDS, TECH_TREE, modelledNodes, prerequisite, presetNation } from './techTree';
import { applyAdminAction, applyAward, applyGrant, applyUnlock, emptyProfile, nodeState, openProfile, ownsPreset, ProgressError, sanitizeProfile, validateAdminAction } from './rules';
import { awardFor, validateSummary, type BattleSummary } from './xp';
import { canCommandPreset, createHarnessProgressStore } from './store';

const ENEMY_ONLY = ['valiant', 'resolute', 'liberty-cargo', 'liberty-collier', 'victory-cargo'];

describe('tech tree data', () => {
  test('node ids are unique and every modelled node names a registered preset once', () => {
    const ids = TECH_TREE.flatMap(nation => nation.lines.flatMap(line => line.nodes.map(node => node.id)));
    expect(new Set(ids).size).toBe(ids.length);
    const presets = modelledNodes().map(node => node.presetId!);
    expect(new Set(presets).size).toBe(presets.length);
    for (const id of presets) expect(Object.hasOwn(shipPresets, id)).toBe(true);
  });
  test('every roster ship is in exactly one tree except the enemy-only ones', () => {
    for (const id of Object.keys(shipPresets)) expect(presetNation(id) === undefined).toBe(ENEMY_ONLY.includes(id));
  });
  test('lines run oldest first, starters cost nothing, everything else costs XP', () => {
    for (const nation of TECH_TREE) {
      expect(nation.lines.some(line => line.nodes.some(node => node.starter))).toBe(true);
      for (const line of nation.lines) {
        const years = line.nodes.map(node => node.year);
        expect(years).toEqual([...years].sort((a, b) => a - b));
        for (const node of line.nodes) {
          if (node.starter) { expect(node.cost).toBe(0); expect(node.presetId).toBeDefined(); }
          else expect(node.cost).toBeGreaterThan(0);
        }
      }
    }
  });
  test('placeholders never gate: the prerequisite is the nearest modelled node above', () => {
    expect(prerequisite('fletcher')?.id).toBe('gleaves');
    expect(prerequisite('gleaves')).toBeUndefined();
    expect(prerequisite('iowa')).toBeUndefined();
    expect(prerequisite('yukikaze')?.id).toBe('fubuki');
  });
});

describe('unlock rules', () => {
  test('a new profile owns only the starters', () => {
    const profile = emptyProfile();
    expect(ownsPreset(profile, 'gleaves')).toBe(true);
    expect(ownsPreset(profile, 'fletcher')).toBe(false);
    expect(ownsPreset(profile, 'valiant')).toBe(false);
    expect(nodeState(profile, 'fletcher')).toBe('short');
    expect(nodeState(profile, 'us-allen-m-sumner')).toBe('placeholder');
  });
  test('unlocking spends nation XP first, then free XP, and keeps the prerequisite chain', () => {
    const profile = { ...emptyProfile(), xp: { ...emptyProfile().xp, usa: 1000 }, freeXp: 1000 };
    const { profile: next, spent } = applyUnlock(profile, 'fletcher');
    expect(spent).toEqual({ nation: 'usa', fromNation: 1000, fromFree: 800 });
    expect(next.xp.usa).toBe(0);
    expect(next.freeXp).toBe(200);
    expect(ownsPreset(next, 'fletcher')).toBe(true);
    expect(() => applyUnlock(next, 'fletcher')).toThrow(ProgressError);
    expect(() => applyUnlock(next, 'us-gearing')).toThrow(/not in the game/);
    expect(() => applyUnlock(emptyProfile(), 'baltimore')).toThrow(/needs 3,000 XP/);
  });
  test('storage input is repaired', () => {
    const repaired = sanitizeProfile({ xp: { usa: -5, japan: 12.7, mars: 9 }, freeXp: 'x', unlocked: ['fletcher', 'us-gearing', 'nope', 'fletcher'], allUnlocked: 'yes' });
    expect(repaired).toEqual({ version: 1, xp: { usa: 0, japan: 12, germany: 0, uk: 0 }, freeXp: 0, unlocked: ['fletcher'], earned: 0 });
  });
  test('grants add XP everywhere or open every ship', () => {
    const granted = applyGrant(emptyProfile(), { xp: 500 });
    for (const id of NATION_IDS) expect(granted.xp[id]).toBe(500);
    expect(granted.freeXp).toBe(500);
    expect(ownsPreset(applyGrant(emptyProfile(), { unlockAll: true }), 'yamato')).toBe(true);
  });
});

const duel = (overrides: Partial<BattleSummary> = {}): BattleSummary => ({
  mode: 'custom', result: 'victory', durationS: 600,
  friendly: [{ presetId: 'fletcher', massKg: 2_924_000, lost: false, integrity: .6 }],
  enemy: [{ presetId: 'fletcher', massKg: 2_924_000, lost: true, integrity: 0, opposition: 'normal' }],
  ...overrides,
});

describe('battle XP', () => {
  test('an even destroyer duel won against a normal crew pays a few hundred XP, mostly to its nation', () => {
    const award = awardFor(duel());
    expect(award.total).toBeGreaterThan(300);
    expect(award.total).toBeLessThan(500);
    expect(award.nations.usa! + award.free).toBe(award.total);
    expect(award.free).toBe(Math.round(award.total * .1));
  });
  test('targets that do not fight back pay nothing', () => {
    expect(awardFor(duel({ enemy: [{ presetId: 'fletcher', massKg: 2_924_000, lost: true, integrity: 0, opposition: 'static' }] })).total).toBe(0);
  });
  test('overwhelming force earns less; defeat earns less than victory', () => {
    const even = awardFor(duel()).total;
    const yamatos = Array.from({ length: 5 }, () => ({ presetId: 'yamato', massKg: 69_935_000, lost: false, integrity: 1 }));
    expect(awardFor(duel({ friendly: yamatos })).total).toBeLessThan(even / 2);
    expect(awardFor(duel({ result: 'defeat' })).total).toBeLessThan(even);
  });
  test('player designs and enemy-only ships earn free XP', () => {
    const award = awardFor(duel({ friendly: [{ presetId: null, massKg: 2_924_000, lost: false, integrity: 1 }] }));
    expect(award.nations).toEqual({});
    expect(award.free).toBe(award.total);
  });
  test('summaries are validated', () => {
    expect(validateSummary(duel())).toEqual(duel());
    expect(() => validateSummary({ ...duel(), durationS: 99999 })).toThrow(/duration/);
    expect(() => validateSummary({ ...duel(), friendly: [] })).toThrow(/friendly/);
    expect(() => validateSummary({ ...duel(), enemy: [{ presetId: 'x', massKg: 1, lost: false, integrity: 2 }] })).toThrow(/integrity/);
    expect(applyAward(emptyProfile(), awardFor(duel())).earned).toBe(awardFor(duel()).total);
  });
});

describe('harness store', () => {
  test('opens every tree ship but never enemy-only presets', () => {
    const store = createHarnessProgressStore(false);
    expect(store.snapshot().profile).toEqual(openProfile());
    expect(canCommandPreset(store.snapshot(), 'yamato')).toBe(true);
    expect(canCommandPreset(store.snapshot(), 'valiant')).toBe(false);
  });
  test('a fresh profile unlocks, pays each battle once and resets', async () => {
    const saved = new Map<string, string>();
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k: string) => saved.get(k) ?? null, setItem: (k: string, v: string) => saved.set(k, v) } });
    try {
      const store = createHarnessProgressStore(true);
      expect(canCommandPreset(store.snapshot(), 'fletcher')).toBe(false);
      await store.grant({ xp: 2000 });
      await store.unlock('fletcher');
      expect(canCommandPreset(store.snapshot(), 'fletcher')).toBe(true);
      const first = await store.award('battle-1', duel());
      const earned = store.snapshot().profile.earned;
      expect(await store.award('battle-1', duel())).toEqual(first);
      expect(store.snapshot().profile.earned).toBe(earned);
      await expect(store.unlock('iowa')).rejects.toThrow(/6,500 XP/);
      await store.grant({ reset: true });
      expect(store.snapshot().profile).toEqual(emptyProfile());
    } finally {
      if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });
});

describe('admin actions', () => {
  test('grant XP to one pool or all, never below zero', () => {
    const base = emptyProfile();
    const us = applyAdminAction(base, validateAdminAction({ action: 'grant-xp', amount: 900, pool: 'usa' }));
    expect(us.xp.usa).toBe(900);
    expect(us.freeXp).toBe(0);
    const all = applyAdminAction(us, { action: 'grant-xp', amount: 100, pool: 'all' });
    expect([all.xp.usa, all.xp.japan, all.freeXp]).toEqual([1000, 100, 100]);
    expect(applyAdminAction(all, { action: 'grant-xp', amount: -5000, pool: 'free' }).freeXp).toBe(0);
  });
  test('gift and remove single ships, open everything, reset', () => {
    const gifted = applyAdminAction(emptyProfile(), validateAdminAction({ action: 'unlock', nodeId: 'yamato' }));
    expect(ownsPreset(gifted, 'yamato')).toBe(true);
    expect(gifted.xp.japan).toBe(0);
    expect(ownsPreset(applyAdminAction(gifted, { action: 'lock', nodeId: 'yamato' }), 'yamato')).toBe(false);
    expect(() => applyAdminAction(gifted, { action: 'lock', nodeId: 'gleaves' })).toThrow(/Starters/);
    const open = applyAdminAction(gifted, { action: 'unlock-all', value: true });
    expect(ownsPreset(open, 'iowa')).toBe(true);
    expect('allUnlocked' in applyAdminAction(open, { action: 'unlock-all', value: false })).toBe(false);
    expect(applyAdminAction(open, { action: 'reset' })).toEqual(emptyProfile());
  });
  test('requests are validated', () => {
    for (const bad of [{}, { action: 'grant-xp', amount: 1.5, pool: 'usa' }, { action: 'grant-xp', amount: 5, pool: 'mars' },
      { action: 'grant-xp', amount: 2_000_000, pool: 'all' }, { action: 'unlock', nodeId: 'us-gearing' }, { action: 'unlock-all', value: 'yes' }])
      expect(() => validateAdminAction(bad)).toThrow(ProgressError);
  });
});
