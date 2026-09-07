import * as THREE from 'three/webgpu';

const TRIANGLES_PER_CHUNK = 128;
interface SurfaceChunk { first: number; end: number; bounds: THREE.Box3; }
const cache = new WeakMap<THREE.BufferGeometry, SurfaceChunk[]>();

/** Shared immutable GLTF geometry: small contiguous triangle ranges for local
 * hit queries. Store only bounds, not a Mesh and BufferGeometry per 128 triangles. */
export function surfaceChunks(source: THREE.BufferGeometry): readonly SurfaceChunk[] {
  const cached = cache.get(source); if (cached) return cached;
  const positions = source.getAttribute('position'), index = source.index;
  const count = Math.min(index?.count ?? positions.count, source.drawRange.start + source.drawRange.count);
  const chunks: SurfaceChunk[] = [], point = new THREE.Vector3();
  for (let first = source.drawRange.start; first < count; first += TRIANGLES_PER_CHUNK * 3) {
    const end = Math.min(count, first + TRIANGLES_PER_CHUNK * 3), bounds = new THREE.Box3();
    for (let i = first; i < end; i++) bounds.expandByPoint(point.fromBufferAttribute(positions, index ? index.getX(i) : i));
    chunks.push({ first, end, bounds });
  }
  cache.set(source, chunks); return chunks;
}

/** Preserve Three's face/material/UV rules and original face indices while
 * rejecting distant ranges before its per-triangle ray tests. */
export function raycastSurface(mesh: THREE.Mesh, raycaster: THREE.Raycaster): THREE.Intersection<THREE.Object3D>[] {
  const hits: THREE.Intersection<THREE.Object3D>[] = [];
  const localRay = raycaster.ray.clone().applyMatrix4(mesh.matrixWorld.clone().invert());
  // One short-lived proxy shares source buffers for the entire query. It never
  // reaches the renderer or keeps a ship's inspection material in the cache.
  const geometry = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(mesh.geometry.attributes)) geometry.setAttribute(name, attribute);
  geometry.setIndex(mesh.geometry.index); geometry.groups = mesh.geometry.groups;
  const proxy = new THREE.Mesh(geometry, mesh.material);
  proxy.matrixWorld.copy(mesh.matrixWorld);
  const sphere = new THREE.Sphere();
  for (const { first, end, bounds } of surfaceChunks(mesh.geometry)) {
    if (!localRay.intersectsBox(bounds)) continue;
    geometry.setDrawRange(first, end - first);
    geometry.boundingBox = bounds; geometry.boundingSphere = bounds.getBoundingSphere(sphere);
    proxy.raycast(raycaster, hits);
  }
  for (const hit of hits) hit.object = mesh;
  return hits;
}
