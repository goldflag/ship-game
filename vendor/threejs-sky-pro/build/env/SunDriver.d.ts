import type { Sun } from '../state/Sun';
import type { TimeOfDay } from '../state/TimeOfDay';
/** Wiring for a {@link SunDriver}. */
export interface SunDriverConfig {
    /** Clock the sun arc is derived from. Read every frame. */
    timeOfDay: TimeOfDay;
    /** Sun state the driver writes `direction` and `intensity` into. */
    sun: Sun;
    /** Initial peak sun intensity at full daylight. Change it later via `sun.peakIntensity`. */
    peakSunIntensity?: number;
}
/**
 * Drives sun + moon direction, star-panorama rotation, and sun intensity from
 * `TimeOfDay`. The sun rides the equinoctial diurnal circle for an observer
 * at `latitude` (one turn per day about the celestial pole; no seasonal
 * declination), the moon rides the anti-solar point, and the star field spins
 * about the same pole. `azimuth` rotates the whole sky about +Y.
 */
export declare class SunDriver {
    private readonly _timeOfDay;
    private readonly _sun;
    private _lastTime;
    private _lastLatitude;
    private _lastAzimuth;
    private readonly _panoramaToWorld;
    private readonly _poleTilt;
    private readonly _diurnalSpin;
    /** @param config The clock to read and the sun state to write. */
    constructor(config: SunDriverConfig);
    /**
     * Per-frame tick. Advances `time`, then recomputes sun and moon direction, sun
     * intensity, and the star-panorama rotation.
     * @param dt Seconds since the last tick.
     */
    update(dt: number): void;
}
