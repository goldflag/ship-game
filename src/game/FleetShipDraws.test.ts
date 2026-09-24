import { expect, test } from 'bun:test';
import * as THREE from 'three/webgpu';
import { loadShipGeometry } from '../../scripts/diagnostics/load-ship-geometry';
import { mixedSimulation } from '../../scripts/diagnostics/mixed-fleet';
import { ShipView } from './ShipView';
import { batchShipModel } from './ShipBatching';
import { FleetShipDraws } from './FleetShipDraws';
import { prepareShipDetail } from './ShipDetail';
import { subtreePruning } from './SubtreeLayers';

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
