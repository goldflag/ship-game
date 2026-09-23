import { oceanMap, type OceanMapId } from '../../maps/catalog';
import { battleEnvironment, type WeatherId } from '../../maps/conditions';

export interface SeaState { amplitudeM: number; wavelengthM: number; direction: number; windMps: number; phase: number; }
/** Deterministic long-wave envelope. GPU detail never supplies combat samples.
 * Omitted weather keeps renderer-free fixtures in still water; the battle setup
 * explicitly passes its chosen weather, including Map default. */
export function createSeaState(mapId: OceanMapId, weather: WeatherId | undefined, seed: number, windSpeed?: number): SeaState {
  const map = oceanMap(mapId), waves = battleEnvironment(map, 'map', weather ?? 'clear', { windSpeed }).waves;
  return { amplitudeM: weather === undefined && windSpeed === undefined ? 0 : waves.significantHeightM / (4 * Math.sqrt((.7 ** 2 + .3 ** 2) / 2)),
    wavelengthM: waves.peakWavelength * 4, direction: map.water.windDirection * Math.PI / 180,
    windMps: weather === undefined && windSpeed === undefined ? 0 : waves.windSpeed, phase: seed / 0xffffffff * Math.PI * 2 };
}
export function seaHeight(sea: SeaState, x: number, z: number, time: number): number {
  if (sea.amplitudeM === 0) return 0;
  const sample = (direction: number, wavelength: number, phase: number) => {
    const k = 2 * Math.PI / wavelength;
    return Math.sin(k * (x * Math.cos(direction) + z * Math.sin(direction)) - Math.sqrt(9.81 * k) * time + phase);
  };
  return sea.amplitudeM * (.7 * sample(sea.direction, sea.wavelengthM, sea.phase) + .3 * sample(sea.direction + .8, sea.wavelengthM * .57, sea.phase + 2));
}
/** The sea's components, the Rust authority's `SeaState::waves`: a·sin(k·(x cos θ + z sin θ) − √(g·k)·t + φ) each,
 * k = 2π/wavelength, summing to `seaHeight` (the ocean draws them around the hulls that ride them). */
export function seaWaves(sea: SeaState): { amplitude: number; wavelength: number; direction: number; phase: number }[] {
  return [{ amplitude: sea.amplitudeM * .7, wavelength: sea.wavelengthM, direction: sea.direction, phase: sea.phase },
    { amplitude: sea.amplitudeM * .3, wavelength: sea.wavelengthM * .57, direction: sea.direction + .8, phase: sea.phase + 2 }];
}
export interface SeaResponse { heave: number; roll: number; pitch: number; }
/** The Rust authority's `SeaState::response` for a surfaced hull at rest, sample
 * for sample: mean height under the waterplane and the wave slope across 80% of
 * the beam and length. The berth rides this without a stepped session. */
export function seaResponse(sea: SeaState, hull: { length: number; beam: number }, pose: { x: number; z: number; heading: number }, time: number): SeaResponse {
  const cos = Math.cos(pose.heading), sin = Math.sin(pose.heading);
  const at = (x: number, z: number) => seaHeight(sea, pose.x + cos * x - sin * z, pose.z + sin * x + cos * z, time);
  let heave = 0;
  for (const z of [-.4, -.2, 0, .2, .4]) for (const x of [-.3, .3]) heave += at(x * hull.beam, z * hull.length) / 10;
  const clamp = (value: number, limit: number) => Math.max(-limit, Math.min(limit, value));
  return { heave,
    roll: clamp((at(hull.beam * .4, 0) - at(-hull.beam * .4, 0)) / (hull.beam * .8), .18),
    pitch: clamp((at(0, -hull.length * .4) - at(0, hull.length * .4)) / (hull.length * .8), .08) };
}
