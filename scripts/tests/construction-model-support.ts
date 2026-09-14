import * as THREE from 'three/webgpu';
import type { ConstructionCatalog, ConstructionSource } from '../../src/ships/blueprint';

/** Ray-test actual original sole vertices against rendered structural surfaces.
 * The small gap tolerance accounts for the inward shell skin and GLB rounding. */
export function installedSupportContacts(model: THREE.Group, source: ConstructionSource, catalog: ConstructionCatalog) {
  model.updateWorldMatrix(true, true);
  const hulls = model.children.filter((n): n is THREE.Mesh => n instanceof THREE.Mesh);
  return source.construction.equipment.map(instance => {
    const part = catalog.equipment.find(p => p.id === instance.partId)!;
    const socket = part.sockets?.find(s => s.id === 'attachment');
    if (!socket) throw new Error(`Missing support metadata ${instance.id}`);
    const installation = model.children.find(n => n.name === instance.id)!;
    const seat = installation.localToWorld(new THREE.Vector3(...socket.position));
    const direction = new THREE.Vector3(...socket.direction).transformDirection(installation.matrixWorld);
    let candidates = 0, contactVertices = 0, minimumGapM = Infinity;
    const ray = new THREE.Raycaster();
    installation.traverse(node => {
      if (!(node instanceof THREE.Mesh)) return;
      for (let i = 0; i < node.geometry.attributes.position.count; i++) {
        const point = node.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(node.matrixWorld);
        if (Math.abs(point.clone().sub(seat).dot(direction)) > .002) continue;
        candidates++;
        ray.set(point.clone().addScaledVector(direction, -.03), direction); ray.far = .08;
        const hit = ray.intersectObjects(hulls, false)[0];
        if (!hit) continue;
        const gap = Math.abs(hit.distance - .03); minimumGapM = Math.min(minimumGapM, gap);
        // Machinery sits on inward shell plating; exterior rendering is its outer face.
        if (gap <= (part.placement === 'internal' ? .02 : .003)) contactVertices++;
      }
    });
    return { id: instance.id, candidates, contactVertices, minimumGapM: Number.isFinite(minimumGapM) ? minimumGapM : null };
  });
}
