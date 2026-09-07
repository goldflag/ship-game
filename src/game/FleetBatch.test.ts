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
