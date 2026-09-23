import { expect, test } from 'bun:test';
import { OCEAN_TIERS } from '../quality';
import { slickShares } from './field';

test('a wake slick damps the waves shorter than about 25 m on every tier and leaves the swell', () => {
  const [high, medium, low] = (['high', 'medium', 'low'] as const).map(tier => slickShares(OCEAN_TIERS[tier].cascades));
  // The largest tile holds the swell and the spectral peak: at most its few shortest octaves are stilled.
  for (const shares of [high, medium, slickShares(OCEAN_TIERS.ultra.cascades)]) expect(shares[0]).toBeLessThan(.05);
  // Every finer band lies wholly below the cut.
  expect(high.slice(1)).toEqual([1, 1]);
  expect(medium[1]).toBe(1);
  // Low's single tile runs from the swell down to 8 m waves: only its short end is stilled.
  expect(low[0]).toBeGreaterThan(.1);
  expect(low[0]).toBeLessThan(.4);
});
