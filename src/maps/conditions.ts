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
  waves: { amplitude: number; windSpeed: number; peakWavelength: number };
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

/** Compose visual conditions without changing the map recipe or CPU combat. */
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
  let lightScale = time.lightScale;
  if (conditions.timeHours !== undefined) {
    const hour = conditions.timeHours;
    sky.elevation = 70 * Math.sin((hour - 6) * Math.PI / 12);
    sky.azimuth = (hour * 15) % 360;
    lightScale = 0.22 + 0.78 * Math.max(0, Math.min(1, (sky.elevation + 6) / 34));
    sky.ambient *= lightScale / time.lightScale;
  }
  if (conditions.cloudCover !== undefined) {
    sky.coverage = conditions.cloudCover / 100;
  }
  const wind = conditions.windSpeed;
  // Wind owns sea energy independently of the cloud slider. Retain the authored
  // moderate-sea calibration at 9 m/s, with calm water at zero wind.
  const waves = wind === undefined ? {
    amplitude: forecast.waves.amplitude * map.water.amplitudeScale,
    windSpeed: forecast.waves.windSpeed * map.water.windScale,
    peakWavelength: forecast.waves.peakWavelength * map.water.wavelengthScale,
  } : {
    amplitude: 0.24 * (wind / 9) ** 1.2 * map.water.amplitudeScale,
    windSpeed: wind,
    peakWavelength: Math.max(4, 20 * wind / 9) * map.water.wavelengthScale,
  };
  return { sky, fog, cloudWind: wind === undefined ? forecast.cloudWind : wind * 4 / 3,
    waves,
    cloudAmbient: 1.1 * lightScale * forecast.ambientScale,
    cloudShadow: weather === 'storm-clouds' ? 0.55 : 0.2,
    horizonCoverage: conditions.cloudCover !== undefined ? 0.06 * conditions.cloudCover / 100 : weather === 'clear' ? 0 : 0.06 };
}
