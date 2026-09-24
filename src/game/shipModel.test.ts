import { expect, test } from 'bun:test';
import { shipPresets } from '../ships/presets';
import { shipIdentity } from './shipModel';

test('every roster ship has an identity, so catalogs file her under a class and nation', () => {
  // A missing entry falls back to a generic "Ship" in class Other with no nation, which hides her behind the filters.
  expect(Object.keys(shipPresets).filter((id) => shipIdentity(id).type === 'Ship')).toEqual([]);
});
