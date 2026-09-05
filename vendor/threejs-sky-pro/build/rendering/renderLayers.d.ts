import * as THREE from "three/webgpu";
/**
 * Which of three's two draw lists an object sorts into, chosen by
 * `material.transparent`. `order` only sorts within a list; the two lists never
 * interleave, so an `order` in one is not comparable to an `order` in the other.
 */
export type RenderList = "opaque" | "transparent";
/** A render layer: the list an object draws in, and its sort key inside that list. */
export interface RenderLayerSpec {
    readonly list: RenderList;
    readonly order: number;
}
/**
 * Named draw-order layers for a sky/water/scene stack.
 *
 * Place your own meshes with {@link placeInLayer} instead of writing raw
 * `renderOrder` numbers — the layer names carry both the sort key and which of
 * three's two draw lists the object belongs in, so the stack stays legible as it
 * grows.
 *
 * Draw order runs top to bottom (each layer draws over the ones above it):
 *
 * | Layer               | List        | Use                                         |
 * | ------------------- | ----------- | ------------------------------------------- |
 * | `background`        | opaque      | Sky dome, HDRI. Nothing draws behind it.    |
 * | `backgroundOverlay` | transparent | Stars, cirrus. Blended backdrop, no depth.  |
 * | `worldSurface`      | opaque      | Water. A depth-writing surface under the sky. |
 * | `atmosphereOverlay` | transparent | Clouds. Depth-tested; draws over the surface. |
 * | `sceneTransparent`  | transparent | Your own glass/particles (three's default). |
 * | `foreground`        | transparent | HUD / always-on-top overlays.               |
 *
 * `background` sits in the **opaque** list on purpose; everything blended is in the
 * transparent list. That list boundary is the thing raw `renderOrder` numbers hide —
 * `background`'s `-90` and `backgroundOverlay`'s `-50` are in different lists and
 * never compare.
 *
 * Mirrored by role (not by these literal numbers) in `threejs-water-pro`. The two
 * libraries can't import each other; they agree on the ladder of roles and each
 * assigns its own meshes into it. `worldSurface` and `atmosphereOverlay` are the
 * shared contract — the cloud layer depth-tests against the water surface, so it
 * must draw after it.
 */
export declare const RenderLayer: {
    /** Sky dome / HDRI. Opaque list — draws first, before scene opaques z-test over it. */
    readonly background: {
        readonly list: "opaque";
        readonly order: -90;
    };
    /** Blended backdrop (stars, cirrus). Behind all scene content; writes no depth. */
    readonly backgroundOverlay: {
        readonly list: "transparent";
        readonly order: -50;
    };
    /** A depth-writing surface under the sky (water). Overlays depth-test against it. */
    readonly worldSurface: {
        readonly list: "opaque";
        readonly order: -30;
    };
    /** Depth-tested overlay (clouds). Draws after `worldSurface`, over the scene. */
    readonly atmosphereOverlay: {
        readonly list: "transparent";
        readonly order: -20;
    };
    /** Your own transparent scene objects — glass, particles. three's default slot. */
    readonly sceneTransparent: {
        readonly list: "transparent";
        readonly order: 0;
    };
    /** Always-on-top overlays — HUD sprites, gizmos. */
    readonly foreground: {
        readonly list: "transparent";
        readonly order: 100;
    };
};
/** A layer name from {@link RenderLayer}. */
export type RenderLayerName = keyof typeof RenderLayer;
/**
 * Assigns `object` to a render layer.
 *
 * Sets `object.renderOrder` from the layer's sort key plus `offset` — use `offset`
 * to fan several meshes across one layer (a higher offset draws later, i.e. on top),
 * keeping it under 10 so the mesh stays inside the layer's band.
 *
 * If the object carries a material whose `transparent` flag disagrees with the
 * layer's list, this warns — a `background` mesh with `transparent: true`, or a
 * `sceneTransparent` mesh left opaque, lands in the wrong draw list and no
 * `renderOrder` can fix it.
 *
 * @param object The mesh (or group) to place.
 * @param layer A member of {@link RenderLayer}.
 * @param offset Added to the layer's sort key. Keep it in `[0, 10)`.
 */
export declare function placeInLayer(object: THREE.Object3D, layer: RenderLayerSpec, offset?: number): void;
