import * as THREE from 'three';

/** Outline every mesh belonging to an item in ship coordinates, including
 * nested, rotated model parts and temporary loading proxies. */
export function itemOutlineGeometry(meshes: readonly THREE.Object3D[], id: string): THREE.BufferGeometry {
  const points: THREE.Vector3[] = [];
  for (const mesh of meshes) {
    if (!(mesh instanceof THREE.Mesh) || mesh.userData.sourceId !== id) continue;
    mesh.updateWorldMatrix(true, false);
    const edges = new THREE.EdgesGeometry(mesh.geometry);
    const positions = edges.getAttribute('position');
    for (let i = 0; i < positions.count; i++) {
      points.push(new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld));
    }
    edges.dispose();
  }
  return new THREE.BufferGeometry().setFromPoints(points);
}
