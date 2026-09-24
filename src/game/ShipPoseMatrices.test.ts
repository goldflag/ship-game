import { expect, test } from 'bun:test';
import * as THREE from 'three/webgpu';
import { loadShipGeometry } from '../../scripts/diagnostics/load-ship-geometry';
import { mixedSimulation } from '../../scripts/diagnostics/mixed-fleet';
import { ShipView } from './ShipView';
import { batchShipModel } from './ShipBatching';
import { ShipMaterialPalette } from './ShipMaterialPalette';
import { multiplyAt, ShipPoseMatrices } from './ShipPoseMatrices';
import { jointTurns } from './jointTurns';

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

test('direct joint turns pose every joint, appendage, radar and surface as three\'s Euler path does, bit for bit', async () => {
  const sim = mixedSimulation();
  let seed = 17;
  const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  type Fields = { _x: number; _y: number; _z: number; _w: number; _order: string };
  const state = (v: ShipView) => {
    const internals = v as unknown as { renderedMounts: Record<string, unknown>[]; gunCovers: { mesh: THREE.Mesh }[] };
    const out: unknown[] = [];
    for (const { object } of v.poseMatrices.poses) {
      const r = object.rotation as unknown as Fields, q = object.quaternion as unknown as Fields;
      out.push(...object.matrixWorld.elements, r._x, r._y, r._z, r._order, q._x, q._y, q._z, q._w, ...object.position.toArray());
    }
    for (const m of internals.renderedMounts) out.push(m.train, m.elevation, m.recoil, m.hp, JSON.stringify(m));
    for (const { mesh } of internals.gunCovers) out.push(...mesh.morphTargetInfluences!);
    return out;
  };
  let appendages = 0, launchers = 0, covers = 0, radars = 0;
  for (const id of ['bismarck', 'type-viic', 'fletcher', 'yamato']) {
    const actor = sim.actors.find(a => a.definition.id === id)!, model = await loadShipGeometry(id);
    batchShipModel(model);
    const reference = new ShipView(model.clone(true), actor.definition, actor), view = new ShipView(model.clone(true), actor.definition, actor);
    const internals = view as unknown as { appendages: unknown[]; launcherBindings: unknown[]; gunCovers: unknown[] };
    appendages += internals.appendages.length; launchers += internals.launcherBindings.length; covers += internals.gunCovers.length; radars += view.rig.radars.length;
    try {
      for (let step = 0; step < 16; step++) {
        reference.capturePreviousPose(); view.capturePreviousPose();
        Object.assign(actor.motion, { x: random() * 900, z: -random() * 900, heading: random() * 6, roll: (random() - .5) * .2, pitch: (random() - .5) * .05,
          rudder: random() * 2 - 1, distance: random() * 500, speed: (random() - .5) * 20 });
        // Mounts change in place after the capture, as the retired simulation's do; one is knocked out, then the hull sinks.
        actor.mounts.forEach(m => { if (random() < .5) Object.assign(m, { train: (random() - .5) * 3, elevation: random() * .6, recoil: random() }); });
        if (step === 6) actor.mounts[0].hp = 0;
        if (step === 12) actor.damage.sunk = true;
        actor.torpedoLaunchers?.forEach(l => { l.train = (random() - .5) * 4; });
        if (actor.submarine) actor.submarine.planes = random() * 2 - 1;
        for (const alpha of [0, .4, 1]) {
          jointTurns.direct = false;
          reference.update(alpha); reference.rig.update(.05, 8, 1, reference.root, reference.motion, actor.damage.sunk); reference.updateRenderMatrices();
          jointTurns.direct = true;
          view.update(alpha); view.rig.update(.05, 8, 1, view.root, view.motion, actor.damage.sunk); view.updateRenderMatrices();
          const expected = state(reference), actual = state(view);
          expect(actual.length).toBe(expected.length);
          expect(actual.every((value, i) => Object.is(value, expected[i]))).toBe(true);
        }
      }
    } finally { jointTurns.direct = true; actor.damage.sunk = false; }
    reference.impactMarks.dispose(); view.impactMarks.dispose(); reference.rig.dispose(); view.rig.dispose();
  }
  // Every kind of turned joint took part.
  expect(Math.min(appendages, launchers, covers, radars)).toBeGreaterThan(0);
}, 30000);

test('impact marks keep their receiver\'s pose and three\'s world matrix as receivers gain, lose and swap marks', async () => {
  const sim = mixedSimulation(), actor = sim.actors.find(a => a.definition.id === 'fletcher')!, model = await loadShipGeometry('fletcher');
  batchShipModel(model);
  const view = new ShipView(model, actor.definition, actor), poses = view.poseMatrices, marks = view.impactMarks;
  // Every surface deferred, as the fleet's batches leave them: only a mark's receiver brings its pose back.
  poses.defer(poses.poses.filter(p => !p.moving).map(p => p.object));
  const receivers = view.renderMeshes.map(r => r.mesh).filter(m => m.geometry.attributes.position.count > 30).slice(0, 4);
  const internals = marks as unknown as { rebuild(receiver: THREE.Mesh): void; marks: { receiver: THREE.Mesh; geometry: THREE.BufferGeometry; shellId: number; point: THREE.Vector3 }[] };
  const local = new THREE.Matrix4(), world = new THREE.Matrix4();
  let checked = 0;
  for (let step = 0; step < 12; step++) {
    // A mark lands on a receiver, or the oldest goes: the receiver's batch is rebuilt, moving it to the end of the list.
    const receiver = receivers[step % receivers.length];
    if (step % 5 === 4) { const gone = internals.marks.shift()!; internals.rebuild(gone.receiver); }
    else { internals.marks.push({ receiver, geometry: new THREE.PlaneGeometry(1, 1), shellId: step, point: new THREE.Vector3() }); internals.rebuild(receiver); }
    if (step === 9) marks.clear();
    Object.assign(actor.motion, { x: step * 30, heading: step * .3, roll: .02 * step });
    view.update(); view.updateRenderMatrices();
    for (const mark of marks.renderMeshes) {
      expect(mark.matrixAutoUpdate).toBe(false);
      local.compose(mark.position, mark.quaternion, mark.scale);
      expect(mark.matrix.elements.every((v, i) => Object.is(v, local.elements[i]))).toBe(true);
      expect(poses.current(poses.indexOf(mark.parent!))).toBe(true);
      world.multiplyMatrices(mark.parent!.matrixWorld, local);
      expect(mark.matrixWorld.elements.every((v, i) => Object.is(v, world.elements[i]))).toBe(true);
      checked++;
    }
  }
  expect(checked).toBeGreaterThan(10);
  marks.dispose(); view.rig.dispose();
});

test('a surface formed from its composition is the matrix ensure() stores, bit for bit, and is left undone', async () => {
  const sim = mixedSimulation();
  let seed = 41, formed = 0;
  const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  for (const id of ['yamato', 'fletcher', 'type-viic']) {
    const actor = sim.actors.find(a => a.definition.id === id)!, model = await loadShipGeometry(id);
    batchShipModel(model);
    const view = new ShipView(model, actor.definition, actor), poses = view.poseMatrices;
    const fixed = poses.poses.flatMap((p, i) => p.moving ? [] : [i]);
    expect(() => poses.composition(poses.poses.findIndex(p => p.moving))).toThrow();
    // As the fleet's batches leave them: every surface deferred.
    poses.defer(fixed.map(i => poses.poses[i].object));
    const te = Array.from({ length: 16 }, () => .5);
    for (const flat of [true, false]) for (let step = 0; step < 6; step++) {
      Object.assign(actor.motion, { x: random() * 900, z: -random() * 900, heading: random() * 6, roll: (random() - .5) * .2, pitch: (random() - .5) * .05 });
      actor.mounts.forEach(m => Object.assign(m, { train: (random() - .5) * 3, elevation: random() * .6, recoil: random() }));
      ShipPoseMatrices.flat = flat;
      try {
        view.update(); view.updateRenderMatrices();
        for (const i of fixed) {
          const { parent, parentElements, offset } = poses.composition(i);
          poses.ensure(parent);
          multiplyAt(parentElements, offset, 0, te);
          expect(poses.current(i)).toBe(false);
          poses.ensure(i);
          const stored = poses.poses[i].object.matrixWorld.elements;
          expect(te.every((v, k) => Object.is(v, stored[k]))).toBe(true);
          formed++;
        }
      } finally { ShipPoseMatrices.flat = true; }
    }
    view.impactMarks.dispose(); view.rig.dispose();
  }
  expect(formed).toBeGreaterThan(1000);
}, 30000);
