import { expect, test } from 'bun:test';
import * as THREE from 'three/webgpu';
import { loadShipGeometry } from '../../scripts/diagnostics/load-ship-geometry';
import { mixedSimulation } from '../../scripts/diagnostics/mixed-fleet';
import { ShipView } from './ShipView';
import { batchShipModel } from './ShipBatching';
import { FleetShipDraws } from './FleetShipDraws';
import { prepareShipDetail, shipDetailLevels } from './ShipDetail';
import { subtreePruning } from './SubtreeLayers';
import { ShipPoseMatrices } from './ShipPoseMatrices';

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
  // A later compiled pose must match a full authoring-hierarchy update.
  actors[1].motion.heading += .2;
  views.forEach(v => { v.update(); v.updateRenderMatrices(); }); draws.update();
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
  for (const view of views) view.root.updateMatrixWorld(true);
  // Canvas gun covers blend morph shapes, so they keep their own draws.
  for (const view of views) for (const { mesh } of view.renderMeshes.filter(({ mesh }) => !mesh.morphTargetInfluences?.length)) {
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
  const view = { root, model, renderMeshes: [a, b].map(mesh => ({ mesh, material })), inspection: { mode: 'exterior' }, impactMarks: { renderMeshes: [] },
    poseMatrices: new ShipPoseMatrices(root, model, new Set()) } as unknown as ShipView;
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

test('armor keeps the translucent exterior assembled and distance-reduced with independent ship materials', async () => {
  const sim = mixedSimulation(), actor = sim.player;
  const definition = { ...actor.definition, mounts: [], rig: undefined };
  const template = new THREE.Group(), material = new THREE.MeshStandardMaterial();
  const geometry = new THREE.SphereGeometry(1, 64, 32);
  for (let i = 0; i < 8; i++) {
    const mesh = new THREE.Mesh(geometry, material); mesh.position.x = i * 3; template.add(mesh);
  }
  await prepareShipDetail(template);
  const views = [0, 1].map(() => new ShipView(template.clone(true), definition, actor));
  const draws = new FleetShipDraws(views), camera = new THREE.PerspectiveCamera(60, 16 / 9, .1, 100000);
  const update = (distance: number) => {
    views.forEach(v => { v.update(); v.updateRenderMatrices(); });
    camera.position.copy(views[0].root.position).add(new THREE.Vector3(0, 0, distance));
    camera.lookAt(views[0].root.position); camera.updateMatrixWorld(true); draws.update(camera, 1080);
    draws.root.updateMatrixWorld(true);
  };
  const contextMeshes = () => {
    const meshes: THREE.Mesh[] = [];
    draws.root.traverseVisible(object => { if (object instanceof THREE.Mesh && !(object instanceof THREE.BatchedMesh)) meshes.push(object); });
    return meshes;
  };
  update(1000);
  views[0].setInspection('armor'); update(1000);
  // Eight fixed surfaces must not revert to eight full-detail transparent draws.
  expect(contextMeshes()).toHaveLength(1);
  const context = contextMeshes()[0], source = views[0].renderMeshes[0].mesh;
  expect(context.material).toBe(source.material);
  expect(context.material).not.toBe(views[1].renderMeshes[0].mesh.material);
  expect((context.material as THREE.MeshStandardMaterial).opacity).toBe(.16);
  expect((views[1].renderMeshes[0].mesh.material as THREE.MeshStandardMaterial).opacity).toBe(1);
  expect(views[0].renderMeshes.every(({ mesh }) => mesh.layers.mask === 0)).toBe(true);
  expect(context.geometry.index!.count).toBeLessThan(geometry.index!.count * 8);
  expect(context.matrixWorld.equals(views[0].root.matrixWorld)).toBe(true);
  update(5);
  expect(context.geometry.index!.count).toBe(geometry.index!.count * 8);
  expect(source.geometry).toBe(geometry);
  // Independently hidden components still use the original, per-surface fallback.
  source.visible = false; update(1000);
  expect(contextMeshes()).toHaveLength(7);
  source.visible = true; update(1000);
  expect(contextMeshes()).toHaveLength(1);
  views[0].root.visible = false; draws.update(camera, 1080);
  expect(contextMeshes()).toHaveLength(0);
  views[0].root.visible = true; views[0].setInspection('exterior'); update(1000);
  expect(contextMeshes()).toHaveLength(0);
  expect(draws.diagnostics().instances).toBe(2);
  draws.dispose();
  expect(views[0].model.visible).toBe(true);
  expect(views[0].renderMeshes.every(({ mesh }) => mesh.layers.mask === 1)).toBe(true);
  views.forEach(v => v.impactMarks.dispose());
});

test('skipping emptied hull subtrees keeps three\'s render list through inspection, hidden parts, scars and flat proxies', async () => {
  const sim = mixedSimulation(), scene = new THREE.Scene(), views: ShipView[] = [];
  for (const actor of [sim.player, ...sim.actors.filter(a => ['fletcher', 'baltimore', 'yamato'].includes(a.definition.id)).slice(0, 3)]) {
    const model = await loadShipGeometry(actor.definition.id); batchShipModel(model);
    views.push(new ShipView(model, actor.definition, actor));
  }
  const draws = new FleetShipDraws(views);
  scene.add(draws.root, ...views.map(v => v.root));
  const renderer = { sortObjects: true, backend: {}, _projectObject: (THREE.Renderer.prototype as unknown as { _projectObject: unknown })._projectObject } as unknown as
    { _projectObject(object: THREE.Object3D, camera: THREE.Camera, groupOrder: number, list: unknown, clipping: unknown): void };
  const pruning = subtreePruning(renderer);
  pruning.subtrees = draws.subtrees;
  const project = (camera: THREE.Camera) => {
    const pushes: unknown[][] = [];
    renderer._projectObject(scene, camera, 0, { push: (...a: unknown[]) => pushes.push(a), pushLight: (l: unknown) => pushes.push([l]), pushBundle: (b: unknown) => pushes.push([b]) }, null);
    return pushes;
  };
  const camera = new THREE.PerspectiveCamera(), occlusion = camera.clone(); occlusion.layers.set(20);
  let skipped = 0;
  const frame = () => {
    views.forEach(v => { v.update(); v.updateRenderMatrices(); }); draws.update();
    expect(draws.subtrees.verify()).toEqual([]);
    for (const view of [camera, occlusion]) {
      pruning.enabled = false; const full = project(view);
      pruning.enabled = true; const pruned = project(view);
      expect(pruned.length).toBe(full.length);
      expect(pruned.every((push, i) => push.length === full[i].length && push.every((value, j) => Object.is(value, full[i][j])))).toBe(true);
    }
    skipped = views.reduce((n, v) => n + v.model.children.filter(c => draws.subtrees.skips(c, 1)).length, 0);
  };
  frame(); expect(skipped).toBeGreaterThan(0);
  // A hidden turret or a hidden hull puts its surfaces back in three's walk.
  const turret = views[0].model.children.find(c => c.children.length > 1)!;
  turret.visible = false; frame(); turret.visible = true; frame();
  const yamato = views.find(v => v.definition.id === 'yamato')!;
  yamato.model.visible = false; frame(); yamato.model.visible = true; frame();
  // Inspection modes keep either the translucent armor context or the original surfaces.
  views[0].setInspection('armor'); views[1].setInspection('internals'); frame();
  views[0].setInspection('exterior'); views[1].setInspection('exterior'); frame();
  // A scar on a batched surface is a new drawable child.
  const receiver = draws['batches'].flatMap(b => b.sources).find(s => s.ship.view === views[0] && !s.owner)!.mesh;
  const mark = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial()); mark.frustumCulled = false;
  receiver.add(mark); frame(); expect(project(camera).some(push => push[0] === mark)).toBe(true);
  mark.removeFromParent(); frame();
  views[2].renderActive = false; frame(); views[2].renderActive = true; frame();
  draws.dispose(); pruning.subtrees = undefined;
  views.forEach(v => { v.impactMarks.dispose(); v.rig.dispose(); });
}, 30000);

test('deferred and bounded poses draw every batch, original surface, scar and flat proxy exactly as full pose updates do', async () => {
  const sim = mixedSimulation(), actors = [sim.player, ...['yamato', 'baltimore', 'fletcher', 'enterprise-cv6', 'type-viic'].map(id => sim.actors.find(a => a.definition.id === id)!)];
  const templates = new Map<string, THREE.Group>();
  for (const { definition: { id } } of actors) if (!templates.has(id)) {
    const model = await loadShipGeometry(id); batchShipModel(model); await prepareShipDetail(model); templates.set(id, model);
  }
  // The same fleet twice: the reference composes every pose each frame, the other defers and bounds them.
  const fleets = [0, 1].map(() => actors.map(a => new ShipView(templates.get(a.definition.id)!.clone(true), a.definition, a)));
  const draws = fleets.map(views => new FleetShipDraws(views)), camera = new THREE.PerspectiveCamera(55, 16 / 9, 1, 60000);
  let seed = 7, culled = 0, left = 0, sequence = 0, inexact = 0, steady = 0;
  const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const snapshot = (d: FleetShipDraws, views: ShipView[]) => {
    const out: number[] = [];
    for (const { mesh, sources } of d['batches']) {
      const state = mesh as unknown as { _instanceInfo: { visible: boolean; geometryIndex: number }[]; _matricesTexture: THREE.DataTexture }, data = state._matricesTexture.image.data as Float32Array;
      for (const s of sources) {
        const info = state._instanceInfo[s.instance!];
        out.push(info.visible ? 1 : 0, info.geometryIndex, s.level);
        if (info.visible) out.push(...data.subarray(s.instance! * 16, s.instance! * 16 + 16));
        if (s.armorContext?.visible) out.push(...s.armorContext.matrix.elements, shipDetailLevels(s.mesh.geometry).findIndex(l => l.geometry === s.armorContext!.geometry));
      }
      out.push(mesh.visible ? 1 : 0);
    }
    // Every original surface three may draw, and every scar.
    for (const view of views) view.model.traverse(o => { if (o instanceof THREE.Mesh) { out.push(o.layers.mask); if (o.layers.mask) out.push(...o.matrixWorld.elements); } });
    for (const view of views) for (const mark of view.impactMarks.renderMeshes) out.push(...mark.matrixWorld.elements);
    for (const proxy of d['proxies'].values()) for (const child of proxy.root.children) out.push(child.visible ? 1 : 0, ...child.matrix.elements);
    const diagnostics = d.diagnostics(); out.push(diagnostics.instances, diagnostics.reduced, diagnostics.subpixel);
    return out;
  };
  // A shell scar on a turret face: a mount's surface is a deferred pose on a joint.
  const scar = (index: number) => { sequence++; fleets.forEach(views => {
    const view = views[index], mount = view.definition.mounts[0], yaw = (view as unknown as { joints: { mounts: { yaw: THREE.Object3D }[] } }).joints.mounts[0].yaw;
    view.root.updateMatrixWorld(true);
    let receiver: THREE.Mesh | undefined;
    yaw.traverse(o => { if (!receiver && o instanceof THREE.Mesh && o.geometry.index && o.geometry.index.count > 300) receiver = o; });
    const position = receiver!.geometry.getAttribute('position'), index3 = receiver!.geometry.index!, local = new THREE.Matrix4().copy(yaw.matrixWorld).invert().multiply(receiver!.matrixWorld);
    const [a, b, c] = [0, 1, 2].map(k => new THREE.Vector3().fromBufferAttribute(position, index3.getX(k)).applyMatrix4(local));
    const normal = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize(), point = a.add(b).add(c).divideScalar(3);
    const event = { sequence, shipId: view.actor.motion.id, surfaceImpact: { position: point.toArray(), normal: normal.toArray(), direction: normal.clone().negate().toArray(), mountId: mount.id, outcome: 'penetration' },
      shell: { id: sequence, caliberM: .38, type: 'AP' } };
    view.impactMarks.update([event] as never, view.actor.motion.id, undefined, () => view.updateArticulation(.5));
  }); };
  try {
    for (let step = 0; step < 48; step++) {
      actors.forEach((actor, k) => {
        Object.assign(actor.motion, { x: k * 700 + random() * 60, z: -k * 350 + random() * 60, y: random() - .5, heading: random() * 6.3, roll: (random() - .5) * .2, pitch: (random() - .5) * .06,
          rudder: random() * 2 - 1, distance: random() * 200, speed: 8 });
        actor.mounts.forEach(m => Object.assign(m, { train: (random() - .5) * 4, elevation: random() * .7, recoil: random() }));
        actor.torpedoLaunchers?.forEach(l => { l.train = (random() - .5) * 3; });
      });
      const target = actors[step % actors.length].motion, distance = [40, 300, 2000, 8000, 25000][step % 5] * (.5 + random());
      camera.fov = step % 3 ? 55 : 4; camera.updateProjectionMatrix();
      camera.position.set(target.x + distance * Math.cos(step), 15 + random() * distance * .3, target.z + distance * Math.sin(step));
      camera.lookAt(target.x, 0, target.z); camera.updateMatrixWorld(true);
      // An inverted view rarely keeps an exact 1 in its corner; bounds must hold either way.
      const exact = camera.matrixWorldInverse.elements[15] === 1, before = culled;
      fleets.forEach(views => {
        // A hidden turret, a hidden hull (the lens's own), armor and internals inspection, a hull out of view.
        const turret = views[0].model.children.find(c => c.children.length > 1)!;
        turret.visible = step < 10 || step > 14;
        views[3].root.visible = step % 9 !== 4;
        if (step === 18) { views[1].setInspection('armor'); views[5].setInspection('internals'); }
        if (step === 26) { views[1].setInspection('exterior'); views[5].setInspection('exterior'); }
        views[4].renderActive = step % 7 !== 3;
      });
      if (step === 20 || step === 33) scar(step === 20 ? 1 : 3);
      const outputs = fleets.map((views, arm) => {
        ShipPoseMatrices.deferring = arm === 1;
        for (const view of views) { view.update(.5); view.updateRenderMatrices(); }
        if (arm === 1) for (const view of views) {
          // Poison what the frame left deferred: a stale read shows as a NaN in the draws.
          const poses = view.poseMatrices, worlds = (poses as unknown as { worlds: number[][] }).worlds;
          poses.poses.forEach((_, i) => { if (!poses.current(i)) worlds[i].fill(NaN); });
        }
        draws[arm].update(camera, 1440);
        if (arm === 1) {
          for (const { sources, anchors, settled } of draws[1]['batches']) sources.forEach((source, k) => {
            if (anchors[k] >= 0 && source.ship.active && source.ship.batched && !source.ship.poses.current(source.pose)) culled++;
            if (settled[k] && source.ship.steady) steady++;
          });
          for (const view of views) left += view.poseMatrices.poses.filter((_, i) => !view.poseMatrices.current(i)).length;
        }
        return snapshot(draws[arm], views);
      });
      expect(outputs[1].length).toBe(outputs[0].length);
      expect({ step, first: outputs[1].findIndex((value, i) => !Object.is(value, outputs[0][i])) }).toEqual({ step, first: -1 });
      if (!exact && culled > before) inexact++;
    }
  } finally { ShipPoseMatrices.deferring = true; }
  expect(fleets[1].reduce((n, v) => n + v.impactMarks.count, 0)).toBeGreaterThan(0);
  // Not vacuous: surfaces were culled on their bounds alone, and poses stayed undone.
  expect(culled).toBeGreaterThan(100); expect(left).toBeGreaterThan(1000); expect(inexact).toBeGreaterThan(0); expect(steady).toBeGreaterThan(100);
  draws.forEach(d => d.dispose());
  fleets.flat().forEach(v => { v.impactMarks.dispose(); v.rig.dispose(); });
}, 60000);
