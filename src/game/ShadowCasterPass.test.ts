import { expect, test } from 'bun:test';
import * as THREE from 'three/webgpu';
import { positionLocal } from 'three/tsl';
import {
  collectDepthCasters, collectShadowCasters, DepthCasterDraws, DepthCasterFrame, DepthCasterPass, DepthCasterStore, depthCasterStore, MorphPositions, noCasters, OVERRIDE_DEPTH,
  plainOverrideMaterial, plainShadowMaterial, ShadowCasterPass,
} from './ShadowCasterPass';
import { FleetBatch } from './FleetBatch';

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

/** A WebGPU queue whose buffers keep the bytes written to them, and a log of the writes. */
function fakeDevice() {
  type Buffer = { label: string; size: number; bytes: Uint8Array; destroy(): void };
  const writes: { label: string; offset: number; bytes: number }[] = [];
  const device = {
    queue: {
      writeBuffer(buffer: Buffer, offset: number, data: Float32Array | Int32Array, dataOffset = 0, size = data.length - dataOffset) {
        const bytes = new Uint8Array(data.buffer, data.byteOffset + dataOffset * data.BYTES_PER_ELEMENT, size * data.BYTES_PER_ELEMENT);
        buffer.bytes.set(bytes, offset); writes.push({ label: buffer.label, offset, bytes: bytes.byteLength });
      },
      submit() {},
    },
    createBuffer: ({ label, size }: { label: string; size: number }): Buffer => ({ label, size, bytes: new Uint8Array(size), destroy() {} }),
  };
  return { device, writes };
}

/** A frame's draws for `frustum` as what they draw: object, range, and each instance's matrix, bounds and world matrix. */
function drawn(frame: DepthCasterFrame, frustum: THREE.Frustum) {
  const draws = new DepthCasterDraws(); draws.cull(frame, frustum);
  const objects = new Map(frame.blocks.map(block => [block.id, block.object]));
  return Array.from({ length: draws.drawCount }, (_, i) => ({
    object: objects.get(draws.source[i]), start: draws.start[i], count: draws.count[i],
    slots: Array.from(draws.ids.subarray(draws.first[i], draws.first[i] + draws.instances[i]), slot => [
      ...frame.matrices.subarray(slot * 16, slot * 16 + 16), ...frame.spheres.subarray(slot * 4, slot * 4 + 4), ...frame.models.subarray(draws.source[i] * 16, draws.source[i] * 16 + 16)]),
  }));
}

test('passes sharing one store draw exactly what each would prepare alone, through poses, detail levels, visibility and new casters', () => {
  let seed = 11;
  const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const material = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide });
  const geometries = [new THREE.BoxGeometry(2, 1, 4), new THREE.SphereGeometry(1.5, 8, 6), new THREE.ConeGeometry(1, 3, 7), new THREE.TorusGeometry(2, .3, 5, 9)];
  const pose = (m: THREE.Matrix4) => m.compose(new THREE.Vector3((random() - .5) * 200, (random() - .5) * 10, (random() - .5) * 200),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(random() * 6, random() * 6, random() * 6)), new THREE.Vector3().setScalar(.5 + random() * 2));
  const matrix = new THREE.Matrix4();
  // The fleet's batch in the world's frame, a plain batch under a moving parent, railings, a gun cover and loose parts.
  const fleet = new FleetBatch(40, 4000, 12000, material), ids = geometries.map(g => fleet.addGeometry(g));
  Object.assign(fleet, { castShadow: true, sortObjects: false, perObjectFrustumCulled: true, frustumCulled: false });
  for (let i = 0; i < 30; i++) fleet.setMatrixAt(fleet.addInstance(ids[i % ids.length]), pose(matrix));
  const plain = new THREE.BatchedMesh(8, 1000, 3000, material), plainIds = geometries.slice(0, 2).map(g => plain.addGeometry(g));
  plain.castShadow = true;
  for (let i = 0; i < 6; i++) plain.setMatrixAt(plain.addInstance(plainIds[i % 2]), pose(matrix));
  const parent = new THREE.Group(); parent.add(plain);
  const railings = new THREE.InstancedMesh(new THREE.BoxGeometry(.1, 1, .1), material, 8); railings.castShadow = true;
  for (let i = 0; i < 8; i++) railings.setMatrixAt(i, pose(matrix));
  const cover = new THREE.Mesh(new THREE.PlaneGeometry(2, 2, 4, 4), material); cover.castShadow = true;
  cover.geometry.morphAttributes.position = [new THREE.Float32BufferAttribute(Array.from({ length: 75 }, () => random()), 3)]; cover.updateMorphTargets();
  // The first hull draws only in the second pass: it casts no shadow.
  const hulls = [0, 1, 2].map(i => { const mesh = new THREE.Mesh(geometries[i], material); mesh.castShadow = i > 0; mesh.position.set(i * 30, 0, 0); return mesh; });
  const scene = new THREE.Scene(); scene.add(fleet, parent, railings, cover, ...hulls);
  const shared = new DepthCasterStore(), passes = [new DepthCasterFrame(shared), new DepthCasterFrame(shared)];
  const { device, writes } = fakeDevice();
  const gpu = (name: 'matrixBuffer' | 'sourceBuffer' | 'modelBuffer') => (shared[name] as unknown as { bytes: Uint8Array }).bytes;
  const cameras = [new THREE.OrthographicCamera(-80, 80, 80, -80, 1, 600), new THREE.PerspectiveCamera(60, 1.5, 1, 300)];
  let compared = 0;
  for (let step = 0; step < 200; step++) {
    const change = random(), instance = Math.floor(random() * 30);
    if (change < .3) fleet.setMatrixAt(instance, pose(matrix));
    else if (change < .4) fleet.setGeometryIdAt(instance, ids[Math.floor(random() * ids.length)]);
    else if (change < .5) fleet.setVisibleAt(instance, random() < .6);
    else if (change < .53) fleet.setGeometryAt(ids[3], new THREE.TorusGeometry(2 + random(), .3, 5, 9));
    else if (change < .6) { parent.position.x = random() * 20; plain.setVisibleAt(Math.floor(random() * 6), random() < .7); }
    else if (change < .66) { railings.setMatrixAt(Math.floor(random() * 8), pose(matrix)); railings.count = 4 + Math.floor(random() * 5); railings.instanceMatrix.needsUpdate = true; }
    else if (change < .72) cover.morphTargetInfluences![0] = random();
    else if (change < .8) hulls[Math.floor(random() * 3)].position.z = random() * 50;
    else if (change < .84) hulls[0].frustumCulled = !hulls[0].frustumCulled;
    else if (change < .88) { const hull = hulls[2]; if (hull.parent) hull.removeFromParent(); else scene.add(hull); }
    // Otherwise a still frame: every pose written again unchanged, as the fleet does each frame.
    else for (let i = 0; i < 30; i++) fleet.setMatrixAt(i, fleet.getMatrixAt(i, matrix));
    scene.updateMatrixWorld();
    const collections = [collectShadowCasters(scene, 1), collectDepthCasters(scene, 1, OVERRIDE_DEPTH)];
    const before = writes.length;
    passes.forEach((frame, i) => frame.prepare(collections[i]));
    shared.upload(device as never);
    // A still frame uploads no poses but the plain batch's, which is prepared afresh each time.
    const loose = passes[0].blocks.find(block => block.object === plain)!;
    if (change >= .88 && step > 0) expect(writes.slice(before).filter(write => write.label.includes('matrices'))).toEqual(loose.count ? [{ label: 'Depth casters matrices', offset: loose.start * 64, bytes: loose.count * 64 }] : []);
    for (const camera of cameras) {
      camera.position.set((random() - .5) * 100, 60 + random() * 60, (random() - .5) * 100); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
      const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
      collections.forEach((casters, i) => {
        // Alone and without reuse: every sphere computed here, none taken from the fleet batch.
        const alone = new DepthCasterFrame(Object.assign(new DepthCasterStore(), { reuse: false })); alone.prepare(casters);
        const draws = drawn(passes[i], frustum);
        expect(draws).toEqual(drawn(alone, frustum));
        compared += draws.length;
      });
    }
    // The GPU copies hold every slot either pass draws.
    for (const frame of passes) for (const block of frame.blocks) for (let slot = block.start; slot < block.start + block.count; slot++) {
      expect(new Float32Array(gpu('matrixBuffer').buffer, slot * 64, 16)).toEqual(frame.matrices.subarray(slot * 16, slot * 16 + 16));
      expect(new Int32Array(gpu('sourceBuffer').buffer, slot * 4, 1)[0]).toBe(block.id);
      expect(new Float32Array(gpu('modelBuffer').buffer, block.id * 64, 16)).toEqual(frame.models.subarray(block.id * 16, block.id * 16 + 16));
    }
  }
  expect(compared).toBeGreaterThan(500);
});

test('a shared store prepares each caster once a frame, uploads only what changed, and blends a morph once, when drawn', () => {
  const material = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide });
  const batch = new FleetBatch(4, 400, 1200, material), id = batch.addGeometry(new THREE.BoxGeometry());
  Object.assign(batch, { castShadow: true, sortObjects: false, perObjectFrustumCulled: true, frustumCulled: false });
  for (let i = 0; i < 4; i++) batch.setMatrixAt(batch.addInstance(id), new THREE.Matrix4().makeTranslation(i * 10, 0, 0));
  const cover = new THREE.Mesh(new THREE.PlaneGeometry(), material); cover.castShadow = true;
  cover.geometry.morphAttributes.position = [new THREE.Float32BufferAttribute(new Float32Array(12).fill(1), 3)]; cover.updateMorphTargets();
  const scene = new THREE.Scene(); scene.add(batch, cover); scene.updateMatrixWorld();
  const store = new DepthCasterStore(), shadow = new DepthCasterFrame(store), occlusion = new DepthCasterFrame(store);
  const { device, writes } = fakeDevice();
  const frame = () => { const before = writes.length; for (const pass of [occlusion, shadow]) pass.prepare(collectShadowCasters(scene, 1)); store.upload(device as never); return writes.slice(before); };
  const first = frame();
  expect(first.map(write => write.label).sort()).toEqual(['Depth casters matrices', 'Depth casters models', 'Depth casters sources']);
  expect(shadow.blocks).toEqual(occlusion.blocks);
  // Poses written again unchanged, as on a paused frame: nothing to upload.
  for (let i = 0; i < 4; i++) batch.setMatrixAt(i, new THREE.Matrix4().makeTranslation(i * 10, 0, 0));
  expect(frame()).toEqual([]);
  // One part moves: its slot alone.
  batch.setMatrixAt(2, new THREE.Matrix4().makeTranslation(25, 1, 0));
  const slot = shadow.blocks[0].start + 2;
  expect(frame()).toEqual([{ label: 'Depth casters matrices', offset: slot * 64, bytes: 64 }]);
  // The cover's weights move: noted by both passes, blended once, and only when a pass draws it.
  const morph = store.sources[shadow.blocks[1].id]!.morph!;
  const version = morph.version;
  cover.morphTargetInfluences![0] = .5; frame();
  expect(morph.version).toBe(version);
  morph.blend(); morph.blend();
  expect(morph.version).toBe(version + 1);
  expect(Array.from(morph.positions.subarray(0, 3))).toEqual([-.5 * .5 + .5, .5 * .5 + .5, .5]);
  // Without reuse every preparation starts afresh and uploads everything.
  const alone = Object.assign(new DepthCasterStore(), { reuse: false }), pass = new DepthCasterFrame(alone), fresh = fakeDevice();
  for (let i = 0; i < 2; i++) { pass.prepare(collectShadowCasters(scene, 1)); alone.upload(fresh.device as never); }
  expect(fresh.writes.filter(write => write.label.includes('matrices')).map(write => write.bytes)).toEqual([5 * 64, 5 * 64]);
});

test('casters no pass prepares for a while are released, and their slots reclaimed', () => {
  const material = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide }), scene = new THREE.Scene();
  const parts = Array.from({ length: 1500 }, () => { const mesh = caster(new THREE.BoxGeometry(), material); scene.add(mesh); return mesh; });
  const store = new DepthCasterStore(), frame = new DepthCasterFrame(store);
  frame.prepare(collectShadowCasters(scene, 1));
  expect(store.slots).toBe(1500);
  for (const part of parts.slice(0, 1400)) part.removeFromParent();
  for (let i = 0; i < 300; i++) frame.prepare(collectShadowCasters(scene, 1));
  expect(store.sources.filter(Boolean).length).toBe(100);
  expect(store.slots).toBe(100);
  expect(frame.blocks.map(block => block.object)).toEqual(parts.slice(1400));
  expect(frame.blocks.map(block => block.start)).toEqual(parts.slice(1400).map((_, i) => i));
});

test('the depth passes of one renderer share its store until the last is disposed', () => {
  const renderer = {} as THREE.WebGPURenderer, other = {} as THREE.WebGPURenderer;
  const shadow = new ShadowCasterPass(renderer), occlusion = new DepthCasterPass(renderer, 'Ship occlusion', OVERRIDE_DEPTH), elsewhere = new ShadowCasterPass(other);
  const store = (pass: DepthCasterPass) => (pass as unknown as { store: DepthCasterStore }).store;
  expect(store(shadow)).toBe(store(occlusion));
  expect(store(elsewhere)).not.toBe(store(shadow));
  expect(store(shadow).users).toBe(2);
  shadow.dispose(); shadow.dispose();
  expect(store(occlusion).users).toBe(1);
  // A pass made after the others were disposed starts a fresh store.
  occlusion.dispose();
  expect(depthCasterStore(renderer)).not.toBe(store(occlusion));
  elsewhere.dispose();
});

test('changes upload as runs, joined across gaps shorter than a few kilobytes', () => {
  const material = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide }), scene = new THREE.Scene();
  const parts = Array.from({ length: 150 }, (_, i) => { const mesh = caster(new THREE.BoxGeometry(), material); mesh.position.x = i; scene.add(mesh); return mesh; });
  scene.updateMatrixWorld();
  const store = new DepthCasterStore(), frame = new DepthCasterFrame(store), { device, writes } = fakeDevice();
  const step = (moved: number[]) => {
    for (const i of moved) parts[i].position.y += 1;
    scene.updateMatrixWorld();
    const before = writes.length;
    frame.prepare(collectShadowCasters(scene, 1)); store.upload(device as never);
    return writes.slice(before).map(write => [write.label, write.offset / 64, write.bytes / 64]);
  };
  step([]);
  // Lone meshes keep the identity as their own matrix: only their world matrices go up.
  expect(step([0, 149])).toEqual([['Depth casters models', 0, 1], ['Depth casters models', 149, 1]]);
  expect(step([0, 10, 60])).toEqual([['Depth casters models', 0, 61]]);
  expect(step([])).toEqual([]);
});
