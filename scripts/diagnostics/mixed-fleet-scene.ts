import * as THREE from 'three/webgpu';
import { loadShipGeometry } from './load-ship-geometry';
import { mixedSimulation, MIXED_SHIPS } from './mixed-fleet';
import { ShipView } from '../../src/game/ShipView';
import { batchShipModel } from '../../src/game/ShipBatching';

const results = [];
for (const batched of [false, true]) {
  const sim = mixedSimulation(Number(process.argv[2] ?? 10)), root = new THREE.Group();
  for (const id of MIXED_SHIPS) {
    const model = await loadShipGeometry(id);
    if (batched) batchShipModel(model);
    for (const actor of sim.actors.filter(a => a.definition.id === id)) root.add(new ShipView(model.clone(true), actor.definition, actor).root);
  }
  let meshes = 0, nodes = 0, triangles = 0;
  root.traverse(o => { nodes++; if (o instanceof THREE.Mesh) { meshes++; triangles += (o.geometry.index?.count ?? o.geometry.getAttribute('position').count) / 3; } });
  const samples = [];
  for (let i = 0; i < 150; i++) { const start = performance.now(); root.updateMatrixWorld(true); if (i >= 30) samples.push(performance.now() - start); }
  samples.sort((a, b) => a - b);
  results.push({ batched, ships: sim.actors.length, meshes, nodes, triangles, matrixMs: { median: samples[60], p95: samples[114] } });
}
console.log(JSON.stringify(results, null, 2));
