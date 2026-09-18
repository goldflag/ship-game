import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import type { Mesh } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/** GLTF extras retain flush marks; depth bias is a renderer setting, not solid geometry. */
function surfaceDetails(asset: GLTF): GLTF {
  asset.scene.traverse(node => {
    if (!node.userData.wallSurfaceDetail || !(node as Mesh).isMesh) return;
    const mesh=node as Mesh;
    for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material]) {
      material.polygonOffset=true;material.polygonOffsetFactor=0;material.polygonOffsetUnits=-2;
    }
  });
  return asset;
}

/** Production builds publish lossless gzip copies beside the original GLBs.
 * Decode explicitly so this works on static hosts without gzip header rules.
 *
 * Model URLs are stable across builds while the definition that must match them ships
 * inside the fingerprinted JS bundle. A browser that cached the previous build's model
 * would otherwise pair it with the new definition and fail the hash check, so the
 * version (the definition's content hash) rides along as a query to key the cache. */
export async function loadShipModel(url: string, compressed = import.meta.env.PROD, version?: string, signal?: AbortSignal) {
  const loader = new GLTFLoader();
  const query = version ? `?v=${encodeURIComponent(version)}` : '';
  const transfer = compressed && typeof DecompressionStream !== 'undefined';
  if (!transfer && !signal) return surfaceDetails(await loader.loadAsync(url + query));
  const request = `${url}${transfer ? '.gz' : ''}${query}`;
  const response = await (signal ? fetch(request, { signal }) : fetch(request));
  if (!response.ok) throw new Error(`Unable to load ship model (${response.status}): ${url}`);
  let bytes = await response.arrayBuffer();
  const header = new Uint8Array(bytes, 0, Math.min(2, bytes.byteLength));
  // A host may already supply Content-Encoding: gzip, which fetch decodes.
  if (header[0] === 0x1f && header[1] === 0x8b) {
    bytes = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  }
  return surfaceDetails(await loader.parseAsync(bytes, url.slice(0, url.lastIndexOf('/') + 1)));
}
