import { describe, expect, test } from 'bun:test';
import { emptyProfile, openProfile, type ProgressProfile } from '../progression/rules';
import type { ProgressSnapshot } from '../progression/store';
import { modelledNodes } from '../progression/techTree';
import type { LocalShipRevision } from '../ships/localShips';
import type { PortDesign } from './portDesigns';
import { fallbackBerth, openingPreset, portFleet, STARTER_BERTH } from './portFleet';

const snapshot = (profile: ProgressProfile, status: ProgressSnapshot['status'] = 'ready'): ProgressSnapshot => ({ status, profile, source: 'harness' });
const design = (sourceId: string, name: string, ready = true): PortDesign => ({
  id: sourceId,
  name,
  updatedAt: 1,
  status: ready ? 'ready' : 'draft',
  ...(ready ? { ship: { source: { id: sourceId, name }, definition: { id: `local-${sourceId}`, name } } as unknown as LocalShipRevision } : {}),
});
const ids = (groups: ReturnType<typeof portFleet>) => groups.map((group) => [group.id, group.entries.map((entry) => entry.shipId)]);
const ENEMY_ONLY = ['valiant', 'resolute', 'liberty-cargo', 'liberty-collier', 'victory-cargo'];

describe('the fleet line', () => {
  test('groups owned tree ships by nation in tree order, line by line and oldest first, then ready designs', () => {
    const groups = portFleet(snapshot(openProfile()), [design('a', 'Baltimore design'), design('b', 'Draft hull', false)]);
    expect(ids(groups)).toEqual([
      ['usa', ['gleaves', 'fletcher', 'cleveland', 'baltimore', 'alaska', 'iowa', 'enterprise-cv6']],
      ['japan', ['fubuki', 'yukikaze', 'mogami', 'kongo', 'yamato', 'shokaku']],
      ['germany', ['admiral-hipper', 'bismarck', 'type-viic']],
      ['uk', ['hood', 'king-george-v', 'flower-corvette']],
      ['designs', ['local-a']],
    ]);
    expect(groups.map((group) => group.label)).toEqual(['United States', 'Japan', 'Germany', 'United Kingdom', 'Your designs']);
    for (const id of ENEMY_ONLY) expect(groups.flatMap((group) => group.entries).some((entry) => entry.shipId === id)).toBe(false);
  });

  test('a new player owns the starters; the designs group stays for New design and All designs', () => {
    expect(ids(portFleet(snapshot(emptyProfile()), []))).toEqual([
      ['usa', ['gleaves', 'cleveland']],
      ['japan', ['fubuki', 'mogami']],
      ['germany', ['admiral-hipper', 'type-viic']],
      ['uk', ['flower-corvette']],
      ['designs', []],
    ]);
  });

  test('unlocked ships join their nation; a previewed locked ship keeps her place, marked locked', () => {
    const profile = { ...emptyProfile(), unlocked: ['fletcher'] };
    const groups = portFleet(snapshot(profile), [], 'iowa');
    expect(ids(groups)[0]).toEqual(['usa', ['gleaves', 'fletcher', 'cleveland', 'iowa']]);
    const iowa = groups[0].entries.find((entry) => entry.shipId === 'iowa')!;
    expect(iowa.kind === 'preset' && iowa.locked).toBe(true);
    expect(groups[0].entries.filter((entry) => entry.kind === 'preset' && entry.locked)).toHaveLength(1);
  });

  test('until progress loads, or when it cannot, every tree ship stays in the fleet', () => {
    for (const status of ['loading', 'unavailable'] as const)
      expect(portFleet(snapshot(emptyProfile(), status), []).flatMap((group) => group.entries)).toHaveLength(modelledNodes().length);
  });
});

describe('the berth the port opens on', () => {
  test('the harbor loads the tree ship last berthed here, else the starter', () => {
    expect(openingPreset({ kind: 'preset', presetId: 'iowa' })).toBe('iowa');
    expect(openingPreset({ kind: 'preset', presetId: 'valiant' })).toBe(STARTER_BERTH);
    expect(openingPreset({ kind: 'design', sourceId: 'a' })).toBe(STARTER_BERTH);
    expect(openingPreset(undefined)).toBe(STARTER_BERTH);
  });

  test('a ship that is not the player’s gives way to the remembered berth, else the starter, never a locked ship', () => {
    const entries = portFleet(snapshot(emptyProfile()), [design('a', 'Baltimore design')], 'iowa').flatMap((group) => group.entries);
    expect(fallbackBerth(entries, { kind: 'design', sourceId: 'a' })?.shipId).toBe('local-a');
    expect(fallbackBerth(entries, { kind: 'preset', presetId: 'mogami' })?.shipId).toBe('mogami');
    expect(fallbackBerth(entries, { kind: 'preset', presetId: 'iowa' })?.shipId).toBe('cleveland');
    expect(fallbackBerth(entries, undefined)?.shipId).toBe('cleveland');
  });
});
