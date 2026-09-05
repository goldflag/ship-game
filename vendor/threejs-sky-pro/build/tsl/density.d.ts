type Node = any;
/**
 * Per-sample 3D-noise mip levels: the base shape and the erosion tap (reading the
 * base volume at the erosion scale).
 */
export interface CloudNoiseLods {
    base: Node;
    erosion: Node;
}
/** Inputs to {@link sampleCloudDensity}. */
export interface SampleCloudDensityParams {
    /** World-space sample position (vec3). */
    position: Node;
    /** Shell height fraction (0 = base, 1 = top), unclamped — gated at both the base and top. */
    shellHeightFraction: Node;
    /** Weather map (2D RGBA): r = coverage height, other channels currently unused by the density field. */
    weather: Node;
    /** Cloud coverage in [0,1]: 0 = clear sky, 1 = full weather map. */
    coverage: Node;
    /** Base-shape noise (3D RGBA): R/G/B = Worley fBm rising freq (low/mid/high). Used for both the base shape and the erosion sample. */
    base: Node;
    /** Construction-time graph choice: include wind drift/evolution coordinates. */
    animatedClouds: boolean;
    /** Accumulated horizontal wind offset (world meters). */
    windOffset: Node;
    /** Normalized horizontal wind direction (vec3) for the height-skew lean. */
    windDirection: Node;
    /** Downwind cloud-top lean: meters of horizontal shift applied across the shell height. */
    windSkew: Node;
    /** Accumulated evolution-scroll distance (meters); applied along the wind direction's
     *  reverse, so the noise churns opposite the way the cloud mass drifts. */
    evolutionOffset: Node;
    /** World meters per weather-map tile (xz → UV). */
    weatherScale: Node;
    /** World meters per base-shape tile (xyz → UV). */
    baseScale: Node;
    /** World meters per erosion tile (the base volume re-sampled at the erosion scale). */
    erosionScale: Node;
    /** Per-channel dilate strengths for the base texture, in R,G,B order. */
    baseChannelStrengths: Node[];
    /** Master multiplier applied across all base-shape channels (1 = unchanged). */
    baseStrength: Node;
    /** Per-channel erode strengths for the erosion sample, in R,G,B order. */
    erosionChannelStrengths: Node[];
    /** Erosion master multiplier at the cloud base (shell height fraction 0). Carves both
     *  the top threshold and the base threshold near the floor. */
    erosionStrengthBase: Node;
    /** Erosion master multiplier at the cloud peak (shell height fraction 1). */
    erosionStrengthPeak: Node;
    /** Erosion shape in [0,1]: 0 = billowy (inverted-Worley value, carves round cavities), 1 = wispy (plain Worley, 1 − value, carves filaments). */
    erosionShape: Node;
    /** Weather-map floor-carve strength (0 = off): required weather-map coverage at the
     *  true floor, ramping to no requirement by `baseWeatherHeightEnd`. Low-coverage
     *  (thin/wispy) columns lose their base first; high-coverage columns keep a flat
     *  floor down to height 0. */
    baseWeatherStrength: Node;
    /** Shell height fraction where the floor-carve requirement is strongest (nearest 0). */
    baseWeatherHeightStart: Node;
    /** Shell height fraction above which the floor-carve requirement has fully relaxed. */
    baseWeatherHeightEnd: Node;
    /** Soft-edge half-width at the cloud base (shell height-fraction) for the density boundary smoothstep. */
    edgeSoftness: Node;
    /** Per-km division applied to `edgeSoftness` above the base (1 = constant softness over height). */
    edgeSoftnessFalloff: Node;
    /** Shell thickness in meters — converts the shell height fraction to km for the softness falloff. */
    thickness: Node;
    /**
     * Per-volume 3D-noise mip levels (base / erosion), supplied by the caller: the
     * primary march's per-sample cone-footprint mip, the light march's frozen cone
     * LOD, or the shadow bake's single absolute mip. The 2D weather map has no mip
     * pyramid, so it always reads level 0.
     */
    lods: CloudNoiseLods;
}
/** A base-shape sample that can be reused when erosion is needed. */
export interface StagedCloudDensity {
    /** Base-only upper bound used for conservative empty-space skipping. */
    conservative: Node;
    /** Complete the staged sample with one erosion tap at `erosionLod`. */
    withErosion(erosionLod: Node): Node;
}
/** Mip LOD for one noise volume: the cone footprint measured in the volume's texels, log2, biased + floored at 0. */
export declare function coneFootprintLod(footprint: Node, scale: Node, resolution: Node, mipBaseLevel: Node): Node;
/**
 * Cone-footprint LODs at one footprint. The erosion tap reads the base volume at its
 * own world scale (`erosionScale`), so it gets its own mip rather than a shift off
 * the (already-clamped) base LOD. `resolution` is the *actual* bound base-shape
 * texture's texel count (per axis) — it varies with quality tier, so it must come
 * from a live uniform, not a compile-time default.
 */
export declare function cloudNoiseLods(footprint: Node, baseScale: Node, erosionScale: Node, resolution: Node, mipBaseLevel: Node): CloudNoiseLods;
/**
 * Sample weather + base shape once. The returned candidate exposes the conservative
 * base density and can add erosion without repeating the shared work.
 */
export declare function stageCloudDensity(params: Omit<SampleCloudDensityParams, "lods">, baseLod: Node): StagedCloudDensity;
/** Full cloud density at a world position. */
export declare function sampleCloudDensity(params: SampleCloudDensityParams): Node;
/** Base-only upper-bound density for conservative skipping and deep light samples. */
export declare function sampleConservativeCloudDensity(params: SampleCloudDensityParams): Node;
export {};
