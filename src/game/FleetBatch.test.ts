import { expect, test } from 'bun:test';
import * as THREE from 'three/webgpu';
import { FleetBatch } from './FleetBatch';

test('reused water/main culling remains independent of shadow cameras and the next fleet pose', () => {
  const geometry = new THREE.BoxGeometry(), material = new THREE.MeshStandardMaterial();
  const batch = new FleetBatch(2, 48, 72, material), geometryId = batch.addGeometry(geometry);
  batch.sortObjects = false;
  batch.addInstance(geometryId); batch.addInstance(geometryId);
  batch.setMatrixAt(0, new THREE.Matrix4().makeTranslation(0, 0, -10));
  batch.setMatrixAt(1, new THREE.Matrix4().makeTranslation(100, 0, -10));
  const main = new THREE.PerspectiveCamera(60, 1, .5, 1000), shadow = main.clone();
  shadow.position.x = 100; main.updateMatrixWorld(); shadow.updateMatrixWorld();
  const internals = batch as unknown as { _multiDrawCount: number; _indirectTexture: THREE.DataTexture };
  const draw = (camera: THREE.Camera) => {
    batch.onBeforeRender(undefined as never, new THREE.Scene(), camera, batch.geometry, material, null as never);
    return Array.from(internals._indirectTexture.image.data!).slice(0, internals._multiDrawCount);
  };
  expect(draw(main)).toEqual([0]);
  const version = internals._indirectTexture.version;
  expect(draw(main)).toEqual([0]); expect(internals._indirectTexture.version).toBe(version);
  expect(draw(shadow)).toEqual([1]); expect(draw(main)).toEqual([0]);
  main.position.x = 100; main.updateMatrixWorld(); expect(draw(main)).toEqual([1]);
  batch.setMatrixAt(0, new THREE.Matrix4().makeTranslation(100, 0, -20)); batch.invalidateDrawList();
  expect(draw(main)).toEqual([0, 1]);
  batch.setVisibleAt(1, false); batch.invalidateDrawList(); expect(draw(main)).toEqual([0]);
  batch.dispose(); geometry.dispose(); material.dispose();
});

test('kept bounds cull and group exactly as three does each pass, through poses, detail levels, visibility and new geometry', () => {
  let seed = 7;
  const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const geometries = [new THREE.BoxGeometry(2, 1, 4), new THREE.SphereGeometry(1.5, 8, 6), new THREE.ConeGeometry(1, 3, 7), new THREE.TorusGeometry(2, .3, 5, 9)];
  const material = new THREE.MeshStandardMaterial();
  const batch = new FleetBatch(80, 4000, 12000, material), ids = geometries.map(g => batch.addGeometry(g));
  batch.sortObjects = false;
  const pose = (m: THREE.Matrix4) => m.compose(new THREE.Vector3((random() - .5) * 400, (random() - .5) * 20, (random() - .5) * 400),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(random() * 6, random() * 6, random() * 6)), new THREE.Vector3().setScalar(.5 + random() * 2));
  const matrix = new THREE.Matrix4();
  for (let i = 0; i < 60; i++) batch.setMatrixAt(batch.addInstance(ids[i % ids.length]), pose(matrix));
  const perspective = new THREE.PerspectiveCamera(50, 1.6, .5, 900), orthographic = new THREE.OrthographicCamera(-150, 150, 150, -150, 1, 600);
  const internals = batch as unknown as { _multiDrawCount: number; _multiDrawStarts: Int32Array; _multiDrawCounts: Int32Array; _indirectTexture: THREE.DataTexture };
  const draw = (camera: THREE.Camera, kept: boolean, drawMaterial: THREE.Material = material) => {
    FleetBatch.keepBounds = kept; batch.invalidateDrawList();
    batch.onBeforeRender(undefined as never, new THREE.Scene(), camera, batch.geometry, drawMaterial, null as never);
    const n = internals._multiDrawCount;
    return [n, ...internals._multiDrawStarts.slice(0, n), ...internals._multiDrawCounts.slice(0, n), ...(internals._indirectTexture.image.data as Uint32Array).slice(0, n)];
  };
  let drawn = 0;
  try {
    for (let step = 0; step < 300; step++) {
      const change = random();
      const instance = Math.floor(random() * 60);
      if (change < .4) batch.setMatrixAt(instance, pose(matrix));
      else if (change < .55) batch.setGeometryIdAt(instance, ids[Math.floor(random() * ids.length)]);
      else if (change < .65) batch.setVisibleAt(instance, random() < .6);
      else if (change < .68) batch.setGeometryAt(ids[3], new THREE.TorusGeometry(2 + random(), .3, 5, 9));
      for (const camera of [perspective, orthographic]) {
        camera.position.set((random() - .5) * 300, 20 + random() * 200, (random() - .5) * 300); camera.lookAt((random() - .5) * 100, 0, (random() - .5) * 100);
        if (camera === perspective) { perspective.far = 200 + random() * 700; perspective.updateProjectionMatrix(); }
        camera.updateMatrixWorld();
        const three = draw(camera, false), kept = draw(camera, true);
        expect(kept).toEqual(three); drawn += three[0];
      }
    }
    // Transparent passes keep instance order.
    const glass = new THREE.MeshStandardMaterial({ transparent: true });
    expect(draw(perspective, true, glass)).toEqual(draw(perspective, false, glass));
  } finally { FleetBatch.keepBounds = true; }
  expect(drawn).toBeGreaterThan(1000);
  batch.dispose(); material.dispose(); geometries.forEach(g => g.dispose());
});

test('kept bounds are three\'s Sphere.applyMatrix4 of each instance\'s texture matrix, bit for bit', () => {
  let seed = 3;
  const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const geometries = [new THREE.BoxGeometry(2, 1, 4), new THREE.SphereGeometry(1.5, 8, 6), new THREE.TorusGeometry(2, .3, 5, 9)];
  const batch = new FleetBatch(40, 3000, 9000, new THREE.MeshStandardMaterial()), ids = geometries.map(g => batch.addGeometry(g));
  const matrix = new THREE.Matrix4(), expected = new THREE.Sphere(), internals = batch as unknown as { bounds: Float64Array; boundsGeometry: Int32Array };
  batch.sortObjects = false;
  for (let i = 0; i < 40; i++) batch.addInstance(ids[i % ids.length]);
  // The first cull adopts the texture; from then on every write refreshes its instance's bounds.
  batch.onBeforeRender(undefined as never, new THREE.Scene(), new THREE.PerspectiveCamera(), batch.geometry, batch.material as THREE.Material, null as never);
  for (let step = 0; step < 400; step++) {
    const instance = Math.floor(random() * 40);
    matrix.compose(new THREE.Vector3((random() - .5) * 9000, random() * 30, (random() - .5) * 9000),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(random() * 6, random() * 6, random() * 6)), new THREE.Vector3(.3 + random() * 3, .3 + random() * 3, .3 + random() * 3));
    batch.setMatrixAt(instance, matrix);
    batch.getBoundingSphereAt(batch.getGeometryIdAt(instance), expected)!.applyMatrix4(batch.getMatrixAt(instance, new THREE.Matrix4()));
    expect(Array.from(internals.bounds.subarray(instance * 4, instance * 4 + 4))).toEqual([expected.center.x, expected.center.y, expected.center.z, expected.radius]);
    expect(internals.boundsGeometry[instance]).toBe(batch.getGeometryIdAt(instance));
  }
  batch.dispose(); geometries.forEach(g => g.dispose());
});

test('the layout version moves with what draws and with which geometry, and kept bounds are three\'s', () => {
  const geometries = [new THREE.BoxGeometry(2, 1, 4), new THREE.SphereGeometry(1.5, 8, 6)], material = new THREE.MeshStandardMaterial();
  const batch = new FleetBatch(4, 400, 1200, material), [box, ball] = geometries.map(g => batch.addGeometry(g));
  const a = batch.addInstance(box), b = batch.addInstance(ball);
  let version = batch.layoutVersion;
  const moved = (change: () => unknown) => { change(); const bumped = batch.layoutVersion !== version; version = batch.layoutVersion; return bumped; };
  expect(moved(() => batch.setMatrixAt(a, new THREE.Matrix4().makeTranslation(1, 2, 3)))).toBe(false);
  expect(moved(() => batch.setVisibleAt(a, true))).toBe(false);
  expect(moved(() => batch.setVisibleAt(a, false))).toBe(true);
  expect(moved(() => batch.setGeometryIdAt(b, ball))).toBe(false);
  expect(moved(() => batch.setGeometryIdAt(b, box))).toBe(true);
  expect(moved(() => batch.addInstance(ball))).toBe(true);
  expect(moved(() => batch.deleteInstance(a))).toBe(true);
  expect(moved(() => batch.setGeometryAt(ball, new THREE.SphereGeometry(1, 6, 4)))).toBe(true);
  // Bounds kept from each pose, or brought up to date after a write the batch did not see, equal Sphere.applyMatrix4's.
  let seed = 3;
  const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const matrix = new THREE.Matrix4(), sphere = new THREE.Sphere(), poses = (batch as unknown as { _matricesTexture: THREE.DataTexture })._matricesTexture;
  for (let step = 0; step < 50; step++) {
    matrix.compose(new THREE.Vector3(random() * 100, random() * 10, random() * 100), new THREE.Quaternion().setFromEuler(new THREE.Euler(random() * 6, random() * 6, random() * 6)),
      new THREE.Vector3().setScalar(.5 + random()));
    if (step % 5 === 4) { matrix.toArray(poses.image.data as Float32Array, b * 16); poses.needsUpdate = true; }
    else batch.setMatrixAt(b, matrix);
    batch.getMatrixAt(b, matrix);
    batch.getBoundingSphereAt(batch.getGeometryIdAt(b), sphere)!.applyMatrix4(matrix);
    expect(Array.from(batch.partBoundsAt(b).subarray(b * 4, b * 4 + 4))).toEqual([sphere.center.x, sphere.center.y, sphere.center.z, sphere.radius]);
  }
  batch.dispose(); material.dispose(); geometries.forEach(g => g.dispose());
});

test('a cull that keeps the same parts in view leaves the uploaded instance ids alone', () => {
  const geometry = new THREE.BoxGeometry(), material = new THREE.MeshStandardMaterial();
  const batch = new FleetBatch(3, 48, 72, material), geometryId = batch.addGeometry(geometry);
  batch.sortObjects = false;
  for (const x of [0, 5, 100]) batch.setMatrixAt(batch.addInstance(geometryId), new THREE.Matrix4().makeTranslation(x, 0, -10));
  const camera = new THREE.PerspectiveCamera(60, 1, .5, 1000); camera.updateMatrixWorld();
  const ids = (batch as unknown as { _indirectTexture: THREE.DataTexture })._indirectTexture;
  const draw = () => {
    batch.invalidateDrawList();
    batch.onBeforeRender(undefined as never, new THREE.Scene(), camera, batch.geometry, material, null as never);
    return ids.version;
  };
  const first = draw();
  expect(first).toBeGreaterThan(0);
  // The parts move, the same two stay in view: nothing to upload.
  batch.setMatrixAt(0, new THREE.Matrix4().makeTranslation(1, 0, -10));
  expect(draw()).toBe(first);
  // The far part comes into view: the ids change.
  batch.setMatrixAt(2, new THREE.Matrix4().makeTranslation(-3, 0, -10));
  expect(draw()).toBe(first + 1);
  expect(Array.from(ids.image.data!).slice(0, 3)).toEqual([0, 1, 2]);
  FleetBatch.keepIds = false;
  try { expect(draw()).toBe(first + 2); } finally { FleetBatch.keepIds = true; }
  batch.dispose(); geometry.dispose(); material.dispose();
});

test('direct pose writes leave the matrix texture, kept bounds and culls as setMatrixAt does, marking the texture once a commit', () => {
  let seed = 13;
  const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const geometries = [new THREE.BoxGeometry(2, 1, 4), new THREE.SphereGeometry(1.5, 8, 6), new THREE.TorusGeometry(2, .3, 5, 9)], material = new THREE.MeshStandardMaterial();
  type Internals = { _matricesTexture: THREE.DataTexture; bounds: Float64Array; boundsGeometry: Int32Array; _multiDrawCount: number; _indirectTexture: THREE.DataTexture };
  const make = () => {
    const batch = new FleetBatch(50, 4000, 12000, material), ids = geometries.map(g => batch.addGeometry(g));
    batch.sortObjects = false;
    for (let i = 0; i < 50; i++) batch.addInstance(ids[i % ids.length]);
    return batch;
  };
  const direct = make(), reference = make(), camera = new THREE.PerspectiveCamera(50, 1.5, .5, 3000);
  const internals = (batch: FleetBatch) => batch as unknown as Internals;
  const draw = (batch: FleetBatch) => {
    batch.invalidateDrawList();
    batch.onBeforeRender(undefined as never, new THREE.Scene(), camera, batch.geometry, material, null as never);
    const n = internals(batch)._multiDrawCount;
    return Array.from(internals(batch)._indirectTexture.image.data as Uint32Array).slice(0, n);
  };
  const matrix = new THREE.Matrix4(), unknown = new THREE.Matrix4();
  let marked = 0;
  for (let step = 0; step < 300; step++) {
    const before = internals(direct)._matricesTexture.version, writes = Math.floor(random() * 8);
    for (let k = 0; k < writes; k++) {
      const instance = Math.floor(random() * 50);
      matrix.compose(new THREE.Vector3((random() - .5) * 2000, random() * 30, (random() - .5) * 2000),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(random() * 6, random() * 6, random() * 6)), new THREE.Vector3().setScalar(.3 + random() * 3));
      direct.writePose(instance, matrix.elements); reference.setMatrixAt(instance, matrix);
    }
    // A write neither batch saw voids their kept bounds alike; a detail change moves the instance's geometry.
    if (step % 17 === 16) for (const batch of [direct, reference]) { unknown.makeTranslation(step, 0, 0).toArray(internals(batch)._matricesTexture.image.data as Float32Array, 16); internals(batch)._matricesTexture.needsUpdate = true; }
    if (step % 11 === 10) for (const batch of [direct, reference]) batch.setGeometryIdAt(3, step % 3);
    direct.commitPoses();
    const version = internals(direct)._matricesTexture.version;
    if (writes) { expect(version).toBeGreaterThan(before); marked++; } else if (step % 17 !== 16) expect(version).toBe(before);
    for (const batch of [direct, reference]) batch.partBoundsAt(0);
    const a = internals(direct), b = internals(reference);
    expect(Array.from(a._matricesTexture.image.data as Float32Array)).toEqual(Array.from(b._matricesTexture.image.data as Float32Array));
    expect(Array.from(a.boundsGeometry)).toEqual(Array.from(b.boundsGeometry));
    for (let i = 0; i < 50; i++) if (a.boundsGeometry[i] >= 0) expect(Array.from(a.bounds.subarray(i * 4, i * 4 + 4))).toEqual(Array.from(b.bounds.subarray(i * 4, i * 4 + 4)));
    camera.position.set((random() - .5) * 600, 50 + random() * 300, (random() - .5) * 600); camera.lookAt((random() - .5) * 200, 0, (random() - .5) * 200); camera.updateMatrixWorld();
    expect(draw(direct)).toEqual(draw(reference));
  }
  expect(marked).toBeGreaterThan(200);
  // Off, the same call goes through three's setMatrixAt.
  FleetBatch.directPoses = false;
  try {
    const version = internals(direct)._matricesTexture.version;
    direct.writePose(1, matrix.elements); direct.writePose(2, matrix.elements);
    expect(internals(direct)._matricesTexture.version).toBe(version + 2);
  } finally { FleetBatch.directPoses = true; }
  direct.dispose(); reference.dispose(); material.dispose(); geometries.forEach(g => g.dispose());
});
