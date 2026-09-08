import { expect, test } from 'bun:test';
import * as THREE from 'three/webgpu';
import { articulatedRadius, FleetVisibility } from './FleetVisibility';
import type { ShipView } from './ShipView';

test('articulated bounds enclose intermediate rotation, recoil and scaled geometry', () => {
  const root = new THREE.Group(), yaw = new THREE.Group(), recoil = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(4, 5, 20));
  yaw.position.set(12, 8, -60); yaw.scale.set(1, 2, 1);
  recoil.userData.nodeId = 'gun.port.recoil';
  mesh.position.set(2, 0, -8); mesh.scale.set(-1, 1, 2);
  root.add(yaw); yaw.add(recoil); recoil.add(mesh);
  const radius = articulatedRadius(root, 3), point = new THREE.Vector3();
  for (let i = 0; i < 19; i++) {
    yaw.rotation.set(i * .12, i * .37, i * .08); recoil.position.z = i % 4;
    root.updateMatrixWorld(true);
    const vertices = mesh.geometry.attributes.position;
    for (let v = 0; v < vertices.count; v++) {
      point.fromBufferAttribute(vertices, v).applyMatrix4(mesh.matrixWorld);
      expect(point.length()).toBeLessThanOrEqual(radius);
    }
  }
  mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose();
});

test('whole-ship culling retains offscreen shadow casters and restores camera and inspection views', () => {
  const root = new THREE.Group(), model = new THREE.Group(), rig = { root: new THREE.Group() };
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(10, 20, 80)); model.add(mesh); root.add(model, rig.root);
  const view = { root, model, rig, definition: { mounts: [] }, inspection: { mode: 'exterior' }, renderActive: true } as unknown as ShipView;
  const camera = new THREE.PerspectiveCamera(60, 1, 1, 20000); camera.updateMatrixWorld(true);
  const light = new THREE.DirectionalLight(); light.castShadow = true; light.position.set(300, 500, 300);
  Object.assign(light.shadow.camera, { left: -380, right: 380, bottom: -380, top: 380, near: 1, far: 1800 });
  light.shadow.camera.updateProjectionMatrix();
  const visibility = new FleetVisibility();
  root.position.z = 150; visibility.update([view], camera, light);
  expect(view.renderActive).toBe(true); // Behind the camera, inside the sun's volume.
  light.castShadow = false; visibility.update([view], camera, light); expect(view.renderActive).toBe(false);
  root.position.set(8000, 0, -2000); light.castShadow = true;
  visibility.update([view], camera, light); expect(view.renderActive).toBe(false); expect(rig.root.visible).toBe(false);
  camera.lookAt(root.position); camera.updateMatrixWorld(true);
  visibility.update([view], camera, light); expect(view.renderActive).toBe(true); expect(rig.root.visible).toBe(true);
  camera.lookAt(0, 0, -100); camera.updateMatrixWorld(true);
  view.inspection.mode = 'armor'; visibility.update([view], camera, light);
  expect(view.renderActive).toBe(true); expect(rig.root.visible).toBe(false);
  view.inspection.mode = 'exterior'; visibility.update([view], camera, light, true); expect(view.renderActive).toBe(true);
  mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose();
});
