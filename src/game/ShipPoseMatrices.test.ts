import { expect, test } from 'bun:test';
import * as THREE from 'three/webgpu';
import { loadShipGeometry } from '../../scripts/diagnostics/load-ship-geometry';
import { mixedSimulation } from '../../scripts/diagnostics/mixed-fleet';
import { ShipView } from './ShipView';
import { batchShipModel } from './ShipBatching';
import { ShipMaterialPalette } from './ShipMaterialPalette';

test('offscreen hulls retain interpolation and restore current joint poses on re-entry', async () => {
  const sim = mixedSimulation(), actor = sim.player, model = await loadShipGeometry(actor.definition.id);
  batchShipModel(model);
  const hidden = new ShipView(model.clone(true), actor.definition, actor);
  const reference = new ShipView(model.clone(true), actor.definition, actor);
  hidden.renderActive = false;
  for (let tick = 0; tick < 8; tick++) {
    hidden.capturePreviousPose(); reference.capturePreviousPose();
    Object.assign(actor.motion, { x: tick * 7, z: -tick * 13, heading: tick * .2, roll: tick * .02 });
    actor.mounts.forEach(m => Object.assign(m, { train: tick * .12, elevation: tick * .08, recoil: (tick % 3) * .3 }));
    hidden.updateMotion(.37); hidden.updateRenderMatrices(); reference.update(.37);
    expect(hidden.motion).toEqual(reference.motion);
    expect(hidden.root.matrixWorld.elements[12]).toBeCloseTo(reference.motion.x);
  }
  hidden.renderActive = true; hidden.updateArticulation(.37); hidden.updateRenderMatrices(); reference.updateRenderMatrices();
  for (let i = 0; i < hidden.renderMeshes.length; i++) {
    expect(hidden.renderMeshes[i].mesh.matrixWorld.elements).toEqual(reference.renderMeshes[i].mesh.matrixWorld.elements);
  }
  hidden.impactMarks.dispose(); reference.impactMarks.dispose(); hidden.rig.dispose(); reference.rig.dispose();
});

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
      view.update();
      view.rig.update(.1, 10, .4, view.root, view.motion, false);
      view.updateRenderMatrices();
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
