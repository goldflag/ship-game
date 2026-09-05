import * as THREE from "three/webgpu";
import { Atmosphere } from "../state/Atmosphere";
import { Sun } from "../state/Sun";
import { TimeOfDay } from "../state/TimeOfDay";
/**
 * Physically-based sky dome, drawn as a fullscreen quad at the far plane. Atmospheric
 * radiance normally comes from a shared angular sky-view LUT; passing `null` retains the
 * original 12-step integration path as a quality reference. Sun and moon discs remain
 * analytic at display resolution. Outputs linear HDR radiance with no tonemap applied.
 */
export declare class SkyMaterial extends THREE.MeshBasicNodeMaterial {
    /** Shared atmospheric scattering state. */
    readonly atmosphere: Atmosphere;
    /** Shared sun state: direction, intensity, disc size. */
    readonly sun: Sun;
    /** 2D sun-transmittance LUT, indexed by (sun zenith cosine, altitude). */
    readonly transmittanceLUT: THREE.Texture;
    /** 2D multiple-scattering LUT, sharing the transmittance LUT's (μ, altitude) frame. */
    readonly multiScatterLUT: THREE.Texture;
    /** Shared angular sky radiance, or null to compile the reference integrator. */
    readonly skyViewLUT: THREE.Texture | null;
    /** Time-of-day state, or `null` to compile the moon out. */
    readonly timeOfDay: TimeOfDay | null;
    /** Lunar albedo map sampled across the moon disc, or `null` for a flat tinted disc. */
    readonly moonTexture: THREE.Texture | null;
    /** Per-fragment view direction node. World space, normalized. */
    readonly viewDirOverride: any;
    /**
     * @param atmosphere Shared atmospheric scattering state.
     * @param sun Shared sun state.
     * @param transmittanceLUT 2D sun-transmittance LUT.
     * @param multiScatterLUT 2D multiple-scattering LUT.
     * @param skyViewLUT Shared angular sky-radiance LUT, or null for reference integration.
     * @param viewDirOverride Per-fragment view direction node. World space, normalized.
     * @param timeOfDay Time-of-day state, or `null` for no moon.
     * @param moonTexture Lunar albedo map, or `null` for a flat tinted disc.
     */
    constructor(atmosphere: Atmosphere, sun: Sun, transmittanceLUT: THREE.Texture, multiScatterLUT: THREE.Texture, skyViewLUT: THREE.Texture | null, viewDirOverride: any, timeOfDay?: TimeOfDay | null, moonTexture?: THREE.Texture | null);
    private _buildColorNode;
}
