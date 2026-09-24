import { oceanMap, type OceanMapId } from '../../maps/catalog';
import { battleEnvironment, type WeatherId } from '../../maps/conditions';
import type { SeaState } from './seaSurface';

export * from './seaSurface';
/** Deterministic long-wave envelope. GPU detail never supplies combat samples.
 * Omitted weather keeps renderer-free fixtures in still water; the battle setup
 * explicitly passes its chosen weather, including Map default. */
export function createSeaState(mapId: OceanMapId, weather: WeatherId | undefined, seed: number, windSpeed?: number): SeaState {
  const map = oceanMap(mapId), waves = battleEnvironment(map, 'map', weather ?? 'clear', { windSpeed }).waves;
  return { amplitudeM: weather === undefined && windSpeed === undefined ? 0 : waves.significantHeightM / (4 * Math.sqrt((.7 ** 2 + .3 ** 2) / 2)),
    wavelengthM: waves.peakWavelength * 4, direction: map.water.windDirection * Math.PI / 180,
    windMps: weather === undefined && windSpeed === undefined ? 0 : waves.windSpeed, phase: seed / 0xffffffff * Math.PI * 2 };
}
