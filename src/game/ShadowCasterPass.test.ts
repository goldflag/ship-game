import { expect, test } from 'bun:test';
import * as THREE from 'three/webgpu';
import { positionLocal } from 'three/tsl';
import { collectDepthCasters, collectShadowCasters, DepthCasterDraws, DepthCasterFrame, MorphPositions, noCasters, OVERRIDE_DEPTH, plainOverrideMaterial, plainShadowMaterial } from './ShadowCasterPass';

const caster = (geometry: THREE.BufferGeometry, material: THREE.Material = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide })) => {
  const mesh = new THREE.Mesh(geometry, material); mesh.castShadow = true; return mesh;
};

test('only both-sided casters without vertex, depth or discard nodes are plain depth writes', () => {
  expect(plainShadowMaterial(new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, map: new THREE.Texture() }))).toBe(true);
  // Three draws a front-sided caster's back faces into the map, which depends on each instance's winding.
  expect(plainShadowMaterial(new THREE.MeshStandardMaterial())).toBe(false);
  expect(plainShadowMaterial(Object.assign(new THREE.MeshStandardMaterial(), { shadowSide: THREE.DoubleSide }))).toBe(true);
  expect(plainShadowMaterial(new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, alphaTest: .5 }))).toBe(false);
  expect(plainShadowMaterial(Object.assign(new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide }), { positionNode: positionLocal }))).toBe(false);
  expect(plainShadowMaterial(new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, visible: false }))).toBe(false);
  expect(plainShadowMaterial([new THREE.MeshStandardMaterial({ side: THREE.DoubleSide })])).toBe(false);
});

test('collection follows three: hidden subtrees and other layers drop out, unusual casters go to three', () => {
  const scene = new THREE.Scene(), box = new THREE.BoxGeometry();
  const plain = caster(box), hiddenParent = new THREE.Group(), hidden = caster(box), masked = caster(box), idle = new THREE.Mesh(box);
  hiddenParent.visible = false; hiddenParent.add(hidden); masked.layers.mask = 0;
  // A masked parent still passes its children on, as three's projection does.
  masked.add(caster(box));
  const instanced = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ side: THREE.DoubleSide }), 2); instanced.castShadow = true;
  // Matrices a compute pass may write live only on the GPU.
  const computed = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ side: THREE.DoubleSide }), 2); computed.castShadow = true;
  computed.instanceMatrix = new THREE.StorageInstancedBufferAttribute(new Float32Array(32), 16);
  const oneSided = caster(box, new THREE.MeshStandardMaterial());
  const callback = caster(box); callback.onBeforeRender = () => {};
  const batch = new THREE.BatchedMesh(2, 64, 64, new THREE.MeshStandardMaterial({ side: THREE.DoubleSide })); batch.castShadow = true;
  batch.addInstance(batch.addGeometry(box));
  // Until its first geometry a batch has nothing to draw.
  const empty = new THREE.BatchedMesh(2, 64, 64, new THREE.MeshStandardMaterial({ side: THREE.DoubleSide })); empty.castShadow = true;
  // Nor does three draw a mesh whose own material is hidden.
  const unseen = caster(box, new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, visible: false }));
  scene.add(plain, hiddenParent, masked, idle, instanced, computed, oneSided, callback, batch, empty, unseen);
  const casters = collectShadowCasters(scene, 1);
  expect(casters.batches).toEqual([batch]);
  expect(casters.instanced).toEqual([instanced]);
  expect(casters.meshes).toEqual([plain, masked.children[0] as THREE.Mesh]);
  expect(casters.others).toEqual([computed, oneSided, callback]);
});

test('an override pass draws every mesh on its layers, and leaves to three what the override would not replace', () => {
  // A depth override writes its own fragment, both faces: side, alpha test and colour maps fall away with the material.
  expect(plainOverrideMaterial(new THREE.MeshStandardMaterial({ alphaTest: .5, alphaMap: new THREE.Texture(), map: new THREE.Texture() }))).toBe(true);
  // Three keeps a material's own vertex displacement on the override, and draws one that refuses overrides as itself.
  expect(plainOverrideMaterial(Object.assign(new THREE.MeshStandardNodeMaterial(), { positionNode: positionLocal }))).toBe(false);
  expect(plainOverrideMaterial(new THREE.MeshStandardMaterial({ displacementMap: new THREE.Texture() }))).toBe(false);
  expect(plainOverrideMaterial(Object.assign(new THREE.MeshStandardMaterial(), { allowOverride: false }))).toBe(false);
  expect(plainOverrideMaterial([new THREE.MeshStandardMaterial()])).toBe(false);

  const scene = new THREE.Scene(), box = new THREE.BoxGeometry(), layer = 1 << 20;
  const onLayer = (material: THREE.Material = new THREE.MeshStandardMaterial()) => { const mesh = new THREE.Mesh(box, material); mesh.layers.enable(20); return mesh; };
  // No shadow casting needed; a one-sided hull is drawn both-sided by the override.
  const hull = onLayer(), refusing = onLayer(Object.assign(new THREE.MeshStandardMaterial(), { allowOverride: false })), offLayer = new THREE.Mesh(box, new THREE.MeshStandardMaterial());
  const batch = new THREE.BatchedMesh(2, 64, 64, new THREE.MeshStandardMaterial()); batch.layers.enable(20);
  batch.addInstance(batch.addGeometry(box));
  scene.add(hull, refusing, offLayer, batch);
  const casters = collectDepthCasters(scene, layer, OVERRIDE_DEPTH);
  expect(casters.meshes).toEqual([hull]);
  expect(casters.batches).toEqual([batch]);
  expect(casters.others).toEqual([refusing]);
  // The shadow rule on the same layer takes none of them: nothing casts.
  expect(collectShadowCasters(scene, layer)).toEqual(noCasters());
});

test('a map keeps the parts it can see and draws equal ranges of a batch together', () => {
  const box = new THREE.BoxGeometry(), plane = new THREE.PlaneGeometry();
  const batch = new THREE.BatchedMesh(5, 256, 256, new THREE.MeshStandardMaterial({ side: THREE.DoubleSide })); batch.castShadow = true;
  const [boxId, planeId] = [batch.addGeometry(box), batch.addGeometry(plane)];
  // Instance order interleaves the two ranges; x = 500 lies outside the map, and one is hidden.
  for (const [geometry, x, visible] of [[boxId, 0, true], [planeId, 0, true], [boxId, 2, true], [boxId, 500, true], [planeId, 3, false]] as const) {
    const id = batch.addInstance(geometry);
    batch.setMatrixAt(id, new THREE.Matrix4().makeTranslation(x, 0, 0)); batch.setVisibleAt(id, visible);
  }
  const loose = caster(plane); loose.position.set(1, 0, 0); loose.updateMatrixWorld();
  const scene = new THREE.Scene(); scene.add(batch, loose); scene.updateMatrixWorld();
  const frame = new DepthCasterFrame(); frame.prepare(collectShadowCasters(scene, 1));
  expect(frame.count).toBe(5);
  const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, .1, 100); camera.position.set(0, 50, 0); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  const draws = new DepthCasterDraws(); draws.cull(frame, frustum);
  const rows = Array.from({ length: draws.drawCount }, (_, i) => ({ source: draws.source[i], count: draws.count[i], first: draws.first[i], instances: draws.instances[i] }));
  const ranges = batch as unknown as { _geometryInfo: { count: number }[] };
  expect(rows).toEqual([
    { source: 0, count: ranges._geometryInfo[boxId].count, first: 0, instances: 2 },
    { source: 0, count: ranges._geometryInfo[planeId].count, first: 2, instances: 1 },
    { source: 1, count: plane.index!.count, first: 3, instances: 1 },
  ]);
  // The kept box instances carry their own translations, the loose plane its world matrix; the far box never reaches the map.
  const kept = Array.from(draws.ids.subarray(0, draws.idCount), slot => frame.matrices[slot * 16 + 12] + frame.models[frame.slotSource[slot] * 16 + 12]);
  expect(kept).toEqual([0, 2, 0, 1]);
});

test('each part keeps its own matrix and its object the world matrix, as three transforms them', () => {
  const batch = new THREE.BatchedMesh(1, 64, 64, new THREE.MeshStandardMaterial({ side: THREE.DoubleSide })); batch.castShadow = true;
  batch.setMatrixAt(batch.addInstance(batch.addGeometry(new THREE.BoxGeometry())), new THREE.Matrix4().makeTranslation(1, 0, 0));
  batch.position.set(0, 0, 7); batch.updateMatrixWorld();
  const stanchions = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ side: THREE.DoubleSide }), 3); stanchions.count = 2;
  stanchions.setMatrixAt(0, new THREE.Matrix4().makeTranslation(0, 2, 0)); stanchions.setMatrixAt(1, new THREE.Matrix4().makeTranslation(0, 4, 0));
  stanchions.position.set(10, 0, 0); stanchions.updateMatrixWorld();
  const hull = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()); hull.position.set(-5, 0, 0); hull.updateMatrixWorld();
  const frame = new DepthCasterFrame(); frame.prepare({ ...noCasters(), batches: [batch], instanced: [stanchions], meshes: [hull] });
  const column = (array: Float32Array, at: number) => Array.from(array.subarray(at * 16 + 12, at * 16 + 15));
  // The batch's instance and the stanchions (only the drawn two) move by their own matrices, the lone hull by none.
  expect([0, 1, 2, 3].map(slot => column(frame.matrices, slot))).toEqual([[1, 0, 0], [0, 2, 0], [0, 4, 0], [0, 0, 0]]);
  expect([0, 1, 2, 3].map(slot => frame.slotSource[slot])).toEqual([0, 1, 1, 2]);
  expect([0, 1, 2].map(source => column(frame.models, source))).toEqual([[0, 0, 7], [10, 0, 0], [-5, 0, 0]]);
  // Culling sees each part where it stands in the world.
  expect([0, 1, 2, 3].map(slot => Array.from(frame.spheres.subarray(slot * 4, slot * 4 + 3)))).toEqual([[1, 0, 7], [10, 2, 0], [10, 4, 0], [-5, 0, 0]]);
});

for (const relative of [true, false]) test(`morph casters blend as three's vertex stage does (${relative ? 'relative' : 'absolute'} targets)`, () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  const lift = relative ? [0, 2, 0, 0, 2, 0, 0, 2, 0] : [0, 2, 0, 1, 2, 0, 0, 3, 0];
  geometry.morphAttributes.position = [new THREE.Float32BufferAttribute(lift, 3), new THREE.Float32BufferAttribute(lift.map(v => v * 2), 3)];
  geometry.morphTargetsRelative = relative;
  const mesh = caster(geometry); mesh.updateMorphTargets();
  mesh.morphTargetInfluences![0] = .25;
  const morph = new MorphPositions(mesh); morph.update();
  // Either way, a quarter of the first target lifts the triangle by half a metre.
  expect(Array.from(morph.positions)).toEqual([0, .5, 0, 1, .5, 0, 0, 1.5, 0]);
  const version = morph.version; morph.update();
  expect(morph.version).toBe(version);
  mesh.morphTargetInfluences![0] = 0; mesh.morphTargetInfluences![1] = .5; morph.update();
  // Absolute targets also scale the base by one less the weights, so the doubled target's x carries through.
  expect(Array.from(morph.positions)).toEqual(relative ? [0, 2, 0, 1, 2, 0, 0, 3, 0] : [0, 2, 0, 1.5, 2, 0, 0, 3.5, 0]);
  // Gun covers keep their morphs: they are drawn here, not left to three.
  const scene = new THREE.Scene(); scene.add(mesh);
  expect(collectShadowCasters(scene, 1).meshes).toEqual([mesh]);
});
