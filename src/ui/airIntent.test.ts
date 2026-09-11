import { expect, test } from 'bun:test';
import type { ContactTrack } from '../multiplayer/generated/ContactTrack';
import type { ObservedAircraft } from '../game/session/BattleSession';
import { airClusters } from './fleetStats';
import { airStrikes, inferredTarget, loadLabel, threatens } from './airIntent';

const ships = [{ id: 'bb', name: 'Bismarck', x: 0, z: 0 }, { id: 'dd', name: 'Yukikaze', x: 3000, z: 3000 }];
const track = (id: string, over: Partial<ContactTrack> = {}): ContactTrack => ({
  id, kind: 'aircraft', status: 'tracked', affiliation: 'hostile', classification: 'Torpedo bomber', identifiedPresetId: null, identificationConfidence: 1,
  estimatedPosition: [4000, 30, 0], measuredPosition: [4000, 30, 0], velocity: [-60, 0, 0], uncertaintyM: 50, firstObservedTick: 0, lastObservedTick: 100, sources: [], ...over,
});
const seen = (id: string, payload: boolean): ObservedAircraft => ({ id, modelId: 'tbd-1-devastator', position: [4000, 30, 0], heading: 0, velocity: [-60, 0, 0], observedTick: 100, observers: ['bb'], controls: {} as ObservedAircraft['controls'], wingFold: 0, payload });

test('a strike heads for the ship inside its course cone and releases short of it', () => {
  const intent = inferredTarget([4000, 30, 0], [-60, 0, 0], 'torpedo-bomber', ships);
  expect(intent?.shipId).toBe('bb');
  expect(intent?.rangeM).toBe(4000);
  // 4,000 m less the 900 m torpedo run at 60 m/s.
  expect(Math.round(intent!.releaseSeconds)).toBe(52);
  // Flying away from every ship, or loitering, names nothing; fighters never do.
  expect(inferredTarget([4000, 30, 0], [60, 0, 0], 'torpedo-bomber', ships)).toBeUndefined();
  expect(inferredTarget([4000, 30, 0], [-5, 0, 0], 'torpedo-bomber', ships)).toBeUndefined();
  expect(inferredTarget([4000, 30, 0], [-60, 0, 0], 'fighter', ships)).toBeUndefined();
});

test('the group load counts only current sightings, and a spent group draws no intent', () => {
  const tracks = [track('a'), track('b', { estimatedPosition: [4100, 30, 100], measuredPosition: [4100, 30, 100] }), track('c', { estimatedPosition: [4200, 30, -100], measuredPosition: [4200, 30, -100], lastObservedTick: 0 })];
  const [strike] = airStrikes(airClusters(tracks, 100), tracks, [seen('a', true), seen('b', false), seen('c', true)], 100, ships);
  expect(strike.carrying).toBe(1);
  expect(strike.released).toBe(1);
  // c was last seen long ago, so its slung torpedo is not a current observation.
  expect(strike.unobserved).toBe(1);
  expect(loadLabel(strike)).toBe('1 carrying · 1 released');
  expect(strike.intent?.name).toBe('Bismarck');
  expect(threatens(strike)).toBe(true);
  const spent = airStrikes(airClusters([tracks[0]], 100), [tracks[0]], [seen('a', false)], 100, ships)[0];
  expect(loadLabel(spent)).toBe('1 released');
  expect(spent.intent).toBeUndefined();
  expect(threatens(spent)).toBe(false);
  const unseen = airStrikes(airClusters([tracks[0]], 100), [tracks[0]], [], 100, ships)[0];
  expect(loadLabel(unseen)).toBe('load unobserved');
  expect(threatens(unseen)).toBe(true);
});
