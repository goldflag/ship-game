import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/** Real exported geometry/joints, without texture decoding or a GPU. */
export async function loadShipGeometry(id: string) {
  const bytes = await Bun.file(new URL(`../../public/models/${id}.glb`, import.meta.url)).arrayBuffer();
  const length = new DataView(bytes).getUint32(12, true);
  const gltf = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, length)));
  const binary = new Uint8Array(bytes, 20 + length + 8);
  gltf.buffers[0].uri = 'data:application/octet-stream;base64,' + Buffer.from(binary).toString('base64');
  delete gltf.images; delete gltf.textures;
  for (const material of gltf.materials) {
    for (const record of [material, material.pbrMetallicRoughness]) if (record) for (const key of Object.keys(record)) if (key.endsWith('Texture')) delete record[key];
  }
  Object.assign(globalThis, { ProgressEvent: class { constructor(readonly type: string) {} } });
  return (await new GLTFLoader().parseAsync(JSON.stringify(gltf), '')).scene;
}
