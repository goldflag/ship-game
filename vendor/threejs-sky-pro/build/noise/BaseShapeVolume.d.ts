import * as THREE from 'three/webgpu';
import { type NoiseDim3 } from './noiseProfiles';
/**
 * Owns the cloud base-shape volume and the resolution it's currently baked at, arbitrating
 * the async swap when the resolution changes.
 *
 * Build one with {@link BaseShapeVolume.create}, then re-resolve with {@link setDims}.
 */
export declare class BaseShapeVolume {
    private readonly _renderer;
    private _texture;
    private _dims;
    private _requestId;
    private constructor();
    /** Resolve the volume at `dims`. Await before rendering. */
    static create(renderer: THREE.WebGPURenderer, dims: NoiseDim3): Promise<BaseShapeVolume>;
    /** The live volume. Replaced by a successful {@link setDims}. */
    get texture(): THREE.Data3DTexture;
    /** Resolution the live volume is baked at. */
    get dims(): NoiseDim3;
    /**
     * Re-resolve the volume at `dims` and adopt it.
     *
     * Latest-request-wins: rapid switches can resolve out of order, so a superseded
     * completion discards its own texture rather than binding it over a newer one. Calling
     * with the current `dims` is not a no-op — it invalidates any in-flight request, so a
     * switch away and back can't land a stale texture.
     *
     * @returns the superseded texture, which the caller disposes once it has re-pointed its
     *   consumers at {@link texture}, or `null` when nothing was replaced.
     */
    setDims(dims: NoiseDim3): Promise<THREE.Data3DTexture | null>;
    dispose(): void;
}
