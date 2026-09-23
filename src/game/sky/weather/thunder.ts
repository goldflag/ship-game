/** How thunder sounds from a distance, free of WebAudio so it can be tested: `GameAudio.thunder` plays it.
 *
 * A near strike opens with a sharp crack (the shock wave of the channel's nearest part, still carrying its
 * high frequencies), then rolls; a distant one arrives as a low rumble that swells slowly. The rumble lasts
 * as long as the channel's far parts keep arriving, so it lengthens with distance, and the air absorbs high
 * frequencies on the way, so it darkens. */
export interface ThunderSound {
  /** Seconds of rumble after the first arrival. */
  readonly rumble: number;
  /** Seconds the rumble takes to swell to its first peak. */
  readonly attack: number;
  /** Low-pass cutoff of the rumble (Hz). */
  readonly cutoff: number;
  /** Level of the opening crack (0 past about 3 km) and of the rumble, loudness included. */
  readonly crack: number;
  readonly level: number;
  /** Swells within the rumble: seconds after the first arrival and level relative to `level`, in time order. */
  readonly rolls: readonly { readonly time: number; readonly level: number }[];
  /** Stereo position, −1 left … 1 right. */
  readonly pan: number;
}

/** Rumble length (s) next to the strike, and the extra seconds per kilometre, up to a longest roll. */
const RUMBLE = { near: 3.5, perKm: .5, longest: 14 };
/** Rumble cutoff (Hz): far thunder keeps only this much, near thunder `CUTOFF.near` more, fading over `CUTOFF.fade` m. */
const CUTOFF = { far: 170, near: 2000, fade: 3000 };
/** Distances (m) over which the crack fades out. */
const CRACK = [800, 3000] as const;
/** Rumble level relative to the loudness, and the crack's: a strike under a kilometre off peaks about as loud as the ship's own main guns. */
const RUMBLE_LEVEL = .65, CRACK_LEVEL = .55;

export function thunderSound(distance: number, loudness: number, random: () => number): ThunderSound {
  const km = Math.max(0, distance) / 1000;
  const rumble = Math.min(RUMBLE.longest, RUMBLE.near + RUMBLE.perKm * km);
  const t = Math.max(0, Math.min(1, (distance - CRACK[0]) / (CRACK[1] - CRACK[0])));
  const count = 3 + Math.floor(random() * 4);
  const rolls = Array.from({ length: count }, () => ({ time: random() * rumble * .7, level: .35 + random() * .65 })).sort((a, b) => a.time - b.time);
  return {
    rumble, rolls,
    attack: .02 + .6 * Math.min(1, km / 15),
    cutoff: CUTOFF.far + CUTOFF.near * Math.exp(-distance / CUTOFF.fade),
    crack: CRACK_LEVEL * loudness * (1 - t * t * (3 - 2 * t)),
    level: RUMBLE_LEVEL * loudness,
    pan: (random() * 2 - 1) * .5,
  };
}
