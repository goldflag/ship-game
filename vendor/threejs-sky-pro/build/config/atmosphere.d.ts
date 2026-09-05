/**
 * Rayleigh/Mie medium constants shared by the CPU ambient bake and every GPU graph that
 * models the same atmosphere. Lengths in km, scattering coefficients in km⁻¹.
 */
export declare const ATMOSPHERE: {
    /** Mean Earth radius. Kilometers. */
    readonly EARTH_R_KM: 6371;
    /** Top-of-atmosphere shell radius — Earth radius + 100 km. Kilometers. */
    readonly ATMO_R_KM: 6471;
    /** Atmosphere shell thickness (`ATMO_R_KM - EARTH_R_KM`). Kilometers. */
    readonly ATMOSPHERE_THICKNESS_KM: 100;
    /** Rayleigh density scale height. Kilometers. */
    readonly RAYLEIGH_SCALE_HEIGHT_KM: 8;
    /** Mie density scale height. Kilometers. */
    readonly MIE_SCALE_HEIGHT_KM: 1.2;
    /** Rayleigh sea-level scattering coefficients, per R/G/B channel. km⁻¹. */
    readonly RAYLEIGH_BETA_RGB_KM: readonly [0.005802, 0.013558, 0.0331];
    /** Mie base scattering magnitude, scaled by turbidity at each use site. km⁻¹. */
    readonly MIE_BETA_BASE_KM: 0.021;
    /** Mie extinction ÷ scattering ratio (single-scattering albedo ≈ 0.9 → ×1.1). */
    readonly MIE_EXTINCTION_FACTOR: 1.1;
};
