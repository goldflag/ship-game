import type { WeatherMapParams } from '../../noise';
import type { AtmosphereParams } from '../../state/Atmosphere';
import type { SunParams } from '../../state/Sun';
import type { GodRaysParams } from '../../state/GodRays';
import type { TimeOfDayParams } from '../../state/TimeOfDay';
import type { CloudsParams } from '../../state/Clouds';
/** Weather map driving cloud placement. Applying it regenerates the map on the CPU. */
export interface NoiseParams {
    weather: WeatherMapParams;
}
/** Night-sky panorama brightness. */
export interface NightSkyParams {
    intensity: number;
}
/**
 * Serializable sky configuration. A preset must fully specify every field (no "leave
 * omitted fields untouched" fallback) -- switching presets is a full state replacement.
 */
export interface SkyParams {
    atmosphere: AtmosphereParams;
    sun: SunParams;
    time: TimeOfDayParams;
    cloud: CloudsParams;
    noise: NoiseParams;
    godRays: GodRaysParams;
    nightSky: NightSkyParams;
}
import { PARTLY_CLOUDY } from './partlyCloudy';
import { STUNNING_SUNSET } from './stunningSunset';
import { THUNDERSTORM } from './thunderstorm';
import { STORMY_EVENING } from './stormyEvening';
import { MOONLIT_NIGHT } from './moonlitNight';
import { FLUFFY } from './fluffy';
import { HAZY } from './hazy';
import { PIXAR } from './pixar';
export { PARTLY_CLOUDY, STUNNING_SUNSET, THUNDERSTORM, STORMY_EVENING, MOONLIT_NIGHT, FLUFFY, HAZY, PIXAR };
/** Names of the bundled (curated) look presets. `partlyCloudy` is also the bundled startup default. */
export type PresetName = 'partlyCloudy' | 'stunningSunset' | 'thunderstorm' | 'stormyEvening' | 'moonlitNight' | 'fluffy' | 'hazy' | 'pixar';
/** Bundled look presets by name. Apply via `sky.applyPreset(PRESETS[name])` (library state only). */
export declare const PRESETS: Readonly<Record<PresetName, SkyParams>>;
