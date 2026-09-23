import type { WeatherPart } from '../contracts';

/** Dry weather: no rain, no lightning. */
export function createStubWeather(): WeatherPart {
  return {
    meshes: [],
    strike: null,
    flash: 0,
    apply() {},
    postProcess: (_scenePass, color) => color,
    update() {},
    setQuality() {},
    dispose() {},
  };
}
