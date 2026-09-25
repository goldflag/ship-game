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
