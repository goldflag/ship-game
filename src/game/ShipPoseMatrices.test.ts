import { expect, test } from 'bun:test';
import * as THREE from 'three/webgpu';
import { loadShipGeometry } from '../../scripts/diagnostics/load-ship-geometry';
import { mixedSimulation } from '../../scripts/diagnostics/mixed-fleet';
import { ShipView } from './ShipView';
import { batchShipModel } from './ShipBatching';
import { ShipMaterialPalette } from './ShipMaterialPalette';

test('compiled render poses match the retained hierarchy through motion and articulation', async () => {
  const sim = mixedSimulation();
  for (const actor of sim.actors.slice(0, 10)) {
    const model = await loadShipGeometry(actor.definition.id);
    new ShipMaterialPalette().apply(model); batchShipModel(model);
    const view = new ShipView(model, actor.definition, actor);
    for (const turn of [-1, 0, 1]) {
      Object.assign(actor.motion, { x: 12345, y: -1.3, z: -5432, heading: turn * 2.4, roll: .3, pitch: -.12, rudder: turn, distance: 60, speed: 4 });
      actor.mounts.forEach(m => Object.assign(m, { train: turn * 1.7, elevation: .6, recoil: .7 }));
      actor.torpedoLaunchers?.forEach(l => l.train = turn * 1.4);
      view.update(); view.updateRenderMatrices();
      const matrices = view.renderMeshes.map(({ mesh }) => mesh.matrixWorld.clone());
      view.root.updateMatrixWorld(true);
      for (const [i, { mesh }] of view.renderMeshes.entries()) {
        expect(Math.max(...mesh.matrixWorld.elements.map((n, j) => Math.abs(n - matrices[i].elements[j])))).toBeLessThan(1e-8);
      }
      expect(Math.max(0, ...view.muzzleErrors(), ...view.torpedoMuzzleErrors())).toBeLessThan(.025);
    }
    const source = view.renderMeshes[0].mesh, mark = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial());
    source.add(mark); mark.position.set(1, 2, 3);
    // Impact marks are dynamic children; normal explicit matrix queries remain available.
    view.updateRenderMatrices(); mark.updateMatrixWorld(true);
    expect(mark.matrixWorld.elements).toEqual(source.matrixWorld.clone().multiply(mark.matrix).elements);
    view.impactMarks.dispose();
  }
}, 15000);
