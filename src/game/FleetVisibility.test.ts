import { expect, test } from 'bun:test';
import * as THREE from 'three/webgpu';
import { articulatedRadius, FleetVisibility } from './FleetVisibility';
import { FocusShadowNode } from './FocusShadowNode';
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
  const sun = new FocusShadowNode(light), visibility = new FleetVisibility();
  root.position.z = 150; visibility.update([view], camera, sun);
  expect(view.renderActive).toBe(true); // Behind the camera, inside the sun's volume.
  light.castShadow = false; visibility.update([view], camera, sun); expect(view.renderActive).toBe(false);
  root.position.set(8000, 0, -2000); light.castShadow = true;
  visibility.update([view], camera, sun); expect(view.renderActive).toBe(false); expect(rig.root.visible).toBe(false);
  camera.lookAt(root.position); camera.updateMatrixWorld(true);
  visibility.update([view], camera, sun); expect(view.renderActive).toBe(true); expect(rig.root.visible).toBe(true);
  camera.lookAt(0, 0, -100); camera.updateMatrixWorld(true);
  view.inspection.mode = 'armor'; visibility.update([view], camera, sun);
  expect(view.renderActive).toBe(true); expect(rig.root.visible).toBe(false);
  view.inspection.mode = 'exterior'; visibility.update([view], camera, sun, true); expect(view.renderActive).toBe(true);
  mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose();
});

test('ships in view beyond the wide map get view shadow maps that hold them, stretched by binoculars', () => {
  const ship = (x: number, z: number) => {
    const root = new THREE.Group(), model = new THREE.Group(), rig = { root: new THREE.Group() };
    model.add(new THREE.Mesh(new THREE.BoxGeometry(12, 30, 200))); root.add(model, rig.root); root.position.set(x, 0, z);
    return { root, model, rig, definition: { mounts: [] }, inspection: { mode: 'exterior' }, renderActive: true } as unknown as ShipView;
  };
  const camera = new THREE.PerspectiveCamera(52, 16 / 9, .5, 60000);
  camera.position.set(0, 40, 350); camera.lookAt(0, 0, -3000); camera.updateMatrixWorld(true);
  const light = new THREE.DirectionalLight(); light.castShadow = true; light.position.set(200, 300, -250); light.shadow.mapSize.set(2048, 2048);
  Object.assign(light.shadow.camera, { left: -380, right: 380, bottom: -380, top: 380, near: 1, far: 1800 });
  light.shadow.camera.updateProjectionMatrix();
  const sun = new FocusShadowNode(light), visibility = new FleetVisibility();
  const own = ship(0, 0), neighbour = ship(-500, -600), enemy = ship(150, -3000), horizon = ship(-400, -8000);
  const holds = (index: number, view: ShipView) => {
    const cascade = sun.views[index]!.light;
    cascade.updateWorldMatrix(true, false); cascade.target.updateWorldMatrix(true, false);
    cascade.shadow.updateMatrices(cascade as unknown as THREE.DirectionalLight);
    const frustum = cascade.shadow.getFrustum(), point = new THREE.Vector3();
    return [[0, 0, 0], [100, 0, 0], [-100, 0, 0], [0, 0, 100], [0, 0, -100], [0, 15, 0]].every(([x, y, z]) =>
      frustum.containsPoint(point.set(x!, y!, z!).add(view.root.position)));
  };
  visibility.update([own], camera, sun);
  expect(sun.views.map(view => view.active)).toEqual([false, false]); // The wide map already holds her.
  // One view map draws a frame, the stalest first.
  visibility.update([own, neighbour, enemy, horizon], camera, sun);
  expect(sun.views.map(view => view.active)).toEqual([true, false]);
  visibility.update([own, neighbour, enemy, horizon], camera, sun);
  expect(sun.views.map(view => view.active)).toEqual([true, true]);
  expect(holds(0, neighbour)).toBe(true);
  expect(holds(1, enemy)).toBe(true);
  expect(holds(1, horizon)).toBe(false); // Too far to show a shadow at 1×.
  visibility.update([own, neighbour, enemy, horizon], camera, sun, false, 4);
  expect(holds(1, horizon)).toBe(false); // Band 1 drew this frame; band 2 keeps the fit it was drawn with.
  visibility.update([own, neighbour, enemy, horizon], camera, sun, false, 4);
  expect(holds(1, horizon)).toBe(true);
  expect(sun.activeViews).toHaveLength(2);
  visibility.update([own], camera, sun);
  expect(sun.activeViews).toHaveLength(0); // Emptied bands stop sampling at once.
  light.shadow.mapSize.set(1024, 1024); // The Low setting keeps to the near and wide maps.
  visibility.update([own, neighbour, enemy, horizon], camera, sun);
  expect(sun.activeViews).toHaveLength(0);
});
