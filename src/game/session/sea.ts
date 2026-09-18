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