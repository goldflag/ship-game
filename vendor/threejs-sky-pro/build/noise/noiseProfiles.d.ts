/** Per-axis 3D texture dimensions, in texels. */
export interface NoiseDim3 {
    x: number;
    y: number;
    z: number;
}
/** Default base-shape volume resolution (64³). */
export declare const DEFAULT_BASE_SHAPE_DIMS: NoiseDim3;
/** One Worley fBm: per-octave cell counts and matching octave weights (same length). */
export interface WorleyFBM {
    /** Per-octave grid resolution: cells per axis across the [0,1]³ volume. */
    cells: number[];
    /** Per-octave contribution, one per entry in `cells`. Sum ≈ 1 keeps the fBm in [0,1]. */
    weights: number[];
}
/** Base-shape composition: R/G/B = Worley fBm at low/mid/high frequency. */
export interface BaseShapeProfile {
    /** Coarse Worley fBm → R. Dilates the cloud silhouette. */
    worleyLow: WorleyFBM;
    /** Mid Worley fBm → G. First erosion tap. */
    worleyMid: WorleyFBM;
    /** Fine Worley fBm → B. Second erosion tap. */
    worleyHigh: WorleyFBM;
}
/** Default base-shape composition used by the bundled bake. */
export declare const DEFAULT_BASE_SHAPE_PROFILE: BaseShapeProfile;
/** One Perlin fBm layer for the weather map. */
export interface WeatherFBM {
    /** Features across the [0,1] map (low = broad masses, high = fine). */
    frequency: number;
    /** Octave count; each octave doubles frequency and halves weight. */
    octaves: number;
    /** Picks a decorrelated z-slice of the tileable 3D noise. */
    seed: number;
}
/** Low-frequency main cloud mass. */
export interface WeatherMassFBM extends WeatherFBM {
    /** Contrast about 0.5 (1 = raw fBm, 0 = flat, >1 = punchier mass/gaps). */
    amplitude: number;
}
/** Signed high-frequency detail composited into the coverage channel. */
export interface WeatherDetailFBM extends WeatherFBM {
    /** Signed [-1,1] erode/add strength (0 = no modulation). */
    strength: number;
}
/** Weather-map coverage composition (2D R8, read as cloud-top height). */
export interface WeatherMapProfile {
    /** Low-frequency Perlin main cloud mass feeding the coverage channel. */
    mainMass: WeatherMassFBM;
    /** High-frequency signed detail composited into coverage. */
    detail: WeatherDetailFBM;
    /** Bake-time coverage baseline (0.5 = passthrough). */
    coverage: number;
}
/** Default weather-map composition used by `generateWeatherMap`. */
export declare const DEFAULT_WEATHER_MAP_PROFILE: WeatherMapProfile;
