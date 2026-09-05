/** Per-axis dimensions of a baked volume, in texels (`z` = 1 for a 2D texture). */
export interface NoiseDims {
    x: number;
    y: number;
    z: number;
}
/** A parsed blob: the header fields plus the mip data they describe. */
export interface UnpackedBlob {
    /** Mip-0 dimensions; every other level derives from these via `mipDims`. */
    dims: NoiseDims;
    /** Components per texel (4 for RGBA8). */
    channels: number;
    /** Number of entries in `levels`. */
    mipLevels: number;
    /** mip 0 first; each entry is the RGBA8 bytes for that level. */
    levels: Uint8Array[];
}
/** Dimensions of mip `level` given the base dims. */
export declare function mipDims(base: NoiseDims, level: number): NoiseDims;
/** Pack header + mip levels into one uncompressed buffer. Gzip it before writing to disk. */
export declare function packBlob(input: {
    /** Mip-0 dimensions. Each axis must fit in a u16. */
    dims: NoiseDims;
    /** Components per texel (4 for RGBA8). */
    channels: number;
    /** mip 0 first, tightly packed; `levels[i]` must match `mipDims(dims, i)`. */
    levels: Uint8Array[];
}): Uint8Array;
/**
 * Parse an uncompressed blob buffer back into dims + mip levels. `levels` are subarray views
 * onto `buf`, not copies. Throws on a bad magic number or an unsupported version.
 */
export declare function unpackBlob(buf: Uint8Array): UnpackedBlob;
