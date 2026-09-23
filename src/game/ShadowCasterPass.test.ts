import { expect, test } from 'bun:test';
import * as THREE from 'three/webgpu';
import { positionLocal } from 'three/tsl';
import { collectShadowCasters, MorphPositions, plainShadowMaterial, ShadowCascadeDraws, ShadowCasterFrame } from './ShadowCasterPass';

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
  const oneSided = caster(box, new THREE.MeshStandardMaterial());
  const callback = caster(box); callback.onBeforeRender = () => {};
  const batch = new THREE.BatchedMesh(2, 64, 64, new THREE.MeshStandardMaterial({ side: THREE.DoubleSide })); batch.castShadow = true;
  batch.addInstance(batch.addGeometry(box));
  // Until its first geometry a batch has nothing to draw.
  const empty = new THREE.BatchedMesh(2, 64, 64, new THREE.MeshStandardMaterial({ side: THREE.DoubleSide })); empty.castShadow = true;
  scene.add(plain, hiddenParent, masked, idle, instanced, oneSided, callback, batch, empty);
  const casters = collectShadowCasters(scene, 1);
  expect(casters.batches).toEqual([batch]);
  expect(casters.meshes).toEqual([plain, masked.children[0] as THREE.Mesh]);
  expect(casters.others).toEqual([instanced, oneSided, callback]);
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
  const frame = new ShadowCasterFrame(); frame.prepare(collectShadowCasters(scene, 1));
  expect(frame.count).toBe(5);
  const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, .1, 100); camera.position.set(0, 50, 0); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  const draws = new ShadowCascadeDraws(); draws.cull(frame, frustum);
  const rows = Array.from({ length: draws.drawCount }, (_, i) => ({ source: draws.source[i], count: draws.count[i], first: draws.first[i], instances: draws.instances[i] }));
  const ranges = batch as unknown as { _geometryInfo: { count: number }[] };
  expect(rows).toEqual([
    { source: 0, count: ranges._geometryInfo[boxId].count, first: 0, instances: 2 },
    { source: 0, count: ranges._geometryInfo[planeId].count, first: 2, instances: 1 },
    { source: 1, count: plane.index!.count, first: 3, instances: 1 },
  ]);
  // The kept box instances carry their own translations; the far one never reaches the map.
  const kept = Array.from(draws.ids.subarray(0, draws.idCount), slot => frame.matrices[slot * 16 + 12]);
  expect(kept).toEqual([0, 2, 0, 1]);
});

test('a batch placed in the world moves its instances with it', () => {
  const batch = new THREE.BatchedMesh(1, 64, 64, new THREE.MeshStandardMaterial({ side: THREE.DoubleSide })); batch.castShadow = true;
  batch.setMatrixAt(batch.addInstance(batch.addGeometry(new THREE.BoxGeometry())), new THREE.Matrix4().makeTranslation(1, 0, 0));
  batch.position.set(0, 0, 7); batch.updateMatrixWorld();
  const frame = new ShadowCasterFrame(); frame.prepare({ batches: [batch], meshes: [], others: [] });
  expect(Array.from(frame.matrices.subarray(12, 15))).toEqual([1, 0, 7]);
  expect(Array.from(frame.spheres.subarray(0, 3))).toEqual([1, 0, 7]);
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
