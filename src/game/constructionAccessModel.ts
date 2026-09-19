import * as THREE from 'three';
import { accessMemberAxes, type AccessLayout } from '../../assets/parts/construction/access_geometry';
import { componentMaterial } from '../ships/componentMaterials';

/** Shared renderer for the editor and portable ship export. */
export function createAccessModel(layout: AccessLayout, ghost = false): THREE.Group {
  const group = new THREE.Group(), surface = componentMaterial('naval');
  const material = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(...surface.color as [number,number,number]), roughness: surface.roughness, metalness: surface.metallic, transparent: ghost, opacity: ghost ? .6 : 1, depthWrite: !ghost });
  material.userData = surface.userData;
  const box = new THREE.BoxGeometry(1, 1, 1), rod = new THREE.CylinderGeometry(.5, .5, 1, 8).rotateX(Math.PI / 2);
  for (const member of layout.members) {
    const axes = accessMemberAxes(member).map(p => new THREE.Vector3(...p));
    const mesh = new THREE.Mesh(member.round ? rod : box, material);
    mesh.name = member.name;
    mesh.position.fromArray(member.a).add(new THREE.Vector3(...member.b)).multiplyScalar(.5);
    mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(...axes as [THREE.Vector3,THREE.Vector3,THREE.Vector3]));
    mesh.scale.set(member.width, member.depth, new THREE.Vector3(...member.a).distanceTo(new THREE.Vector3(...member.b)));
    mesh.castShadow = mesh.receiveShadow = true; group.add(mesh);
  }
  return group;
}
