import * as THREE from 'three/webgpu';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { createConstructionModel, disposeConstructionModel } from '../../src/game/constructionModel';
import { ShipJoints } from '../../src/game/shipJoints';
import type { ConstructionResult, ConstructionSource, ShipDefinition } from '../../src/ships/blueprint';

/** The published GLB of a compiled construction ship. Everything it runs is the construction model recipe
 * (`scripts/construction/fingerprints.ts` hashes this module and its imports), so it builds its own model
 * and poses it here rather than exporting a review page's ship view. */
export async function exportConstructionGlb(source: ConstructionSource, result: ConstructionResult, definition: ShipDefinition) {
  const model = await createConstructionModel(source, result);
  try {
    model.userData.definitionHash = definition.contentHash;
    // Retained joints export at their canonical neutral transforms; previews and
    // simulation apply the separately declared installation resting elevation.
    new ShipJoints(model, definition).neutral();
    model.traverse(node => { node.visible = true; });
    const exported = model.clone(true);
    exported.traverse(node => { delete node.userData.constructionSurfaces; });
    const exportScene = new THREE.Scene();
    exportScene.userData = { definitionHash: definition.contentHash, constructionRevision: source.revision };
    exportScene.add(exported);
    const bytes = await new GLTFExporter().parseAsync(exportScene, { binary: true, onlyVisible: false, trs: true }) as ArrayBuffer;
    const blob = new Blob([bytes], { type: 'model/gltf-binary' });
    return await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as string); reader.onerror = reject; reader.readAsDataURL(blob); });
  } finally {
    disposeConstructionModel(model);
  }
}
