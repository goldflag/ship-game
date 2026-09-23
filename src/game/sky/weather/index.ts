import type { AtmospherePart, SkyPartContext, WeatherPart } from '../contracts';
import { WeatherSystem, type WeatherOptions } from './WeatherSystem';

export type { WeatherOptions } from './WeatherSystem';

/** Rain, splashes, lightning and thunder. The atmosphere lights the rain: its diffuse sky light at the camera's
 * altitude fills the drops and the rain-lit air. */
export function createWeather(context: SkyPartContext, atmosphere: AtmospherePart, options: WeatherOptions = {}): WeatherPart {
  return new WeatherSystem(context, atmosphere, options);
}
