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
    scar.removeFromParent(); marks.length = 0; proxy.update(); expect(proxy.root.children).toHaveLength(0);
  } finally { proxy.dispose(); }
});
