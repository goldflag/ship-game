import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/** Production builds publish lossless gzip copies beside the original GLBs.
 * Decode explicitly so this works on static hosts without gzip header rules.
 *
 * Model URLs are stable across builds while the definition that must match them ships
 * inside the fingerprinted JS bundle. A browser that cached the previous build's model
 * would otherwise pair it with the new definition and fail the hash check, so the
 * version (the definition's content hash) rides along as a query to key the cache. */
export async function loadShipModel(url: string, compressed = import.meta.env.PROD, version?: string) {
  const loader = new GLTFLoader();
  const query = version ? `?v=${encodeURIComponent(version)}` : '';
  if (!compressed || typeof DecompressionStream === 'undefined') return loader.loadAsync(url + query);
  const response = await fetch(`${url}.gz${query}`);
  if (!response.ok) throw new Error(`Unable to load ship model (${response.status}): ${url}`);
  let bytes = await response.arrayBuffer();
  const header = new Uint8Array(bytes, 0, Math.min(2, bytes.byteLength));
  // A host may already supply Content-Encoding: gzip, which fetch decodes.
  if (header[0] === 0x1f && header[1] === 0x8b) {
    bytes = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  }
  return loader.parseAsync(bytes, url.slice(0, url.lastIndexOf('/') + 1));
}
