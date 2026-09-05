import { type NoiseDim3, type BaseShapeProfile } from "../noiseProfiles";
/**
 * Tileable Perlin fBm over a full `size`×`size` slice at fixed `z`. Per-octave halving
 * weight, remapped [-1,1] → [0,1], row-major out.
 *
 * The slice's uv domain is [0,1)² (texel x maps to `x / size`); `z` is in unscaled
 * noise-domain units, and each octave wraps at `round(baseFrequency)` lattice cells,
 * so the slice tiles in x/y. `baseFrequency` is in lattice cells across the [0,1] edge.
 */
export declare function perlinFBMSlice(size: number, z: number, baseFrequency: number, octaves: number): Float64Array;
/** A baked texture: tightly-packed RGBA8 mip levels + their dimensions. */
export interface BakedTexture {
    /** Mip-0 dimensions in texels. */
    dims: NoiseDim3;
    /** Components per texel; always RGBA8. */
    channels: 4;
    /** mip 0 first; each entry is w·h·d·4 bytes for that level. */
    levels: Uint8Array[];
}
/**
 * Base-shape volume, mip 0 only (RGBA8, row-major, `dim.x`·`dim.y`·`dim.z`·4 bytes).
 * RGB = inverted Worley fBm at low/mid/high frequency; A = 255.
 */
export declare function generateBaseShapeMip0(dim: NoiseDim3, profile: BaseShapeProfile): Uint8Array;
/** Base-shape volume with its full mip chain. Source of truth for the bundled bake. */
export declare function generateBaseShape(dim: NoiseDim3, profile: BaseShapeProfile): BakedTexture;
