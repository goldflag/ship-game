import * as THREE from 'three';
import type { ConstructionSurfaceFinish } from '../ships/blueprint';
import { constructionPaintColor, constructionFinishRoughness } from '../ships/constructionPaints';
import { followsComponentPaint } from '../ships/componentMaterials';

/** Recolor declared coatings, optionally setting sheen; preserve fixed materials and articulation.
 * Cloned materials belong to the caller; geometry and textures remain shared. */
export function paintConstructionFitting(model: THREE.Group, paint?: string, clone = true, finish?: ConstructionSurfaceFinish): THREE.Material[] {
  if (!paint && !finish) return [];
  const materials = new Map<THREE.Material, THREE.Material>();
  model.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return;
    const coat = (original: THREE.Material): THREE.Material => {
      if (!(original instanceof THREE.MeshStandardMaterial) || original.transparent || original.opacity < 1) return original;
      if (!followsComponentPaint(original.name, original.userData)) return original;
      let material = materials.get(original);
      if (!material) {
        const coated = clone ? original.clone() : original;
        if (paint) coated.color.set(constructionPaintColor(paint));
        if (finish) { coated.roughness = constructionFinishRoughness(finish, coated.roughness); coated.metalness = 0; }
        materials.set(original, material = coated);
      }
      return material;
    };
    node.material = Array.isArray(node.material) ? node.material.map(coat) : coat(node.material);
  });
  return [...materials.values()];
}
