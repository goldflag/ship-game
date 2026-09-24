import source from '../../assets/maps/battle-conditions.v1.json';
import type { OceanMap } from './catalog';
import { windSea } from './seaCalibration';

export type TimeOfDayId = 'map' | 'dawn' | 'morning' | 'noon' | 'dusk' | 'night';
export type WeatherId = 'map' | 'clear' | 'partly-cloudy' | 'overcast' | 'fog' | 'storm-clouds';
interface TimePreset {
  id: TimeOfDayId; name: string; description: string;
  sky: Partial<OceanMap['sky']>; lightScale: number; fogColor?: string;
}
interface WeatherPreset {
  id: WeatherId; name: string; description: string;
  sky: Partial<OceanMap['sky']>; fog: Partial<OceanMap['fog']>;
  sunScale: number; ambientScale: number; cloudWind: number;
  waves: { windSpeed: number };
}
export const TIME_OF_DAY_PRESETS = source.times as TimePreset[];
export const WEATHER_PRESETS = source.weather as WeatherPreset[];
export const isTimeOfDayId = (id: unknown): id is TimeOfDayId => TIME_OF_DAY_PRESETS.some(preset => preset.id === id);
export const isWeatherId = (id: unknown): id is WeatherId => WEATHER_PRESETS.some(preset => preset.id === id);

export interface BattleConditions { timeHours?: number; cloudCover?: number; windSpeed?: number; }
export const formatBattleTime = (hours: number) => {
  const minutes = Math.round(hours * 60) % 1440;
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
};

const smooth = (value: number, start: number, end: number) => {
  const t = Math.max(0, Math.min(1, (value - start) / (end - start)));
  return t * t * (3 - 2 * t);
};
// Interpolate authored display-color swatches without importing a renderer into maps.
const blendFog = (from: string, to: string, weight: number) => {
  const a = parseInt(from.slice(1), 16), b = parseInt(to.slice(1), 16);
  return '#' + [16, 8, 0].map(shift => Math.round(((a >> shift) & 255) * (1 - weight)
    + ((b >> shift) & 255) * weight).toString(16).padStart(2, '0')).join('');
};

/** Resolve shared wind/sea conditions alongside visual sky and fog. Map, preset and clock sun azimuths are true
 * directions in the sky's convention (azimuth 180 − B for a compass bearing B); the result is in the map's chart
 * frame, turned by its bearing, so the sun stands where it would over the real place. Wind stays in the chart frame. */
export function battleEnvironment(map: OceanMap, timeOfDay: TimeOfDayId = 'map', weather: WeatherId = 'map', conditions: BattleConditions = {}) {
  const time = TIME_OF_DAY_PRESETS.find(preset => preset.id === timeOfDay);
  const forecast = WEATHER_PRESETS.find(preset => preset.id === weather);
  if (!time) throw new Error('Choose an available time of day.');
  if (!forecast) throw new Error('Choose an available weather preset.');
  const sky = { ...map.sky, ...forecast.sky, ...time.sky };
  sky.intensity *= forecast.sunScale;
  sky.ambient *= time.lightScale * forecast.ambientScale;
  const fog = { ...map.fog, ...forecast.fog };
  if (time.fogColor) fog.color = time.fogColor;
  if (conditions.timeHours !== undefined) {
    const hour = conditions.timeHours;
    sky.elevation = 70 * Math.sin((hour - 6) * Math.PI / 12);
    sky.azimuth = (hour * 15) % 360;
    const nightFog = TIME_OF_DAY_PRESETS.find(preset => preset.id === 'night')!.fogColor!;
    const dawnFog = TIME_OF_DAY_PRESETS.find(preset => preset.id === 'dawn')!.fogColor!;
    const duskFog = TIME_OF_DAY_PRESETS.find(preset => preset.id === 'dusk')!.fogColor!;
    const twilightFog = hour <= 12 ? dawnFog : duskFog;
    fog.color = sky.elevation < 5 ? blendFog(nightFog, twilightFog, smooth(sky.elevation, -6, 5))
      : blendFog(twilightFog, fog.color, smooth(sky.elevation, 5, 18));
  }
  // The chart's top bears `map.bearing`: a true direction lies that much further round in the chart frame.
  sky.azimuth = (((sky.azimuth + map.bearing) % 360) + 360) % 360;
  const daylight = smooth(sky.elevation, -6, 18);
  // Retain enough diffuse fill to read a hull at night; direct light and the
  // sky still supply the much stronger day/night contrast.
  if (conditions.timeHours !== undefined || timeOfDay !== 'map')
    sky.ambient = map.sky.ambient * forecast.ambientScale * (0.5 + 0.5 * daylight);
  if (conditions.cloudCover !== undefined) {
    sky.coverage = conditions.cloudCover / 100;
  }
  const wind = conditions.windSpeed;
  // Explicit wind bypasses the map wind multiplier. Presets and numeric wind
  // then use the same metric height curve.
  const waves = windSea(map, wind ?? forecast.waves.windSpeed * map.water.windScale);
  return { sky, fog, cloudWind: wind === undefined ? forecast.cloudWind : wind * 4 / 3,
    waves,
    waterLightScale: 0.24 + 0.76 * daylight,
    // Sky Pro already scales the incident radiance by the sun's current light.
    // Scaling this gain again crushed cloud undersides at sunrise.
    cloudAmbient: 1.1 * forecast.ambientScale,
    cloudShadow: weather === 'storm-clouds' ? 0.55 : 0.2,
    horizonCoverage: conditions.cloudCover !== undefined ? 0.06 * conditions.cloudCover / 100 : weather === 'clear' ? 0 : 0.06 };
}
