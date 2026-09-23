import source from '../../assets/maps/battle-conditions.v1.json';
import type { OceanMap } from './catalog';

const samples = source.seaCalibration.samples;
/** Representative wind sea, not a forecast: no fetch, duration or remote swell.
 * Heights and wavelengths are metres; the ocean renders the significant height directly. */
export function windSea(map: OceanMap, speed: number) {
  const windSpeed = Math.max(0, Math.min(30, speed));
  const upper = samples.findIndex(sample => sample.windSpeed >= windSpeed);
  const a = samples[Math.max(0, upper - 1)], b = samples[upper];
  const t = upper === 0 ? 0 : (windSpeed - a.windSpeed) / (b.windSpeed - a.windSpeed);
  const mix = (x: number, y: number) => x + (y - x) * t;
  return {
    windSpeed,
    significantHeightM: mix(a.significantHeightM, b.significantHeightM) * map.water.amplitudeScale,
    peakWavelength: mix(a.peakWavelengthM, b.peakWavelengthM) * map.water.wavelengthScale,
    choppiness: .65 + .9 * Math.max(0, Math.min(1, (windSpeed - 3) / 12)),
    crestFoam: mix(a.crestFoam, b.crestFoam),
    windwardFoam: mix(a.windwardFoam, b.windwardFoam),
  };
}
