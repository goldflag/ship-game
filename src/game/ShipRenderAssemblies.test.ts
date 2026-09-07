import { expect, test } from 'bun:test';
import * as THREE from 'three/webgpu';
import { loadShipGeometry } from '../../scripts/diagnostics/load-ship-geometry';
import { mixedSimulation } from '../../scripts/diagnostics/mixed-fleet';
import { ShipView } from './ShipView';
import { batchShipModel } from './ShipBatching';
import { ShipMaterialPalette } from './ShipMaterialPalette';
import { ShipRenderAssemblies } from './ShipRenderAssemblies';

test('rigid render assemblies preserve vertices, paint and separate articulated parents in every preset', async () => {
  const simulation = mixedSimulation(), assemblies = new ShipRenderAssemblies();
  const expected = new THREE.Vector3(), actual = new THREE.Vector3();
  let combined = 0;
  for (const actor of simulation.actors.slice(0, 10)) {
    const model = await loadShipGeometry(actor.definition.id);
    new ShipMaterialPalette().apply(model); batchShipModel(model);
    const view = new ShipView(model, actor.definition, actor);
    const parents = new Map<THREE.Object3D, THREE.Object3D | null>(); model.traverse(o => parents.set(o, o.parent));
    const draws = assemblies.build(view);
    for (const turn of [-1.2, 1.7]) {
      Object.assign(actor.motion, { x: 124, y: -1.5, z: -3400, heading: turn, roll: -.2, pitch: .1 });
      actor.mounts.forEach(m => Object.assign(m, { train: turn, elevation: .5, recoil: .8 }));
      view.update(); view.updateRenderMatrices();
      for (const draw of draws) {
        if (!draw.owner) continue;
        combined++;
        const position = draw.mesh.geometry.attributes.position;
        let offset = 0, error = 0;
        for (const { mesh } of draw.members) {
          // A render assembly can never cross a moving ancestor.
          for (let ancestor: THREE.Object3D | null = mesh; ancestor !== draw.owner; ancestor = ancestor!.parent) expect(ancestor!.matrixAutoUpdate).toBe(false);
          const source = mesh.geometry.attributes.position;
          for (let i = 0; i < source.count; i++) {
            actual.fromBufferAttribute(position, offset + i).applyMatrix4(draw.owner.matrixWorld);
            expected.fromBufferAttribute(source, i).applyMatrix4(mesh.matrixWorld);
            error = Math.max(error, actual.distanceTo(expected));
          }
          for (const name of ['color', 'shipSurface']) if (mesh.geometry.hasAttribute(name)) {
            const attribute = mesh.geometry.getAttribute(name), merged = draw.mesh.geometry.getAttribute(name);
            expect(merged.array.slice(offset * attribute.itemSize, (offset + source.count) * attribute.itemSize)).toEqual(attribute.array.slice());
          }
          offset += source.count;
        }
        expect(offset).toBe(position.count); expect(error).toBeLessThan(.001);
      }
    }
    for (const [object, parent] of parents) expect(object.parent).toBe(parent);
    view.impactMarks.dispose();
  }
  expect(combined).toBeGreaterThan(10); assemblies.dispose();
}, 20000);
