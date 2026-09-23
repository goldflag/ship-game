import * as THREE from 'three';
import type { ConstructionSurfaceFinish } from '../ships/blueprint';
import { constructionPaintColor, constructionFinishRoughness } from '../ships/constructionPaints';
import { followsComponentPaint } from '../ships/componentMaterials';

/** Authored roofs: the `roof` role, or its exact legacy material name on retained catalogs. */
const authoredRoof = (material: THREE.Material) => (material.userData.componentMaterialRole ?? material.name) === 'roof';

/** Recolor declared coatings, optionally setting sheen; preserve fixed materials and articulation.
 * ropeColor opts a procedural rope route into recoloring without changing its fiber finish.
 * roofColor (`#rrggbb`) coats authored roofs under `paint`; without it they take `paint` like the walls.
 * Cloned materials belong to the caller; geometry and textures remain shared. */
export function paintConstructionFitting(model: THREE.Group, paint?: string, clone = true, finish?: ConstructionSurfaceFinish, ropeColor?: string, roofColor?: string): THREE.Material[] {
  if (!paint && !finish && !ropeColor) return [];
  const materials = new Map<THREE.Material, THREE.Material>();
  model.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return;
    const coat = (original: THREE.Material): THREE.Material => {
      if (!(original instanceof THREE.MeshStandardMaterial) || original.transparent || original.opacity < 1) return original;
      const rope = !!ropeColor && original.userData.componentMaterialVersion === 1 && original.userData.componentMaterialRole === 'rope';
      if (!rope && !followsComponentPaint(original.name, original.userData)) return original;
      let material = materials.get(original);
      if (!material) {
        const coated = clone ? original.clone() : original;
        const color = rope ? ropeColor : paint;
        if (color) coated.color.set(!rope && roofColor && authoredRoof(original) ? roofColor : constructionPaintColor(color));
        if (!rope && finish) { coated.roughness = constructionFinishRoughness(finish, coated.roughness); coated.metalness = 0; }
        materials.set(original, material = coated);
      }
      return material;
    };
    node.material = Array.isArray(node.material) ? node.material.map(coat) : coat(node.material);
  });
  return [...materials.values()];
}
