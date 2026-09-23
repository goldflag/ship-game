import { expect, test } from 'bun:test';
import { battlePrecipitation } from './precipitation';

test('storms rain and thunder; fair weather stays dry', () => {
  expect(battlePrecipitation('storm-clouds')).toEqual({ precipitation: .9, lightning: 3 });
  expect(battlePrecipitation('overcast')).toEqual({ precipitation: .15, lightning: 0 });
  expect(battlePrecipitation('clear', { cloudCover: 40, windSpeed: 20 })).toEqual({ precipitation: 0, lightning: 0 });
});

test('a custom sky near full cover rains harder and thunders as the wind rises', () => {
  const still = battlePrecipitation('map', { cloudCover: 100, windSpeed: 0 });
  const gale = battlePrecipitation('map', { cloudCover: 100, windSpeed: 20 });
  expect(still.precipitation).toBeCloseTo(.25);
  expect(still.lightning).toBe(0);
  expect(gale.precipitation).toBeCloseTo(.9);
  expect(gale.lightning).toBeCloseTo(3);
  // A preset never rains less for a custom sky.
  expect(battlePrecipitation('storm-clouds', { cloudCover: 80, windSpeed: 4 }).precipitation).toBe(.9);
});
