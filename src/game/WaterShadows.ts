import type { DepthTexture, DirectionalLight, Node } from 'three/webgpu';
import { Fn, If, PCFSoftShadowFilter, float, lightShadowMatrix, mix, positionWorld, reference, texture, vec3 } from 'three/tsl';
import type { FocusShadowNode } from './FocusShadowNode';
import type { OceanApi } from './ocean/contracts';
import type { WaterShadowQuality } from './graphicsSettings';

type CloudShadow = (position: Node<'vec3'>) => Node<'float'>;
interface Binding { near: DepthTexture | null; wide: DepthTexture | null; quality: WaterShadowQuality; cloud?: CloudShadow }
const bindings = new WeakMap<OceanApi, Binding>();
/** Three's PCFSoft filter, which its typings declare with positional arguments; it takes one object. */
const pcfSoft = PCFSoftShadowFilter as unknown as (inputs: { depthTexture: DepthTexture; shadowCoord: Node<'vec3'>; shadow: DirectionalLight['shadow']; depthLayer: number }) => Node<'float'>;

/** Developer switch: off, the sea reads the wide map alone, as before it took the near map; for comparisons and cost
 * measurement. Read at the next frame. */
export const waterShadowMaps = { near: true };

/** A map's depth texture once three has drawn it, or null. */
const depthOf = (light: DirectionalLight) => light.shadow.map?.depthTexture ?? null;

/** Visibility of the sun through one shadow map at the sea's drawn position: 1 outside the map. `soft` filters as the
 * ships' paint does (three's PCFSoft: four gathered comparisons, a bilinear-weighted 3×3 texels); otherwise one
 * comparison, which the depth texture's linear filter makes a 2×2 bilinear one. */
function receiver(light: DirectionalLight, depth: DepthTexture, soft: boolean, reversedDepth: boolean): Node<'float'> {
  return Fn(() => {
    const shadow = light.shadow;
    // The receiver offset follows the sea's mean normal, straight up.
    const projected = lightShadowMatrix(light).mul(positionWorld.add(vec3(0, reference('normalBias', 'float', shadow), 0)));
    const coord = projected.xyz.div(projected.w).toVar();
    const inside = coord.x.greaterThanEqual(0).and(coord.x.lessThanEqual(1))
      .and(coord.y.greaterThanEqual(0)).and(coord.y.lessThanEqual(1))
      .and(coord.z.greaterThanEqual(0)).and(coord.z.lessThanEqual(1));
    const result = float(1).toVar();
    // Branch before sampling. A select after the filter still executes all
    // texture reads across the distant ocean, where no shadow can land.
    If(inside, () => {
      // Three's shadow projection follows WebGPU texture coordinates on both
      // backends; its depth texture handles the reversed comparison.
      const bias = reference('bias', 'float', shadow);
      const shadowCoord = vec3(coord.x, coord.y.oneMinus(), reversedDepth ? coord.z.sub(bias) : coord.z.add(bias)).toVar();
      // Choose the kernel while building the shader: no per-pixel quality branch.
      const visibility = soft ? pcfSoft({ depthTexture: depth, shadowCoord, shadow, depthLayer: 0 }) : texture(depth, shadowCoord.xy).compare(shadowCoord.z);
      result.assign(mix(1, visibility, reference('intensity', 'float', shadow)));
    });
    return result;
  })();
}

/** Bind the completed scene's sun shadow maps for the next sea draw, and the clouds' shadow when the sky casts one.
 * Where the camera-fitted near map covers the sea (as it covers the ships there) the sea reads it, with its centimetre
 * texels in close-ups, and fades to the wide map at its edge by the ships' own weight: a ship's shadow is as sharp on
 * the water beside her as on her deck. Only sample the maps: opaque lighting owns their rendering and disposal.
 * Low reads one bilinear comparison per map; Medium filters the near map as the ships' paint does and reads the wide
 * one once; High filters both. A pixel reads one map except in the fade band, so High costs four gathers where it
 * used to take nine comparisons. The view maps beyond the wide one stay off the sea: a sampler short of the limit. */
export function updateWaterShadows(ocean: OceanApi, maps: FocusShadowNode, reversedDepth: boolean, quality: WaterShadowQuality, cloud?: CloudShadow): void {
  const sun = maps.sun, on = quality !== 'off' && sun.castShadow && sun.shadow.intensity > 0;
  const nearLight = maps.near as unknown as DirectionalLight, wideLight = maps.wide as unknown as DirectionalLight;
  const wide = on ? depthOf(wideLight) : null, near = wide && waterShadowMaps.near ? depthOf(nearLight) : null;
  const effectiveQuality = wide ? quality : 'off';
  const previous = bindings.get(ocean);
  if (previous?.wide === wide && previous.near === near && previous.quality === effectiveQuality && previous.cloud === cloud) return;
  bindings.set(ocean, { near, wide, quality: effectiveQuality, cloud });
  let ships: Node<'float'> | null = null;
  if (wide) {
    const wideShadow = receiver(wideLight, wide, quality === 'high', reversedDepth);
    ships = near ? Fn(() => {
      // TSL emits a node's code in the first branch that uses it, so each map is read only where it counts.
      const share = maps.nearShare(positionWorld as unknown as Node<'vec3'>).toVar();
      const nearVisibility = float(1).toVar(), wideVisibility = float(1).toVar();
      If(share.greaterThan(0), () => { nearVisibility.assign(receiver(nearLight, near, quality !== 'low', reversedDepth)); });
      If(share.lessThan(1), () => { wideVisibility.assign(wideShadow); });
      return mix(wideVisibility, nearVisibility, share);
    })() : wideShadow;
  }
  const clouds = cloud?.(positionWorld as unknown as Node<'vec3'>) ?? null;
  ocean.setShadowNode(ships && clouds ? ships.mul(clouds) : ships ?? clouds);
}
