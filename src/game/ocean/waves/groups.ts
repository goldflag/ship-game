/** Breaking groups: where on the sea each cascade's breakers break. A cascade's tile repeats every few hundred metres,
 * and so does everything drawn from it: with every breaker shown, a zoomed-out view held the same arrangement of
 * whitecaps in every tile, a lattice across the sea. Real breaking comes in groups (a wave group's highest crests
 * break as they pass through it, and the groups run downwind at the group velocity) and differs from place to place, so
 * a field of groups laid on the world, never repeating, decides which of a tile's breakers show where: each copy of the
 * tile shows a different few. The field is read where and when a patch of foam was born, so a whitecap keeps its group
 * for life instead of fading as the groups move on. Its age needs no storage: the wave field's bubbles decay faster
 * than its foam from the same injection, so their ratio is the time since the crest broke.
 *
 * The groups are the world's value noise (`noise.ts`) in cells a few breaking wavelengths long along the wind and wider
 * across it, drifting downwind at the breaking waves' group velocity. */
import type { Node } from 'three/webgpu';
import { smoothstep, vec2 } from 'three/tsl';
import { noise } from '../noise';
import { GRAVITY } from './spectrum';

type Float = Node<'float'>;

/** The least share of the sea the groups cover, the most, and the most of a group whitecaps may fill. Each copy of a
 * tile shows about the groups' share of its breakers, so the lattice's contrast falls to about that share; but whitecaps
 * crowded into groups overlap and turn them into white blobs, so as the wind whitens the sea the groups widen to keep
 * the whitecaps they hold below GROUP_FILL of them. A storm's dense whitecaps hide a lattice by themselves. */
const GROUP_LEAST = .35, GROUP_MOST_SHARE = .8, GROUP_FILL = .3;
/** Half-width of a group's soft edge, in the noise's own units (it spans 0–1, standard deviation 0.214). */
const GROUP_EDGE = .06;
/** The noise's quantiles: the level it passes over a share 0, 0.05, … 1 of the sea (Monte Carlo, 2·10⁷ samples). */
const QUANTILES = [.9999, .8520, .7904, .7422, .7006, .6629, .6279, .5946, .5624, .5310, .5000, .4689, .4375, .4054, .3720, .3369,
  .2994, .2577, .2094, .1479, .0002];
/** A group's cell along the wind and across it, in breaking wavelengths, and the most of a tile either may span: a tile
 * one tile apart must read cells two or more away, which share no corner, so its copies break independently. */
const GROUP_LENGTH = 2.5, GROUP_WIDTH = 4, GROUP_MOST = .3;
/** How long, relative to its foam's own lifetime, a patch can be read as old: past it, its foam is gone. */
const OLDEST = 6;

/** The share of the sea the groups cover when whitecaps cover `area` of it. */
export function groupShare(area: number): number {
  return Math.min(GROUP_MOST_SHARE, Math.max(GROUP_LEAST, (area || 0) / GROUP_FILL));
}

/** The noise level a group's edge lies at for groups covering `share` of the sea: all of it at 1. */
export function groupCut(share: number): number {
  if (!(share < 1)) return -GROUP_EDGE;
  const at = Math.max(0, share) * (QUANTILES.length - 1), i = Math.floor(at);
  return QUANTILES[i] + (QUANTILES[i + 1] - QUANTILES[i]) * (at - i);
}

/** A cascade's groups: cells (m) along and across the wind, and how fast they drift downwind (m/s), for breaking waves
 * of `period` (s) in a tile `tile` metres wide. */
export function groupLayout(period: number, tile: number): { length: number; width: number; drift: number } {
  const wavelength = GRAVITY * period * period / (2 * Math.PI), most = GROUP_MOST * tile;
  if (!(wavelength > 0)) return { length: most, width: most, drift: 0 };
  return { length: Math.min(most, GROUP_LENGTH * wavelength), width: Math.min(most, GROUP_WIDTH * wavelength), drift: GRAVITY * period / (4 * Math.PI) };
}

/** How much of the foam groups with their edge at `cut` show at noise level `level`, 0–1. */
export function groupShownAt(level: number, cut: number): number {
  const t = Math.min(1, Math.max(0, (level - cut + GROUP_EDGE) / (2 * GROUP_EDGE)));
  return t * t * (3 - 2 * t);
}

/** The wave field's per-cascade inputs to its groups. */
export interface GroupInputs {
  /** Unit vector the wind blows toward. */
  wind: Node<'vec2'>;
  /** The wave field's clock (s). */
  clock: Float;
  /** The noise level of the groups' edge (`groupCut`). */
  cut: Float;
  /** 1 / the cell's length along the wind and 1 / its width across it (1/m). */
  cells: Node<'vec2'>;
  /** Downwind drift (m/s). */
  drift: Float;
  /** Seconds of age per unit of −ln(bubbles / foam). */
  age: Float;
}

/** How much of a cascade's foam (`foam` and `bubbles`, from one read) at grid point `xz` its groups show, 0–1: the
 * groups where the patch was born, `age` seconds ago. */
export function breakingGroup(xz: Node<'vec2'>, foam: Float, bubbles: Float, inputs: GroupInputs, seed: number): Float {
  const { wind, clock, cut, cells, drift, age } = inputs;
  const fresh = bubbles.div(foam.max(1e-5)).clamp(Math.exp(-OLDEST), 1);
  const born = clock.add(fresh.log().mul(age));
  const along = xz.dot(wind).sub(born.mul(drift)), across = xz.dot(vec2(wind.y.negate(), wind.x));
  return smoothstep(cut.sub(GROUP_EDGE), cut.add(GROUP_EDGE), noise(vec2(along, across).mul(cells), seed));
}
