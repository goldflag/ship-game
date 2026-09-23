import type { BattleConditions, WeatherId } from './conditions';

/** Rain (0–1) and lightning strikes per minute each weather brings. Visual only: combat, sensors and the
 * simulation content never read them. Kept out of `conditions.ts`, which the battle session's sea imports and
 * so joins the construction ships' published model fingerprints: a sky change there would stale those ships. */
const PRESETS: Readonly<Record<WeatherId, BattlePrecipitation>> = {
  map: { precipitation: 0, lightning: 0 }, clear: { precipitation: 0, lightning: 0 }, 'partly-cloudy': { precipitation: 0, lightning: 0 },
  overcast: { precipitation: .15, lightning: 0 }, fog: { precipitation: 0, lightning: 0 }, 'storm-clouds': { precipitation: .9, lightning: 3 },
};

export interface BattlePrecipitation { precipitation: number; lightning: number }

const smooth = (value: number, start: number, end: number) => {
  const t = Math.max(0, Math.min(1, (value - start) / (end - start)));
  return t * t * (3 - 2 * t);
};

/** The weather's rain and lightning, or more from a custom sky near full cover: it rains steadily from a still
 * deck and in a downpour as the wind rises to a gale, and a solid deck in a storm-force wind thunders. */
export function battlePrecipitation(weather: WeatherId, conditions: BattleConditions = {}): BattlePrecipitation {
  const preset = PRESETS[weather];
  const cover = conditions.cloudCover === undefined ? 0 : conditions.cloudCover / 100, gale = conditions.windSpeed ?? 0;
  return {
    precipitation: Math.max(preset.precipitation, smooth(cover, .75, 1) * (.25 + .65 * smooth(gale, 8, 18))),
    lightning: Math.max(preset.lightning, smooth(cover, .9, 1) * smooth(gale, 14, 20) * 3),
  };
}
