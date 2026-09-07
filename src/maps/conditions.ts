import source from '../../assets/maps/battle-conditions.v1.json';
import type { OceanMap } from './catalog';

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
}
export const TIME_OF_DAY_PRESETS = source.times as TimePreset[];
export const WEATHER_PRESETS = source.weather as WeatherPreset[];
export const isTimeOfDayId = (id: unknown): id is TimeOfDayId => TIME_OF_DAY_PRESETS.some(preset => preset.id === id);
export const isWeatherId = (id: unknown): id is WeatherId => WEATHER_PRESETS.some(preset => preset.id === id);

/** Compose visual conditions without changing the map recipe or CPU combat. */
export function battleEnvironment(map: OceanMap, timeOfDay: TimeOfDayId = 'map', weather: WeatherId = 'map') {
  const time = TIME_OF_DAY_PRESETS.find(preset => preset.id === timeOfDay);
  const forecast = WEATHER_PRESETS.find(preset => preset.id === weather);
  if (!time) throw new Error('Choose an available time of day.');
  if (!forecast) throw new Error('Choose an available weather preset.');
  const sky = { ...map.sky, ...forecast.sky, ...time.sky };
  sky.intensity *= forecast.sunScale;
  sky.ambient *= time.lightScale * forecast.ambientScale;
  const fog = { ...map.fog, ...forecast.fog };
  if (time.fogColor) fog.color = time.fogColor;
  return { sky, fog, cloudWind: forecast.cloudWind,
    cloudAmbient: 1.1 * time.lightScale * forecast.ambientScale,
    cloudShadow: weather === 'storm-clouds' ? 0.55 : 0.2,
    horizonCoverage: weather === 'clear' ? 0 : 0.06 };
}
