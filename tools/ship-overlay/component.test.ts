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

test('canvas interpolates through depression, zero and intermediate elevation without moving its fixed seam', () => {
  const root = new THREE.Group();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, -5, 0], 3));
  geometry.morphAttributes.position = [0, 5, 13].map(angle => new THREE.Float32BufferAttribute([0, 0, 0, 1, angle, 0], 3));
  const cover = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  cover.userData = { gunCoverElevationId: 'aa.center.elevation', gunCoverBaseAngle: -5, gunCoverAngles: [0, 5, 13] };
  root.add(cover);
  const weapon = { ...catalog.parts.find(p => p.id === 'oerlikon-20mm-single')!, elevationMinDeg: -5, elevationMaxDeg: 13 } as GunPart;
  const articulation = new ComponentArticulation(root, 'aa');
  for (const angle of [-5, -2.5, 0, 2.5, 5, 9, 13]) {
    articulation.pose(weapon, 25, angle, 1);
    const seam = new THREE.Vector3(), cuff = new THREE.Vector3();
    cover.getVertexPosition(0, seam); cover.getVertexPosition(1, cuff);
    expect(seam.length()).toBe(0);
    expect(cuff.y).toBeCloseTo(angle);
  }
  articulation.pose(weapon, 0, -5, 0);
  expect(cover.morphTargetInfluences).toEqual([0, 0, 0]);
});
