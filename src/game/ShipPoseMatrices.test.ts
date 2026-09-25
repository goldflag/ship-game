import { expect, test } from 'bun:test';
import * as THREE from 'three/webgpu';
import { loadShipGeometry } from '../../scripts/diagnostics/load-ship-geometry';
import { mixedSimulation } from '../../scripts/diagnostics/mixed-fleet';
import { ShipView } from './ShipView';
import { batchShipModel } from './ShipBatching';
import { ShipMaterialPalette } from './ShipMaterialPalette';
import { ShipPoseMatrices } from './ShipPoseMatrices';

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

test('the flat multiply reproduces every joint and surface matrix bit for bit', async () => {
  const sim = mixedSimulation();
  let seed = 11;
  const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  for (const actor of sim.actors.slice(0, 6)) {
    const model = await loadShipGeometry(actor.definition.id);
    batchShipModel(model);
    const reference = new ShipView(model.clone(true), actor.definition, actor), view = new ShipView(model.clone(true), actor.definition, actor);
    const matrices = (v: ShipView) => (v as unknown as { poseMatrices: { poses: { object: THREE.Object3D }[] } }).poseMatrices.poses
      .flatMap(({ object }) => [...object.matrixWorld.elements, ...object.quaternion.toArray()]);
    try {
      for (let step = 0; step < 24; step++) {
        reference.capturePreviousPose(); view.capturePreviousPose();
        Object.assign(actor.motion, { x: random() * 900, z: -random() * 900, heading: random() * 6, roll: (random() - .5) * .2, pitch: (random() - .5) * .05 });
        // Some mounts train between ticks, and one is knocked out halfway.
        actor.mounts.forEach(m => { if (random() < .3) Object.assign(m, { train: (random() - .5) * 3, elevation: random() * .6, recoil: random() }); });
        if (step === 12) actor.mounts[0].hp = 0;
        for (const alpha of [0, .4, 1]) {
          ShipPoseMatrices.flat = false; reference.update(alpha); reference.updateRenderMatrices();
          ShipPoseMatrices.flat = true; view.update(alpha); view.updateRenderMatrices();
          const expected = matrices(reference), actual = matrices(view);
          expect(actual.length).toBe(expected.length);
          expect(actual.every((value, i) => Object.is(value, expected[i]))).toBe(true);
        }
      }
    } finally { ShipPoseMatrices.flat = true; }
    reference.impactMarks.dispose(); view.impactMarks.dispose(); reference.rig.dispose(); view.rig.dispose();
  }
}, 30000);

test('a surface on a joint stays inside its reach bound for any joint angles and recoil', async () => {
  const sim = mixedSimulation();
  let seed = 29, checked = 0, tightest = 0;
  const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const center = new THREE.Vector3();
  for (const id of ['yamato', 'enterprise-cv6', 'fletcher', 'type-viic']) {
    const actor = sim.actors.find(a => a.definition.id === id)!, model = await loadShipGeometry(id);
    batchShipModel(model);
    const view = new ShipView(model, actor.definition, actor), poses = view.poseMatrices;
    const recoilM = (node: THREE.Object3D) => actor.definition.mounts.find(m => String(node.userData.nodeId).startsWith(`${m.id}.`))?.weapon.recoilM ?? 0;
    const joints = poses.poses.filter(p => p.moving).map(p => p.object);
    const parent = (poses as unknown as { parentPose: Int32Array }).parentPose;
    const surfaces = poses.poses.flatMap((p, i) => !p.moving && parent[i] >= 0 ? [i] : []);
    expect(surfaces.length).toBeGreaterThan(0);
    const bounds = surfaces.map(i => {
      const geometry = (poses.poses[i].object as THREE.Mesh).geometry;
      if (!geometry.boundingSphere) geometry.computeBoundingSphere();
      return poses.reach(i, geometry.boundingSphere!.center, geometry.boundingSphere!.radius);
    });
    // The root at the origin: world space is the root's space. Every joint turns anywhere, and every barrel slides through its recoil.
    view.root.position.set(0, 0, 0); view.root.rotation.set(0, 0, 0);
    for (let sample = 0; sample < 40; sample++) {
      for (const joint of joints) {
        const u = random(), v = random() * Math.PI * 2, w = random() * Math.PI * 2;
        joint.quaternion.set(Math.sqrt(1 - u) * Math.sin(v), Math.sqrt(1 - u) * Math.cos(v), Math.sqrt(u) * Math.sin(w), Math.sqrt(u) * Math.cos(w));
        if (String(joint.userData.nodeId).endsWith('.recoil')) joint.position.z = random() * recoilM(joint);
      }
      poses.update(); poses.complete();
      surfaces.forEach((i, k) => {
        const mesh = poses.poses[i].object as THREE.Mesh, sphere = mesh.geometry.boundingSphere!, bound = bounds[k];
        const radius = sphere.radius * mesh.matrixWorld.getMaxScaleOnAxis(), distance = center.copy(sphere.center).applyMatrix4(mesh.matrixWorld).distanceTo(bound.pivot);
        expect(radius).toBeLessThanOrEqual(bound.radius);
        expect(distance + radius).toBeLessThanOrEqual(bound.reach);
        tightest = Math.max(tightest, (distance + radius) / bound.reach); checked++;
      });
    }
    view.impactMarks.dispose(); view.rig.dispose();
  }
  expect(checked).toBeGreaterThan(1000);
  // Not vacuous: some surface comes within a few percent of its bound.
  expect(tightest).toBeGreaterThan(.9);
}, 30000);

test('deferred poses keep every other pose, compose on demand as a full update does, and complete() fills the rest', async () => {
  const sim = mixedSimulation(), actor = sim.actors.find(a => a.definition.id === 'baltimore')!, model = await loadShipGeometry('baltimore');
  batchShipModel(model);
  const reference = new ShipView(model.clone(true), actor.definition, actor), view = new ShipView(model.clone(true), actor.definition, actor);
  const poses = view.poseMatrices, parent = (poses as unknown as { parentPose: Int32Array }).parentPose;
  const meshes = poses.poses.flatMap((p, i) => !p.moving && parent[i] >= 0 ? [p.object] : []);
  poses.defer(meshes.filter((_, i) => i % 3 !== 0));
  const matrices = (v: ShipView) => v.poseMatrices.poses.map(({ object }) => [...object.matrixWorld.elements]);
  for (let step = 0; step < 6; step++) {
    actor.mounts.forEach((m, i) => Object.assign(m, { train: (i + step) * .3, elevation: step * .05, recoil: (step % 3) / 2 }));
    Object.assign(actor.motion, { x: step * 40, heading: step * .4, roll: .05 * step });
    reference.update(); reference.updateRenderMatrices();
    view.update(); view.updateRenderMatrices();
    const expected = matrices(reference), before = matrices(view);
    let deferred = 0;
    poses.poses.forEach((_, i) => {
      if (poses.current(i)) expect(before[i]).toEqual(expected[i]);
      else deferred++;
    });
    expect(deferred).toBeGreaterThan(meshes.length / 2);
    // A deferred surface and its joints, composed on demand.
    let last = poses.poses.length - 1;
    while (poses.poses[last].moving || poses.current(last)) last--;
    poses.ensure(last);
    for (let i = last; i >= 0; i = parent[i]) { expect(poses.current(i)).toBe(true); expect(matrices(view)[i]).toEqual(expected[i]); }
    poses.complete();
    expect(matrices(view)).toEqual(expected);
  }
  poses.defer([]); view.update(); view.updateRenderMatrices(); reference.update(); reference.updateRenderMatrices();
  expect(poses.poses.every((_, i) => poses.current(i))).toBe(true);
  reference.impactMarks.dispose(); view.impactMarks.dispose(); reference.rig.dispose(); view.rig.dispose();
}, 30000);
