import { expect, test } from 'bun:test';
import * as THREE from 'three/webgpu';
import { loadShipGeometry } from '../../scripts/diagnostics/load-ship-geometry';
import { mixedSimulation } from '../../scripts/diagnostics/mixed-fleet';
import { ShipView } from './ShipView';
import { batchShipModel } from './ShipBatching';
import { ShipRenderProxy } from './ShipRenderProxy';

test('flat surfaces follow articulated joints and inspection without changing the authoring hierarchy', async () => {
  const simulation = mixedSimulation(), model = await loadShipGeometry('bismarck');
  batchShipModel(model);
  const view = new ShipView(model, simulation.definition, simulation.player);
  const parents = new Map<THREE.Object3D, THREE.Object3D | null>();
  model.traverse(o => parents.set(o, o.parent));
  const proxy = new ShipRenderProxy(view), position = new THREE.Vector3();
  try {
    Object.assign(simulation.player.motion, { x: 130, z: -670, heading: 1.2, roll: .08 });
    simulation.player.mounts.forEach(m => { m.train = .4; m.elevation = .2; m.recoil = .6; });
    view.update(); view.root.updateMatrixWorld(true); proxy.update(); proxy.root.updateMatrixWorld(true);
    const meshes = view.renderMeshes.map(s => s.mesh);
    expect(proxy.root.children.length).toBe(meshes.length);
    for (let i = 0; i < meshes.length; i++) {
      const copy = proxy.root.children[i] as THREE.Mesh;
      expect(copy.geometry).toBe(meshes[i].geometry); expect(copy.material).toBe(meshes[i].material);
      expect(position.setFromMatrixPosition(copy.matrixWorld).distanceTo(new THREE.Vector3().setFromMatrixPosition(meshes[i].matrixWorld))).toBeLessThan(1e-6);
    }
    expect(Math.max(...view.muzzleErrors())).toBeLessThan(.025);
    view.inspect(true); proxy.update();
    expect((proxy.root.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>).material.opacity).toBe(.16);
    view.root.visible = false; proxy.update(); expect(proxy.root.children).toHaveLength(0);
    view.root.visible = true; view.inspect(false); proxy.update(); expect(proxy.root.children.length).toBe(meshes.length);
    for (const [node, parent] of parents) expect(node.parent).toBe(parent);
  } finally { proxy.dispose(); view.impactMarks.dispose(); }
  expect(model.visible).toBe(true);
});

test('an unchanged frame rewrites no matrix, and a shared visibility cache matches the plain walk', () => {
  const root = new THREE.Group(), model = new THREE.Group(), hull = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
  const mast = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
  root.add(model); model.add(hull); hull.add(mast);
  const view = { root, model, impactMarks: { get renderMeshes() { return [].values(); } } } as unknown as ShipView;
  const proxy = new ShipRenderProxy(view);
  const cache = new Map<THREE.Object3D, boolean>();
  try {
    root.updateMatrixWorld(true); proxy.update(undefined, 1080, cache);
    proxy.root.updateMatrixWorld(true);
    const [hullProxy, mastProxy] = proxy.root.children as THREE.Mesh[];
    expect(hullProxy.matrixWorldNeedsUpdate).toBe(false);
    // Nothing moved: the pose already on the proxy stands, and three keeps its world matrix.
    cache.clear(); proxy.update(undefined, 1080, cache);
    expect(hullProxy.matrixWorldNeedsUpdate).toBe(false);
    expect(mastProxy.matrixWorldNeedsUpdate).toBe(false);
    // The shared ancestors are resolved once; a surface asked about once is not worth an entry.
    expect(cache.size).toBe(3);
    mast.rotation.y = .3; root.updateMatrixWorld(true);
    cache.clear(); proxy.update(undefined, 1080, cache);
    expect(hullProxy.matrixWorldNeedsUpdate).toBe(false);
    expect(mastProxy.matrixWorldNeedsUpdate).toBe(true);
    expect(mastProxy.matrix.elements).toEqual(mast.matrixWorld.elements);
    proxy.root.updateMatrixWorld(true);
    // Hiding a parent hides both copies through the cache, exactly as the uncached walk does.
    hull.visible = false;
    cache.clear(); proxy.update(undefined, 1080, cache);
    expect(proxy.root.children).toHaveLength(0);
    expect(proxy.sourceVisible(mast)).toBe(false);
    hull.visible = true; root.position.z = 90; root.updateMatrixWorld(true);
    cache.clear(); proxy.update(undefined, 1080, cache);
    expect(proxy.root.children).toHaveLength(2);
    for (const copy of proxy.root.children as THREE.Mesh[]) expect(copy.matrixWorldNeedsUpdate).toBe(true);
    proxy.root.updateMatrixWorld(true);
    expect(mastProxy.matrixWorld.elements).toEqual(mast.matrixWorld.elements);
  } finally { proxy.dispose(); }
});

test('impact proxies share scars, follow their receivers and retire when scars are cleared', () => {
  const root = new THREE.Group(), model = new THREE.Group(), receiver = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
  root.add(model); model.add(receiver);
  const scar = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshStandardMaterial()); receiver.add(scar);
  const marks = [scar];
  const view = { root, model, impactMarks: { get renderMeshes() { return marks.values(); } } } as unknown as ShipView;
  // Create the scar after the source surfaces are registered, as combat does.
  scar.removeFromParent();
  const proxy = new ShipRenderProxy(view); receiver.add(scar);
  try {
    receiver.layers.mask = 0; root.position.x = 37; receiver.rotation.y = .7;
    root.updateMatrixWorld(true); proxy.update(); proxy.root.updateMatrixWorld(true);
    expect(proxy.root.children).toHaveLength(1);
    const rendered = proxy.root.children[0] as THREE.Mesh;
    expect(rendered.geometry).toBe(scar.geometry); expect(rendered.matrixWorld.elements).toEqual(scar.matrixWorld.elements);
    scar.geometry.computeBoundingSphere(); scar.userData.maximumMarkDiameter = 1;
    const camera = new THREE.PerspectiveCamera(52, 16 / 9, .5, 60000);
    camera.position.set(37, 0, 5000); camera.lookAt(37, 0, 0); camera.updateMatrixWorld();
    proxy.update(camera, 1080); expect(proxy.root.children).toHaveLength(0);
    camera.zoom = 24; camera.updateProjectionMatrix();
    proxy.update(camera, 1080); expect(proxy.root.children).toHaveLength(1);
    expect((proxy.root.children[0] as THREE.Mesh).geometry).toBe(scar.geometry);
    scar.removeFromParent(); marks.length = 0; proxy.update(); expect(proxy.root.children).toHaveLength(0);
  } finally { proxy.dispose(); }
});
