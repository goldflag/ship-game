import { expect, test } from 'bun:test';
import { airClusters, battleComparison, markerOpacity, observedAircraftType } from './fleetStats';
import type { ContactTrack } from '../multiplayer/generated/ContactTrack';

const track = (over: Partial<ContactTrack>): ContactTrack => ({ id: 'c', kind: 'surface', affiliation: 'hostile', status: 'tracked', firstObservedTick: 0, lastObservedTick: 100, measuredPosition: over.estimatedPosition ?? [0, 0, 0], estimatedPosition: [0, 0, 0], velocity: [0, 0, 0], uncertaintyM: 20, identificationConfidence: 1, classification: null, identifiedPresetId: null, sources: [], ...over });

test('reported aircraft flying together become one typed group and keep their markers', () => {
  const tracks = [
    track({ id: 'a1', kind: 'aircraft', classification: 'Fighter', estimatedPosition: [0, 800, 0], velocity: [0, 0, -100] }),
    track({ id: 'a2', kind: 'aircraft', classification: 'Fighter', estimatedPosition: [300, 800, 200], velocity: [0, 0, -100], visibleCondition: { observedTick: 90, fire: false, heavySmoke: true, listing: false, sinking: false } }),
    track({ id: 'a3', kind: 'aircraft', classification: 'Torpedo bomber', estimatedPosition: [350, 600, 100], velocity: [100, 0, 0] }),
    track({ id: 'a4', kind: 'aircraft', classification: 'Fighter', estimatedPosition: [5000, 800, 0], velocity: [0, 0, 100], status: 'stale' }),
    track({ id: 's1', estimatedPosition: [100, 0, 100] }),
  ];
  const clusters = airClusters(tracks, 100);
  expect(clusters.map(c => [c.label, c.trackIds.sort(), c.smoking, c.stale])).toEqual([
    ['2 fighters', ['a1', 'a2'], 1, false], ['1 torpedo bomber', ['a3'], 0, false], ['1 fighter', ['a4'], 0, true],
  ]);
  expect(clusters[0].heading).toBeCloseTo(0);
  expect(clusters[1].heading).toBeCloseTo(Math.PI / 2);
  expect(observedAircraftType('Aircraft')).toBe('unknown');
  expect(observedAircraftType('Dive bomber')).toBe('dive-bomber');
});

test('the battle comparison keeps our column exact and builds theirs from reports only', () => {
  const comparison = battleComparison({
    own: [{ id: 'bb', massKg: 43_978_000, integrity: 49_228, maxIntegrity: 50_750, lost: false }, { id: 'dd', massKg: 2_924_000, integrity: 0, maxIntegrity: 2_400, lost: true }],
    scores: { bb: { damageDealt: 12_400.4, frags: 1 } },
    tracks: [
      track({ id: 'e1', identifiedPresetId: 'bismarck' }),
      track({ id: 'e2', classification: 'Large warship' }),
      track({ id: 'e3', identifiedPresetId: 'fletcher', visibleCondition: { observedTick: 50, fire: true, heavySmoke: true, listing: true, sinking: true } }),
      track({ id: 'a1', kind: 'aircraft', classification: 'Fighter' }),
      track({ id: 'a2', kind: 'aircraft', classification: 'Fighter', status: 'stale' }),
    ],
    massOf: id => id === 'bismarck' ? 43_978_000 : 2_924_000,
    ownAircraft: { remaining: 42, total: 48 },
    enemyAircraftLost: 7,
  });
  expect(comparison).toEqual({
    damageDealt: [12_400, 1_522 + 2_400],
    tonnageAfloat: [43_978_000, 43_978_000],
    unidentified: 1,
    aircraft: { own: [42, 48], enemySeen: 1, enemyLost: 7 },
    shipsLost: [1, 1],
  });
});

test('ship markers fade out as the hull grows on screen', () => {
  expect(markerOpacity(10)).toBe(1);
  expect(markerOpacity(36)).toBeCloseTo(.5);
  expect(markerOpacity(80)).toBe(0);
});
