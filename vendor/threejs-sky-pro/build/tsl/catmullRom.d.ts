/**
 * Samples a texture with a Catmull-Rom filter using 5 bilinear taps (the 4 corner taps of
 * the full 3×3 bilinear collapse are dropped and the remaining weights renormalized).
 * Bilinear resampling low-passes the image on every fetch, which compounds into visible
 * blur when a temporal history buffer is rewarped frame after frame; Catmull-Rom's negative
 * lobes undo that softening. At an exact texel center the filter returns the texel value
 * unchanged. Can overshoot near sharp edges — clamp the result if the consumer needs
 * bounded values.
 *
 * @param textureNode Texture to sample; must use bilinear filtering.
 * @param coord Sample position in the texture's UV space.
 * @param textureSize Texture dimensions in pixels.
 */
export declare function sampleCatmullRom5(textureNode: any, coord: any, textureSize: any): any;
