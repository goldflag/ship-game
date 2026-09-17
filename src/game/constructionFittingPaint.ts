import * as THREE from 'three';
import { constructionPaintColor, CONSTRUCTION_FINISH } from '../ships/constructionPaints';

/** Coat opaque fitting surfaces, preserving glass, texture detail and articulation.
 * Cloned materials belong to the caller; geometry and textures remain shared. */
export function paintConstructionFitting(model: THREE.Group, paint?: string, clone = true): THREE.Material[] {
  if (!paint) return [];
  const materials = new Map<THREE.Material, THREE.Material>();
  model.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return;
    const coat = (original: THREE.Material): THREE.Material => {
      if (!(original instanceof THREE.MeshStandardMaterial) || original.transparent || original.opacity < 1) return original;
      let material = materials.get(original);
      if (!material) {
        const coated = clone ? original.clone() : original;
        coated.color.set(constructionPaintColor(paint));
        coated.roughness = CONSTRUCTION_FINISH.steelRoughness;
        coated.metalness = CONSTRUCTION_FINISH.metalness;
        materials.set(original, material = coated);
      }
      return material;
    };
    node.material = Array.isArray(node.material) ? node.material.map(coat) : coat(node.material);
  });
  return [...materials.values()];
}
