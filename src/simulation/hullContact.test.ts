import { expect, test } from 'bun:test';
import type { Hull, Vec3 } from '../ships/blueprint';
import { hullContacts } from './hullContact';

const hull: Hull = { kind: 'authored-stations-v1', length: 100, beam: 20, draft: 5, depth: 10,
  massKg: 1e6, waterplaneAreaM2: 2000, reserveBuoyancyM3: 10000,
  halfBreadths: [[0, 10], [100, 10]], keelHeights: [[0, -5], [100, -5]], deckHeights: [[0, 5], [100, 5]] };
const from: Vec3 = [-20, 1, 3], to: Vec3 = [20, 1, 3];

test('independently cloned hulls retain ordered entry and exit contacts', () => {
  const first = hullContacts(hull, from, to);
  expect(first.map(hit => hit.point)).toEqual([[-10, 1, 3], [10, 1, 3]]);
  expect(hullContacts(structuredClone(hull), from, to)).toEqual(first);
  expect(hullContacts(structuredClone(hull), to, from).map(hit => hit.point)).toEqual([[10, 1, 3], [-10, 1, 3]]);
});

test('derived hull meshes distinguish changed breadths, heights and authored sections', () => {
  const narrow = structuredClone(hull);
  narrow.halfBreadths = [[0, 6], [100, 6]];
  expect(hullContacts(narrow, from, to).map(hit => hit.point)).toEqual([[-6, 1, 3], [6, 1, 3]]);
  const low = structuredClone(hull);
  low.deckHeights = [[0, .5], [100, .5]];
  expect(hullContacts(low, from, to)).toEqual([]);
  const shallow = structuredClone(hull);
  shallow.keelHeights = [[0, 2], [100, 2]];
  expect(hullContacts(shallow, from, to)).toEqual([]);
  const shaped = structuredClone(hull);
  shaped.sections = [0, 100].map(station => ({ station, points: [[0, -5], [10, 0], [0, 5]] }));
  expect(hullContacts(shaped, from, to).map(hit => hit.point)).toEqual([[-8, 1, 3], [8, 1, 3]]);
});
