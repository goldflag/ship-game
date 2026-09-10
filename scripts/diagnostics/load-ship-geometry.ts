import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/** Real exported geometry/joints, without texture decoding or a GPU. */
export async function loadShipGeometry(id: string) {
  const bytes = await Bun.file(new URL(`../../public/models/${id}.glb`, import.meta.url)).arrayBuffer();
  const length = new DataView(bytes).getUint32(12, true);
  const gltf = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, length)));
  delete gltf.images; delete gltf.textures;
  for (const material of gltf.materials) {
    for (const record of [material, material.pbrMetallicRoughness]) if (record) for (const key of Object.keys(record)) if (key.endsWith('Texture')) delete record[key];
  }
  // Retain the binary chunk verbatim. A data URI would encode, stringify,
  // fetch and decode the entire mesh payload for every model-loading test.
  const json = new TextEncoder().encode(JSON.stringify(gltf));
  const jsonLength = Math.ceil(json.length / 4) * 4;
  const binary = new Uint8Array(bytes, 20 + length);
  const model = new Uint8Array(20 + jsonLength + binary.length);
  model.set(new Uint8Array(bytes, 0, 20));
  const header = new DataView(model.buffer);
  header.setUint32(8, model.length, true);
  header.setUint32(12, jsonLength, true);
  model.fill(0x20, 20, 20 + jsonLength);
  model.set(json, 20);
  model.set(binary, 20 + jsonLength);
  return (await new GLTFLoader().parseAsync(model.buffer, '')).scene;
}
