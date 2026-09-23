import { oceanMap, type OceanMapId } from '../../maps/catalog';
import { windSea } from '../../maps/seaCalibration';

/** Where the game's ocean parameters mean something else to Water Pro, the values the game sent the library
 * before it was replaced. Nothing here reads the library; `WaterProOcean` applies these to it. */

const MAPS: readonly OceanMapId[] = ['north-atlantic', 'pacific-islands', 'arctic-passage', 'indian-volcanic-coast'];
/** The retired sea calibration (assets/maps/battle-conditions.v1.json at 219ac9e1a, renderer "Water Pro 3.5.1; seed 1;
 * gamma 2.6; spectral sharpness 0.8; High"): per sample wind (m/s), the significant height (m) before a map's amplitude
 * scale, then the FFT amplitude gain the game measured to render each map's height, in `MAPS` order. */
const SAMPLES: readonly (readonly [windSpeed: number, significantHeight: number, ...gains: number[]])[] = [
  [0, 0, 0, 0, 0, 0],
  [1, .05, .29148864, .22002284, .20300851, .26660523],
  [2, .1, .42636255, .32271877, .29736253, .39217551],
  [3, .15, .40911611, .30090704, .28945637, .39263006],
  [4, .4, .81075512, .6380829, .58172591, .785452],
  [5, .6, .93131302, .74900941, .69141925, .90209195],
  [6, .9, 1.11128202, .9024246, .83934197, 1.07312951],
  [7, 1.2, 1.21015431, .99599095, .9267514, 1.17274109],
  [9, 1.8, 1.31107611, 1.07365788, 1.01263973, 1.27286961],
  [12, 2.7, 1.41064147, 1.10985063, 1.04370709, 1.34355382],
  [15, 4, 1.634888, 1.26563088, 1.17095463, 1.52815658],
  [18, 5.5, 1.94311233, 1.48623689, 1.36359068, 1.79415519],
  [21, 7, 2.38448052, 1.80660664, 1.65649717, 2.18286068],
  [25, 8.8, 2.801379, 2.1098821, 1.92631635, 2.54693344],
  [30, 11.3, 2.80003316, 2.20895935, 1.97040204, 2.62485206],
];

/** Water Pro's `waves.amplitude` for the game's metric sea. The library's amplitude is a gain on its own spectrum,
 * not metres, so the game measured one per map and wind; interpolated by wind as the retired `windSea()` did. The
 * map is the one whose calibrated height at this wind is the requested one (each map scales the same wind sea by
 * its own amplitude); a height off the calibration scales that map's gain in proportion. */
export function waterProAmplitude(significantHeight: number, windSpeed: number): number {
  const wind = Math.max(0, Math.min(30, windSpeed));
  const upper = SAMPLES.findIndex(sample => sample[0] >= wind);
  const a = SAMPLES[Math.max(0, upper - 1)], b = SAMPLES[upper];
  const t = upper === 0 ? 0 : (wind - a[0]) / (b[0] - a[0]);
  const mix = (index: number) => a[index] + (b[index] - a[index]) * t;
  const base = mix(1);
  if (!(significantHeight > 0) || !(base > 0)) return 0;
  let best = 0, bestError = Infinity;
  MAPS.forEach((id, i) => {
    const error = Math.abs(Math.log(significantHeight / (base * oceanMap(id).water.amplitudeScale)));
    if (error < bestError) { bestError = error; best = i; }
  });
  return mix(2 + best) * significantHeight / (base * oceanMap(MAPS[best]).water.amplitudeScale);
}

/** Water Pro's wind-drawn surface foam as the game set it: none below 3 m/s, 8% by 15 m/s, over 18% of the sea. The
 * game's own `foam.surface` values are tuned for its equalised foam texture, where coverage is an exact share. */
export function waterProSurfaceFoam(windSpeed: number): { opacity: number; coverage: number } {
  return { opacity: .08 * Math.max(0, Math.min(1, (windSpeed - 3) / 12)), coverage: .18 };
}

/** Water Pro's crest foam as the game set it: the calibration table's crest and windward gains at the wind, a 2.8 s
 * decay and 0.8 opacity, scaled by the map's foam value (which the game's own whitecaps take as `coverageScale`).
 * The game's whitecaps place themselves from their spectrum's statistics instead of fixed gains. */
export function waterProCrestFoam(windSpeed: number, coverageScale: number): { crestStrength: number; windwardStrength: number; decayTime: number; opacity: number } {
  const { crestFoam, windwardFoam } = windSea(oceanMap('north-atlantic'), windSpeed);
  return { crestStrength: crestFoam, windwardStrength: windwardFoam, decayTime: 2.8, opacity: .8 * coverageScale };
}

/** The game's wake field measures breaking slope over a 12 m baseline and starts foam at 0.015; Water Pro's solver
 * measures it over its own cells, where the game used 0.09. The adapter scales the game's threshold by this. */
export const WATER_PRO_BREAK_SCALE = .09 / .015;
