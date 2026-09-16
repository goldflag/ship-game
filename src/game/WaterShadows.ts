import { Mesh, type DepthTexture, type DirectionalLight, type Scene } from 'three/webgpu';
import { Fn, If, float, lightShadowMatrix, mix, normalWorld, positionWorld, reference, texture, vec2 } from 'three/tsl';
import { WaterSurfaceMaterial } from '../../vendor/threejs-water-pro/build/index.js';

import type { WaterShadowQuality } from './graphicsSettings';

const surfaces = new WeakMap<Scene, WaterSurfaceMaterial[]>();
const bindings = new WeakMap<WaterSurfaceMaterial, { depth: DepthTexture | null; quality: WaterShadowQuality }>();

/** Bind the completed scene's shadow map for the next water draw.
 * Only sample that map: opaque lighting owns its rendering and disposal. */
export function updateWaterShadows(scene: Scene, light: DirectionalLight, reversedDepth: boolean, quality: WaterShadowQuality): void {
  let materials = surfaces.get(scene);
  if (!materials) {
    const found = new Set<WaterSurfaceMaterial>();
    scene.traverse(object => {
      if (!(object instanceof Mesh)) return;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (material instanceof WaterSurfaceMaterial) found.add(material);
      }
    });
    materials = [...found];
    surfaces.set(scene, materials);
  }
  const depth = quality !== 'off' && light.castShadow && light.shadow.intensity > 0 ? light.shadow.map?.depthTexture ?? null : null;
  for (const material of materials) {
    const previous = bindings.get(material);
    const effectiveQuality = depth ? quality : 'off';
    if (previous?.depth === depth && previous.quality === effectiveQuality) continue;
    bindings.set(material, { depth, quality: effectiveQuality });
    const node = depth ? Fn(() => {
      const offset = normalWorld.mul(reference('normalBias', 'float', light.shadow));
      const projected = lightShadowMatrix(light).mul(positionWorld.add(offset));
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
        const uv = vec2(coord.x, coord.y.oneMinus());
        const bias = reference('bias', 'float', light.shadow);
        const z = reversedDepth ? coord.z.sub(bias) : coord.z.add(bias);
        const visibility = float(0).toVar();
        // Choose the kernel while building the shader: no per-pixel quality branch.
        if (quality === 'low') {
          visibility.assign(texture(depth, uv).compare(z));
        } else {
          const step = reference('radius', 'float', light.shadow).div(reference('mapSize', 'vec2', light.shadow));
          const offsets = quality === 'medium' ? [-.75, .75] : [-1, 0, 1];
          for (const y of offsets) for (const x of offsets) {
            visibility.addAssign(texture(depth, uv.add(step.mul(vec2(x, y)))).compare(z));
          }
          visibility.divAssign(offsets.length * offsets.length);
        }
        result.assign(mix(1, visibility, reference('intensity', 'float', light.shadow)));
      });
      return result;
    })() : null;
    material.setSunShadowNode(node);
  }
}
