import * as THREE from 'three/webgpu';
import type { ConstructionPropellerSupport, ConstructionSurfaceFinish, Vec3 } from '../ships/blueprint';
import { CONSTRUCTION_FINISH, constructionPaintColor, constructionFinishRoughness } from '../ships/constructionPaints';

type Member = ConstructionPropellerSupport['members'][number];
/** Join the native rings without internal caps. Only end caps have hard normals. */
export function propellerSupportGeometry(rings: readonly (readonly Vec3[])[]): THREE.BufferGeometry {
  const count = rings[0].length, positions = rings.flat(2), indices: number[] = [];
  for (let r = 0; r < rings.length - 1; r++) for (let i = 0; i < count; i++) {
    const a = r * count + i, b = r * count + (i + 1) % count;
    indices.push(a, b, b + count, a, b + count, a + count);
  }
  // Duplicate cap vertices so the shaft ends never round off into the bearings.
  for (const end of [0, rings.length - 1]) {
    const offset = positions.length / 3;
    positions.push(...rings[end].flat());
    for (let i = 1; i < count - 1; i++) indices.push(...(end === 0 ? [offset, offset + i + 1, offset + i] : [offset, offset + i, offset + i + 1]));
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}
function supportMesh(member: Member, finish?: ConstructionSurfaceFinish): THREE.Mesh {
  const start = new THREE.Vector3(...member.start), end = new THREE.Vector3(...member.end);
  const direction = end.clone().sub(start);
  const geometry = member.rings ? propellerSupportGeometry(member.rings)
    : new THREE.CylinderGeometry(member.radiusM, member.radiusM, direction.length(), 24);
  const shaft = member.kind === 'shaft';
  const material = new THREE.MeshStandardMaterial({
    color: shaft ? new THREE.Color(.32, .35, .34) : constructionPaintColor('red-oxide'),
    roughness: shaft ? .29 : constructionFinishRoughness(finish, CONSTRUCTION_FINISH.steelRoughness),
    metalness: shaft ? .82 : CONSTRUCTION_FINISH.metalness,
  });
  material.name = `construction.propeller.${shaft ? 'shaft-steel' : 'underwater-paint'}`;
  const mesh = new THREE.Mesh(geometry, material);
  if (!member.rings) {
    mesh.position.copy(start).add(end).multiplyScalar(.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  }
  return mesh;
}

/** Native members are in ship coordinates. The original .spin joint remains
 * independent: the faired housing and hull fins never rotate with the blades. */
export function createConstructionPropellerSupports(supports: readonly ConstructionPropellerSupport[] = [], finish?: ConstructionSurfaceFinish): THREE.Group {
  const group = new THREE.Group(); group.name = 'Propeller supports';
  for (const support of supports) {
    const assembly = new THREE.Group(); assembly.name = `${support.equipmentId}.supports`;
    assembly.userData = { sourceId: support.equipmentId, assemblyId: support.equipmentId };
    support.members.forEach((member, index) => {
      const mesh = supportMesh(member, finish);
      mesh.name = `${support.equipmentId}.support-${index}`;
      mesh.userData = { sourceId: support.equipmentId, assemblyId: support.equipmentId, nodeId: mesh.name, constructionEquipmentKind: 'propeller', supportKind: member.kind };
      mesh.castShadow = mesh.receiveShadow = true; assembly.add(mesh);
    });
    group.add(assembly);
  }
  return group;
}
