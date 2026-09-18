import * as THREE from 'three/webgpu';
import type { ConstructionPropellerSupport, ConstructionSurfaceFinish } from '../ships/blueprint';
import { CONSTRUCTION_FINISH, constructionPaintColor, constructionFinishRoughness } from '../ships/constructionPaints';

/** Native fitted members are already in ship coordinates. The original .spin
 * joint remains independent: hull braces never rotate with the blades. */
export function createConstructionPropellerSupports(supports: readonly ConstructionPropellerSupport[] = [], finish?: ConstructionSurfaceFinish): THREE.Group {
  const group = new THREE.Group(); group.name = 'Propeller supports';
  for (const support of supports) {
    const assembly = new THREE.Group(); assembly.name = `${support.equipmentId}.supports`;
    assembly.userData = { sourceId: support.equipmentId, assemblyId: support.equipmentId };
    support.members.forEach((member, index) => {
      const start = new THREE.Vector3(...member.start), end = new THREE.Vector3(...member.end);
      const direction = end.clone().sub(start);
      const geometry = new THREE.CylinderGeometry(member.radiusM, member.radiusM, direction.length(), 24);
      const material = new THREE.MeshStandardMaterial({ color: constructionPaintColor(member.kind === 'shaft' ? 'dark-gray' : 'red-oxide'), roughness: constructionFinishRoughness(finish, CONSTRUCTION_FINISH.steelRoughness), metalness: CONSTRUCTION_FINISH.metalness });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = `${support.equipmentId}.support-${index}`;
      mesh.position.copy(start).add(end).multiplyScalar(.5);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
      mesh.userData = { sourceId: support.equipmentId, assemblyId: support.equipmentId, nodeId: mesh.name, constructionEquipmentKind: 'propeller' };
      mesh.castShadow = mesh.receiveShadow = true; assembly.add(mesh);
    });
    group.add(assembly);
  }
  return group;
}
