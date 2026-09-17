import * as THREE from 'three/webgpu';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import type { ShipView } from '../../src/game/ShipView';
import type { Combatant } from '../../src/simulation/damage';
import type { ConstructionSource, ShipDefinition } from '../../src/ships/blueprint';
import { resetReviewPose } from './pose';

export async function exportReviewGlb(model: THREE.Object3D, view: ShipView, actor: Combatant, definition: ShipDefinition, source: ConstructionSource) {
  // Retained joints export at their canonical neutral transforms; previews and
  // simulation apply the separately declared installation resting elevation.
  resetReviewPose(actor, definition, source, view, true);
  model.traverse(node => { node.visible = true; });
  const exported = model.clone(true);
  exported.traverse(node => { delete node.userData.constructionSurfaces; });
  const exportScene = new THREE.Scene();
  exportScene.userData = { definitionHash: definition.contentHash, constructionRevision: source.revision };
  exportScene.add(exported);
  const bytes = await new GLTFExporter().parseAsync(exportScene, { binary: true, onlyVisible: false, trs: true }) as ArrayBuffer;
  const blob = new Blob([bytes], { type: 'model/gltf-binary' });
  return await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as string); reader.onerror = reject; reader.readAsDataURL(blob); });
}
