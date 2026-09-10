import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';

const templates = new Map<string, Promise<GLTF>>();

/** Exported joint hierarchy for CPU frame tests. Each caller owns a fresh tree;
 * only the immutable source template is shared within the test process. */
export async function loadShipJoints(id: string): Promise<GLTF> {
  let template = templates.get(id);
  if (!template) {
    template = (async () => {
      const file = Bun.file(new URL(`../../public/models/${id}.glb`, import.meta.url));
      const header = new DataView(await file.slice(0, 20).arrayBuffer());
      const gltf = JSON.parse(await file.slice(20, 20 + header.getUint32(12, true)).text());
      const nodes = gltf.nodes.map(({ mesh: _mesh, ...node }: { mesh?: number }) => node);
      return new GLTFLoader().parseAsync(JSON.stringify({ asset: gltf.asset, scene: gltf.scene, scenes: gltf.scenes, nodes }), '');
    })();
    templates.set(id, template);
  }
  const model = await template, scene = model.scene.clone(true);
  return { ...model, scene, scenes: model.scenes.map(original => original === model.scene ? scene : original.clone(true)) };
}
