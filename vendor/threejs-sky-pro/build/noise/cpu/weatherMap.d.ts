import { type WeatherMapProfile } from '../noiseProfiles';
/** Generate the weather map at `size`² texels (R8, row-major, one byte per texel). */
export declare function generateWeatherMip0(size: number, profile: WeatherMapProfile): Uint8Array;
