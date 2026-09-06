import * as THREE from 'three/webgpu';

const TRIANGLES_PER_CHUNK = 128;
const proxyMaterial = new THREE.MeshBasicMaterial();
interface SurfaceChunk { first: number; end: number; bounds: THREE.Box3; proxy: THREE.Mesh; }
const cache = new WeakMap<THREE.BufferGeometry, SurfaceChunk[]>();

/** Shared immutable GLTF geometry: small contiguous triangle ranges for local
 * hit queries. Proxies share attributes and never enter a rendered scene. */
export function surfaceChunks(source: THREE.BufferGeometry): readonly SurfaceChunk[] {
  const cached = cache.get(source); if (cached) return cached;
  const positions = source.getAttribute('position'), index = source.index;
  const count = Math.min(index?.count ?? positions.count, source.drawRange.start + source.drawRange.count);
  const chunks: SurfaceChunk[] = [], point = new THREE.Vector3();
  for (let first = source.drawRange.start; first < count; first += TRIANGLES_PER_CHUNK * 3) {
    const end = Math.min(count, first + TRIANGLES_PER_CHUNK * 3), bounds = new THREE.Box3();
    for (let i = first; i < end; i++) bounds.expandByPoint(point.fromBufferAttribute(positions, index ? index.getX(i) : i));
    const geometry = new THREE.BufferGeometry();
    for (const [name, attribute] of Object.entries(source.attributes)) geometry.setAttribute(name, attribute);
    geometry.setIndex(index); geometry.groups = source.groups; geometry.setDrawRange(first, end - first);
    geometry.boundingBox = bounds; geometry.boundingSphere = bounds.getBoundingSphere(new THREE.Sphere());
    chunks.push({ first, end, bounds, proxy: new THREE.Mesh(geometry, proxyMaterial) });
  }
  cache.set(source, chunks); return chunks;
}

/** Preserve Three's face/material/UV rules and original face indices while
 * rejecting distant ranges before its per-triangle ray tests. */
export function raycastSurface(mesh: THREE.Mesh, raycaster: THREE.Raycaster): THREE.Intersection<THREE.Object3D>[] {
  const hits: THREE.Intersection<THREE.Object3D>[] = [];
  const localRay = raycaster.ray.clone().applyMatrix4(mesh.matrixWorld.clone().invert());
  for (const { proxy, bounds } of surfaceChunks(mesh.geometry)) {
    if (!localRay.intersectsBox(bounds)) continue;
    proxy.material = mesh.material; proxy.matrixWorld.copy(mesh.matrixWorld);
    proxy.raycast(raycaster, hits);
  }
  for (const hit of hits) hit.object = mesh;
  return hits;
}
