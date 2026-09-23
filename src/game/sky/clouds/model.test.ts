import { describe, expect, test } from 'bun:test';
import { SKY_TIERS } from '../quality';
import { cirrusAmount } from './cirrus';
import {
  CLEAR_RANGE, clearDistance, clearThreshold, cloudTop, cloudType, heightProfile, liftedCoverage, localCover, numbers as m, TYPE, weatherChannels,
  weatherMap, WEATHER_SIZE,
} from './model';
import { rainShare } from './rain';

const channels = weatherChannels();
const potential = channels[0];

/** Share of the weather map a coverage leaves some cloud in, and its mean cover. */
function covered(coverage: number) {
  let any = 0, sum = 0;
  for (const p of potential) { const cover = localCover(m, p, coverage); sum += cover; if (cover > .01) any++; }
  return { any: any / potential.length, mean: sum / potential.length };
}

describe('weather map', () => {
  test('potentials are rank-equalised, so a coverage leaves that share of the map with cloud', () => {
    for (const coverage of [.1, .25, .4, .65, .82, .95]) {
      const { any } = covered(coverage);
      expect(any).toBeGreaterThan(coverage - .02);
      expect(any).toBeLessThan(coverage + .1);
    }
  });

  test('coverage reads as the brief asks: scattered, broken, closing, a deck', () => {
    expect(covered(.02).mean).toBeLessThan(.01);
    expect(covered(.25).mean).toBeGreaterThan(.1);
    expect(covered(.25).mean).toBeLessThan(.25);
    expect(covered(.4).mean).toBeGreaterThan(.25);
    expect(covered(.8).mean).toBeGreaterThan(.7);
    // A storm sky swells past full cover, which fills the shape noise's hollows into a deck.
    expect(covered(.95).mean).toBeGreaterThan(1);
  });

  test('distant clouds bank up toward the horizon by the scene\'s lift', () => {
    expect(liftedCoverage(m, .4, .06, 0)).toBeCloseTo(.4, 6);
    expect(liftedCoverage(m, .4, .06, 60_000)).toBeCloseTo(.46, 6);
    expect(liftedCoverage(m, .98, .06, 60_000)).toBe(1);
  });

  test('clear-air distances are zero where cloud can form and never overstate the gap', () => {
    const threshold = clearThreshold(.4, .06), clear = clearDistance(potential, threshold);
    for (let k = 0; k < potential.length; k += 97) {
      if (potential[k] >= threshold) expect(clear[k]).toBe(0);
      else {
        expect(clear[k]).toBeGreaterThan(0);
        // No texel with cloud lies closer than the distance promises (checked on a neighbourhood).
        const x = k % WEATHER_SIZE, y = Math.floor(k / WEATHER_SIZE), reach = Math.min(Math.floor(clear[k]), 6);
        for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) {
          if (Math.hypot(dx, dy) >= clear[k]) continue;
          const j = ((y + dy + WEATHER_SIZE) % WEATHER_SIZE) * WEATHER_SIZE + ((x + dx + WEATHER_SIZE) % WEATHER_SIZE);
          expect(potential[j]).toBeLessThan(threshold);
        }
      }
    }
    // A cloudless scene is clear everywhere, out to the range the alpha channel holds.
    expect(Math.min(...clearDistance(potential, clearThreshold(0, 0)).slice(0, 500))).toBeGreaterThan(0);
    expect(Math.max(...clearDistance(potential, 2))).toBe(CLEAR_RANGE);
  });

  test('the packed map carries every channel in bytes', () => {
    const bytes = weatherMap(channels, clearDistance(potential, clearThreshold(.4, .06)));
    expect(bytes.length).toBe(WEATHER_SIZE * WEATHER_SIZE * 4);
    expect(Math.max(...bytes.filter((_, i) => i % 4 === 0))).toBe(255);
  });
});

describe('cloud types and height profiles', () => {
  test('fair weather builds cumulus, a closing sky flattens them, a storm deck towers in its cells', () => {
    expect(cloudType(m, .3, .5, 0, .5)).toBeCloseTo(TYPE.cumulus, 6);
    expect(cloudType(m, .85, .5, 0, .5)).toBeLessThan(TYPE.cumulus);
    expect(cloudType(m, .95, .5, 0, .5)).toBeCloseTo(TYPE.nimbostratus, 1);
    expect(cloudType(m, .95, .5, 1, .5)).toBeCloseTo(TYPE.cumulonimbus, 1);
    // Only a storm deck has cells: the same storm potential under a fair sky stays cumulus.
    expect(cloudType(m, .4, .5, 1, .5)).toBeCloseTo(TYPE.cumulus, 6);
    // Near the top a cell spreads into its anvil: a marginal cell is cumulonimbus higher up.
    expect(cloudType(m, .95, .5, .7, .95)).toBeGreaterThan(cloudType(m, .95, .5, .7, .3));
  });

  test('profiles are zero outside the layer and below the type\'s top, with flat bases', () => {
    for (const type of [0, .3, .52, .72, 1]) {
      expect(heightProfile(m, 0, type)).toBe(0);
      expect(heightProfile(m, cloudTop(m, type) + .01, type)).toBe(0);
      expect(heightProfile(m, .08, type)).toBeGreaterThan(.9);
    }
    expect(cloudTop(m, TYPE.stratus)).toBeLessThan(.2);
    expect(cloudTop(m, TYPE.cumulonimbus)).toBe(1);
  });

  test('a cumulus narrows upward while a cumulonimbus holds its width to the anvil', () => {
    const at = (type: number, share: number) => heightProfile(m, cloudTop(m, type) * share, type);
    expect(at(TYPE.cumulus, .6)).toBeLessThan(.8);
    expect(at(TYPE.cumulonimbus, .6)).toBeGreaterThan(.99);
    expect(at(TYPE.cumulonimbus, .9)).toBeGreaterThan(at(TYPE.cumulus, .9));
  });
});

describe('rain and cirrus', () => {
  test('rain falls only from storm cells under cloud, more of them as precipitation grows', () => {
    const share = (precipitation: number, coverage = .95) => {
      let sum = 0;
      for (let k = 0; k < potential.length; k++) sum += rainShare(m, potential[k], channels[2][k], coverage, precipitation);
      return sum / potential.length;
    };
    expect(share(0)).toBe(0);
    expect(share(.15)).toBeGreaterThan(0);
    expect(share(.9)).toBeGreaterThan(share(.15) * 3);
    expect(share(.9)).toBeLessThan(.45);
    // A clear sky cannot rain however wet the scene.
    expect(share(.9, .05)).toBeLessThan(.005);
  });

  test('cirrus grows with coverage and turns up on some clear days only', () => {
    const clearDays = Array.from({ length: 40 }, (_, day) => cirrusAmount(.05, day * 17.3));
    expect(clearDays.filter(a => a > .4).length).toBeGreaterThan(8);
    expect(clearDays.filter(a => a < .1).length).toBeGreaterThan(8);
    expect(cirrusAmount(.8, 3)).toBeGreaterThan(cirrusAmount(.2, 3) - .001);
    for (const amount of clearDays) { expect(amount).toBeGreaterThanOrEqual(0); expect(amount).toBeLessThanOrEqual(1); }
    // The same scene always draws the same cirrus.
    expect(cirrusAmount(.3, 123.4)).toBe(cirrusAmount(.3, 123.4));
  });
});

describe('tiers', () => {
  const tiers = [SKY_TIERS.low, SKY_TIERS.medium, SKY_TIERS.high, SKY_TIERS.ultra];
  /** Rays marched per frame, averaged over the update interval, for a 1600 × 900 drawing buffer. */
  const rays = (t: typeof tiers[number]) => 1600 * 900 / (t.cloudScale * t.cloudScale) / (t.cloudInterleave * t.cloudInterleave) / t.cloudUpdateInterval;

  test('each tier marches at least as much as the one below it', () => {
    for (let i = 1; i < tiers.length; i++) {
      expect(rays(tiers[i])).toBeGreaterThanOrEqual(rays(tiers[i - 1]));
      expect(tiers[i].cloudSteps).toBeGreaterThanOrEqual(tiers[i - 1].cloudSteps);
      expect(tiers[i].cloudLightSteps).toBeGreaterThanOrEqual(tiers[i - 1].cloudLightSteps);
      expect(tiers[i].cloudShadowSize).toBeGreaterThanOrEqual(tiers[i - 1].cloudShadowSize);
    }
  });

  test('interleave blocks and intervals are ones the reconstruction supports', () => {
    for (const tier of tiers) {
      expect([1, 2, 4]).toContain(tier.cloudInterleave);
      expect(tier.cloudUpdateInterval).toBeGreaterThanOrEqual(1);
      // Every pixel is marched again within about a second (64 frames).
      expect(tier.cloudInterleave ** 2 * tier.cloudUpdateInterval).toBeLessThanOrEqual(64);
    }
  });
});
