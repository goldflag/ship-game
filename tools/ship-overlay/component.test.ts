import { test, expect } from 'bun:test';
import * as THREE from 'three';
import { ComponentArticulation, isolateAssembly } from './component';
import catalog from '../../assets/parts/guns.json';
import type { GunPart } from '../../src/ships/blueprint';

test('isolation keeps fixed attachments and articulated descendants at a neutral mount datum', () => {
  const scene = new THREE.Group(), mount = new THREE.Group(), yaw = new THREE.Group();
  mount.position.set(20, 8, -60); scene.add(mount); mount.add(yaw);
  yaw.rotation.y = Math.PI / 2; yaw.userData.nodeId = 'aa.yaw'; yaw.userData.assemblyId = 'aa';
  const body = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()); body.userData.assemblyId = 'aa'; yaw.add(body);
  const fixed = body.clone(); mount.add(fixed);
  const multiMaterial = new THREE.Group(); multiMaterial.userData.assemblyId = 'aa'; yaw.add(multiMaterial);
  const primitive = body.clone(); primitive.userData = {}; multiMaterial.add(primitive);
  const other = body.clone(); other.userData.assemblyId = 'neighbor'; scene.add(other);
  const frame = isolateAssembly(scene, 'aa'); frame.updateMatrixWorld(true);
  expect(yaw.getWorldPosition(new THREE.Vector3()).length()).toBeLessThan(1e-6);
  expect(yaw.getWorldQuaternion(new THREE.Quaternion()).angleTo(new THREE.Quaternion())).toBeLessThan(1e-6);
  expect(fixed.parent).toBe(mount); expect(other.parent).toBeNull();
  expect(primitive.parent).toBe(multiMaterial);
});
test('missing assembly fails instead of silently showing the whole ship', () => {
  expect(() => isolateAssembly(new THREE.Group(), 'missing')).toThrow('no missing.yaw');
});
test('elevation and recoil follow the articulated bore and reset without accumulating transforms', () => {
  const root = new THREE.Group(), yaw = new THREE.Group(), elevation = new THREE.Group(), recoil = new THREE.Group(), muzzle = new THREE.Group();
  root.add(yaw); yaw.add(elevation); elevation.add(recoil); recoil.add(muzzle); muzzle.position.z = -2;
  yaw.userData.nodeId = 'aa.yaw'; elevation.userData.nodeId = 'aa.center.elevation'; recoil.userData.nodeId = 'aa.center.recoil';
  elevation.rotation.x = THREE.MathUtils.degToRad(1);
  const weapon = catalog.parts.find(p => p.id === 'oerlikon-20mm-single') as GunPart;
  const pose = new ComponentArticulation(root, 'aa');
  pose.pose(weapon, 0, 45, 1); root.updateMatrixWorld(true);
  expect(muzzle.getWorldPosition(new THREE.Vector3()).y).toBeGreaterThan(1);
  expect(recoil.position.z).toBeCloseTo(weapon.recoilM);
  pose.pose(weapon, 0, 0, 0); root.updateMatrixWorld(true);
  expect(muzzle.getWorldPosition(new THREE.Vector3()).y).toBeCloseTo(0);
  expect(recoil.position.z).toBe(0);
  pose.pose(weapon, 0, 0, 0); expect(elevation.rotation.x).toBeCloseTo(0);
});

test('gun covers follow elevation from a depressed base shape and reset with the barrels', () => {
  const root = new THREE.Group(), elevation = new THREE.Group();
  elevation.userData.nodeId = 'main.left.elevation'; root.add(elevation);
  const cover = new THREE.Mesh(new THREE.BufferGeometry());
  cover.userData = { gunCoverElevationId: 'main.left.elevation', gunCoverBaseAngle: -5, gunCoverAngles: [0, 20, 45] };
  cover.morphTargetInfluences = [0, 0, 0]; root.add(cover);
  const weapon = catalog.parts.find(p => p.id === 'type41-356-kongo-twin') as GunPart;
  const pose = new ComponentArticulation(root, 'main');
  for (const [angle, expected] of [
    [10, [.5, .5, 0]], [43, [0, .08, .92]],
    [-2.5, [.5, 0, 0]], [-5, [0, 0, 0]], [0, [1, 0, 0]],
  ] as const) {
    pose.pose(weapon, 0, angle, 1);
    expect(elevation.rotation.x).toBeCloseTo(THREE.MathUtils.degToRad(angle));
    expected.forEach((weight, i) => expect(cover.morphTargetInfluences![i]).toBeCloseTo(weight));
  }
});
