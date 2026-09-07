import { expect, test } from 'bun:test';
import * as THREE from 'three/webgpu';
import { batchShipModel } from './ShipBatching';
import { loadShipGeometry } from '../../scripts/diagnostics/load-ship-geometry';
import { shipPresets, shipPreset } from '../ships/presets';
import { CombatSimulation } from '../simulation/combat';
import { ShipView } from './ShipView';

test('rigid batching preserves moving joints, sockets, materials and world geometry', () => {
  const root = new THREE.Group(), yaw = new THREE.Group(), recoil = new THREE.Group(), socket = new THREE.Object3D();
  yaw.userData.nodeId = 'main.yaw'; recoil.userData.nodeId = 'main.center.recoil'; socket.userData.nodeId = 'main.center.muzzle';
  root.add(yaw); yaw.add(recoil); recoil.add(socket); socket.position.z = -10;
  const material = new THREE.MeshStandardMaterial(), glass = new THREE.MeshStandardMaterial({ transparent: true, opacity: .5 });
  for (const parent of [root, yaw, recoil]) for (let i = 0; i < 4; i++) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 3), material);
    mesh.position.set(i * 2, 1, -i); parent.add(mesh);
  }
  const window = new THREE.Mesh(new THREE.BoxGeometry(), glass); root.add(window);
  const hull = new THREE.Mesh(new THREE.BoxGeometry(10, 4, 30), material); hull.userData.nodeId = 'hull.surface'; root.add(hull);
  const bounds = () => new THREE.Box3().setFromObject(root);
  const before = bounds(), ids: string[] = [];
  root.traverse(o => { if (o.userData.nodeId) ids.push(o.userData.nodeId); });
  const clone = root.clone(true);
  batchShipModel(root);
  let meshes = 0; const afterIds: string[] = [];
  root.traverse(o => { if ((o as THREE.Mesh).isMesh) meshes++; if (o.userData.nodeId) afterIds.push(o.userData.nodeId); });
  expect(meshes).toBe(5); expect(afterIds.sort()).toEqual(ids.sort());
  expect(window.parent).toBe(root); expect(hull.parent).toBe(root);
  expect(bounds().min.distanceTo(before.min)).toBeLessThan(1e-6);
  expect(bounds().max.distanceTo(before.max)).toBeLessThan(1e-6);
  yaw.rotation.y = .7; recoil.position.z = 2;
  const cloneNodes = new Map<string, THREE.Object3D>(); clone.traverse(o => { if (o.userData.nodeId) cloneNodes.set(o.userData.nodeId, o); });
  cloneNodes.get('main.yaw')!.rotation.y = .7; cloneNodes.get('main.center.recoil')!.position.z = 2;
  const expected = new THREE.Box3().setFromObject(clone);
  // Box3's default per-mesh boxes can differ after merging; compare precise vertices.
  const actual = new THREE.Box3().setFromObject(root, true), precise = new THREE.Box3().setFromObject(clone, true);
  expect(actual.min.distanceTo(precise.min)).toBeLessThan(1e-5);
  expect(actual.max.distanceTo(precise.max)).toBeLessThan(1e-5);
  expect(expected.isEmpty()).toBe(false);
  expect(socket.getWorldPosition(new THREE.Vector3()).distanceTo(cloneNodes.get('main.center.muzzle')!.getWorldPosition(new THREE.Vector3()))).toBeLessThan(1e-8);
});

for (const id of Object.keys(shipPresets)) test(`${id}: batched exported surfaces retain geometry and articulation`, async () => {
  const model = await loadShipGeometry(id), original = model.clone(true), definition = shipPreset(id);
  const triangles = (root: THREE.Object3D) => { let n = 0; root.traverse(o => { if (o instanceof THREE.Mesh) n += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3; }); return n; };
  const ids = (root: THREE.Object3D) => { const result: string[] = []; root.traverse(o => { if (o.userData.nodeId) result.push(o.userData.nodeId); }); return result.sort(); };
  const count = triangles(model), stableIds = ids(model);
  batchShipModel(model);
  expect(triangles(model)).toBe(count); expect(ids(model)).toEqual(stableIds);
  const sim = new CombatSimulation(definition);
  const reference = new ShipView(original, definition, sim.player), batched = new ShipView(model, definition, sim.player);
  for (const fraction of [-1, 0, 1]) {
    Object.assign(sim.player.motion, { x: 120, y: -3, z: 500, heading: 2.7, roll: .13, pitch: -.09 });
    sim.player.mounts.forEach((m, i) => { m.train = fraction * definition.mounts[i].weapon.traverseDeg * Math.PI / 180; m.elevation = .2; m.recoil = .8; });
    sim.player.torpedoLaunchers?.forEach(l => l.train = fraction * Math.PI / 2);
    reference.update(); batched.update();
    const a = new THREE.Box3().setFromObject(reference.root, true), b = new THREE.Box3().setFromObject(batched.root, true);
    expect(a.min.distanceTo(b.min)).toBeLessThan(.0001); expect(a.max.distanceTo(b.max)).toBeLessThan(.0001);
    expect(Math.max(0, ...batched.muzzleErrors(), ...batched.torpedoMuzzleErrors())).toBeLessThan(.025);
  }
  reference.impactMarks.dispose(); batched.impactMarks.dispose();
});
