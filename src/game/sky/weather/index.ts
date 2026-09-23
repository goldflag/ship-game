import type { Node } from 'three/webgpu';
import type { SkyPartContext, WeatherPart } from '../contracts';
import { createStubWeather } from '../stubs/weather';

export interface WeatherOptions {
  /** Height of the drawn sea (waves and wake) at world XZ, for splashes that sit on the water. */
  seaHeight?: (x: Node<'float'>, z: Node<'float'>) => Node<'float'>;
}

/** Rain, splashes, lightning and thunder. */
export function createWeather(_context: SkyPartContext, _options: WeatherOptions = {}): WeatherPart | Promise<WeatherPart> {
  return createStubWeather();
}
