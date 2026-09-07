import * as THREE from 'three/webgpu';
import { MeshoptSimplifier } from 'meshoptimizer';

export type ShipDetailLevel = { geometry: THREE.BufferGeometry; error: number };
const levels = new WeakMap<THREE.BufferGeometry, ShipDetailLevel[]>();

/** Derived render buffers only. Original geometry remains the close-view,
 * inspection and decal surface; all joints and combat geometry are untouched. */
export async function prepareShipDetail(root: THREE.Object3D): Promise<void> {
  if (!MeshoptSimplifier.supported) return;
  await MeshoptSimplifier.ready;
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh) || Array.isArray(object.material) || object.material.transparent ||
      (object as THREE.SkinnedMesh).isSkinnedMesh || object.morphTargetInfluences?.length) return;
    const geometry = object.geometry;
    if (levels.has(geometry)) return;
    const result: ShipDetailLevel[] = [{ geometry, error: 0 }];
    levels.set(geometry, result);
    const position = geometry.getAttribute('position');
    if (!geometry.index || position.itemSize !== 3 || position.array.constructor !== Float32Array ||
      Object.values(geometry.attributes).some(a => (a as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute) ||
      geometry.index.count < 180 || geometry.drawRange.start !== 0 || geometry.drawRange.count !== Infinity) return;
    const positions = position.array as Float32Array;
    const indices = Uint32Array.from(geometry.index.array);
    const scale = MeshoptSimplifier.getScale(positions, 3);
    // Preserve normal/UV seams in the error metric as well as surface shape.
    const attributes = ['normal', 'uv', 'color', 'shipSurface'].flatMap(name => geometry.hasAttribute(name) ? [geometry.getAttribute(name)] : []);
    const stride = attributes.reduce((n, a) => n + a.itemSize, 0);
    const values = new Float32Array(position.count * stride);
    const weights = attributes.flatMap(a => Array<number>(a.itemSize).fill(a === geometry.getAttribute('color') || a === geometry.getAttribute('shipSurface') ? 1 : .02));
    for (let vertex = 0; vertex < position.count; vertex++) {
      let offset = vertex * stride;
      for (const attribute of attributes) for (let component = 0; component < attribute.itemSize; component++) {
        values[offset++] = attribute.getComponent(vertex, component);
      }
    }
    for (const [ratio, tolerance] of [[.25, .004], [.08, .02]]) {
      const target = Math.floor(indices.length * ratio / 3) * 3;
      const [reduced, error] = stride
        ? MeshoptSimplifier.simplifyWithAttributes(indices, positions, 3, values, stride, weights, null, target, tolerance, ['Permissive'])
        : MeshoptSimplifier.simplify(indices, positions, 3, target, tolerance, ['Permissive']);
      if (reduced.length >= result.at(-1)!.geometry.index!.count * .9 || reduced.length === 0) continue;
      const [remap, count] = MeshoptSimplifier.compactMesh(reduced);
      const detail = new THREE.BufferGeometry();
      detail.setIndex(new THREE.BufferAttribute(reduced, 1));
      for (const [name, attribute] of Object.entries(geometry.attributes)) {
        const source = attribute as THREE.BufferAttribute;
        const array = source.array.slice(0, count * source.itemSize);
        for (let i = 0; i < remap.length; i++) if (remap[i] < count) {
          for (let c = 0; c < source.itemSize; c++) array[remap[i] * source.itemSize + c] = source.array[i * source.itemSize + c];
        }
        detail.setAttribute(name, new THREE.BufferAttribute(array, source.itemSize, source.normalized));
      }
      detail.computeBoundingBox(); detail.computeBoundingSphere();
      result.push({ geometry: detail, error: error * scale });
    }
  });
}

export function shipDetailLevels(geometry: THREE.BufferGeometry): readonly ShipDetailLevel[] {
  return levels.get(geometry) ?? [{ geometry, error: 0 }];
}

/** Derived rigid assemblies carry the largest transformed error of their parts. */
export function registerShipDetailLevels(geometry: THREE.BufferGeometry, detail: ShipDetailLevel[]): void {
  levels.set(geometry, detail);
}
