import * as THREE from 'three';
import { constructionPaintColor } from '../ships/constructionPaints';
import { followsComponentPaint } from '../ships/componentMaterials';

/** Recolor declared coatings, preserving fixed materials, finishes and articulation.
 * Cloned materials belong to the caller; geometry and textures remain shared. */
export function paintConstructionFitting(model: THREE.Group, paint?: string, clone = true): THREE.Material[] {
  if (!paint) return [];
  const materials = new Map<THREE.Material, THREE.Material>();
  model.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return;
    const coat = (original: THREE.Material): THREE.Material => {
      if (!(original instanceof THREE.MeshStandardMaterial) || original.transparent || original.opacity < 1) return original;
      if (!followsComponentPaint(original.name, original.userData)) return original;
      let material = materials.get(original);
      if (!material) {
        const coated = clone ? original.clone() : original;
        coated.color.set(constructionPaintColor(paint));
        materials.set(original, material = coated);
      }
      return material;
    };
    node.material = Array.isArray(node.material) ? node.material.map(coat) : coat(node.material);
  });
  return [...materials.values()];
}
