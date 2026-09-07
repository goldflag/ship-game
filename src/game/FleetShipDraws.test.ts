import { expect, test } from 'bun:test';
import * as THREE from 'three/webgpu';
import { loadShipGeometry } from '../../scripts/diagnostics/load-ship-geometry';
import { mixedSimulation } from '../../scripts/diagnostics/mixed-fleet';
import { ShipView } from './ShipView';
import { batchShipModel } from './ShipBatching';
import { FleetShipDraws } from './FleetShipDraws';

test('fleet instances preserve separate poses, inspection, hidden hulls and damage-mark children', async () => {
  const sim = mixedSimulation(), actors = [sim.player, sim.actors[10]], model = await loadShipGeometry('bismarck');
  batchShipModel(model);
  const views = actors.map(a => new ShipView(model.clone(true), a.definition, a));
  const draws = new FleetShipDraws(views), matrix = new THREE.Matrix4();
  const batches = draws.root.children.filter(o => o instanceof THREE.BatchedMesh) as THREE.BatchedMesh[];
  expect(batches.length).toBeGreaterThan(0);
  Object.assign(actors[1].motion, { x: 600, z: -5000, y: -2, heading: 2.4, roll: .15 });
  actors[1].mounts.forEach(m => { m.train = .4; m.elevation = .3; m.recoil = .7; });
  views.forEach(v => { v.update(); v.root.updateMatrixWorld(true); });
  draws.update();
  const actual = new THREE.Box3(), expected = new THREE.Box3(), point = new THREE.Vector3();
  let actualVertices = 0, expectedVertices = 0;
  for (const batch of batches) for (let instance = 0; instance < batch.instanceCount; instance++) {
    batch.getMatrixAt(instance, matrix);
    expect(matrix.elements.every(Number.isFinite)).toBe(true); expect(batch.getVisibleAt(instance)).toBe(true);
    const range = batch.getGeometryRangeAt(batch.getGeometryIdAt(instance))!;
    actualVertices += range.vertexCount;
    for (let vertex = range.vertexStart; vertex < range.vertexStart + range.vertexCount; vertex++) {
      actual.expandByPoint(point.fromBufferAttribute(batch.geometry.attributes.position, vertex).applyMatrix4(matrix));
    }
  }
  for (const view of views) for (const { mesh } of view.renderMeshes) {
    expect(mesh.layers.mask).toBe(0);
    const positions = mesh.geometry.attributes.position; expectedVertices += positions.count;
    for (let vertex = 0; vertex < positions.count; vertex++) expected.expandByPoint(point.fromBufferAttribute(positions, vertex).applyMatrix4(mesh.matrixWorld));
  }
  expect(actualVertices).toBe(expectedVertices);
  expect(actual.min.distanceTo(expected.min)).toBeLessThan(.001);
  expect(actual.max.distanceTo(expected.max)).toBeLessThan(.001);
  const fullCount = draws.diagnostics().instances;
  const receiver = views[0].renderMeshes[0].mesh, mark = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial());
  receiver.add(mark); draws.update(); expect(mark.layers.mask).toBe(1); expect(receiver.visible).toBe(true);
  views[1].root.visible = false; draws.update(); expect(draws.diagnostics().instances).toBe(fullCount / 2);
  views[1].root.visible = true; views[0].inspect(true); draws.update();
  expect(draws.diagnostics().instances).toBe(fullCount / 2); expect(receiver.layers.mask).toBe(1);
  expect((views[0].renderMeshes[0].material as THREE.MeshStandardMaterial).opacity).toBe(1);
  views[0].inspect(false); draws.update(); expect(draws.diagnostics().instances).toBe(fullCount);
  draws.dispose(); expect(receiver.layers.mask).toBe(1); expect(draws.root.children).toHaveLength(0);
  views.forEach(v => v.impactMarks.dispose());
});

test('hiding one fixed component restores the remaining original surfaces without dropping the assembly', () => {
  const root = new THREE.Group(), model = new THREE.Group(), material = new THREE.MeshStandardMaterial();
  const a = new THREE.Mesh(new THREE.BoxGeometry(), material), b = new THREE.Mesh(new THREE.BoxGeometry(), material);
  b.position.x = 4; b.updateMatrix(); a.matrixAutoUpdate = b.matrixAutoUpdate = model.matrixAutoUpdate = false;
  root.add(model); model.add(a, b); root.updateMatrixWorld(true);
  const view = { root, model, renderMeshes: [a, b].map(mesh => ({ mesh, material })), inspection: { mode: 'exterior' }, impactMarks: { renderMeshes: [] } } as unknown as ShipView;
  const draws = new FleetShipDraws([view]);
  draws.update(); expect(draws.diagnostics().instances).toBe(1); expect(b.layers.mask).toBe(0);
  a.visible = false; draws.update();
  expect(draws.diagnostics().instances).toBe(0); expect(b.layers.mask).toBe(1);
  const proxyRoot = draws.root.children.find(c => !(c instanceof THREE.BatchedMesh))!;
  expect(proxyRoot.children).toHaveLength(1);
  expect((proxyRoot.children[0] as THREE.Mesh).geometry).toBe(b.geometry);
  a.visible = true; draws.update(); expect(draws.diagnostics().instances).toBe(1); expect(proxyRoot.children).toHaveLength(0);
  draws.dispose(); expect(model.children).toEqual([a, b]);
});
