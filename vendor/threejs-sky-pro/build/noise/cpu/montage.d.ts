/** Per-axis dimensions of the source volume, in texels. */
export interface MontageDim {
    x: number;
    y: number;
    z: number;
}
/** A rendered montage image. */
export interface GrayMontage {
    /** Image width in pixels. */
    w: number;
    /** Image height in pixels. */
    h: number;
    /** `w`·`h` grayscale bytes, row-major. */
    px: Uint8Array;
}
/**
 * Grayscale montage of one RGBA8 mip `level`: `channels` → rows, `sliceCount` evenly-spaced
 * z-slices → columns. Each tile is nearest-upscaled by `upscale` and gutter-separated.
 */
export declare function buildMontageGray(level: Uint8Array, dim: MontageDim, channels: number[], sliceCount: number, upscale: number): GrayMontage;
