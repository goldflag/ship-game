import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Prepare an unshared GLTF template once, before fleet cloning. Only rigid,
 * opaque surfaces with identical materials/layouts are joined. All authored
 * IDs, joint/socket objects and their parent chains remain intact. */
export function batchShipModel(root: THREE.Group): void {
  root.updateMatrixWorld(true);
  const groups = new Map<THREE.Object3D, Map<string, THREE.Mesh[]>>();
  const visit = (object: THREE.Object3D, owner: THREE.Object3D) => {
    if (!object.visible) return;
    if (object.userData.nodeId) owner = object;
    if (object instanceof THREE.Mesh && !object.userData.nodeId && !object.children.length &&
      !(object as THREE.SkinnedMesh).isSkinnedMesh && !(object as THREE.InstancedMesh).isInstancedMesh &&
      !object.morphTargetInfluences?.length && !Array.isArray(object.material) && !object.material.transparent &&
      object.renderOrder === 0 &&
      object.geometry.drawRange.start === 0 && object.geometry.drawRange.count === Infinity) {
      const geometry: THREE.BufferGeometry = object.geometry;
      const transform = new THREE.Matrix4().copy(owner.matrixWorld).invert().multiply(object.matrixWorld);
      // Mirrored winding needs a separate draw's front-face state.
      if (transform.determinant() > 0) {
        const layout = Object.entries(geometry.attributes).map(([name, a]) => `${name}:${a.itemSize}:${a.normalized}:${a.array.constructor.name}`).sort().join('/');
        const key = `${object.material.uuid}:${!!geometry.index}:${layout}:${object.castShadow}:${object.receiveShadow}:${object.layers.mask}`;
        let group = groups.get(owner); if (!group) groups.set(owner, group = new Map());
        const meshes = group.get(key); if (meshes) meshes.push(object); else group.set(key, [object]);
      }
    }
    for (const child of object.children) visit(child, owner);
  };
  visit(root, root);
  const retired = new Set<THREE.BufferGeometry>();
  for (const [owner, groupsByMaterial] of groups) for (const meshes of groupsByMaterial.values()) {
    if (meshes.length < 2) continue;
    const inverse = new THREE.Matrix4().copy(owner.matrixWorld).invert();
    const geometries = meshes.map(mesh => mesh.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld)));
    const merged = mergeGeometries(geometries);
    geometries.forEach(geometry => geometry.dispose());
    if (!merged) continue;
    merged.computeBoundingBox(); merged.computeBoundingSphere();
    const source = meshes[0], batch = new THREE.Mesh(merged, source.material);
    batch.name = `Rigid surfaces · ${(source.material as THREE.Material).name}`;
    batch.castShadow = source.castShadow; batch.receiveShadow = source.receiveShadow; batch.layers.mask = source.layers.mask;
    for (const mesh of meshes) { retired.add(mesh.geometry); mesh.removeFromParent(); }
    owner.add(batch);
  }
  root.traverse(object => { if (object instanceof THREE.Mesh) retired.delete(object.geometry); });
  retired.forEach(geometry => geometry.dispose());
}
