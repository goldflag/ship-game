import { expect, test } from 'bun:test';
import * as THREE from 'three/webgpu';
import { AircraftPartsBatch, aircraftPartGroups } from './AircraftPartsBatch';

function sources() {
  const material = new THREE.MeshBasicMaterial();
  const parts = [new THREE.Mesh(new THREE.BoxGeometry(), material), new THREE.Mesh(new THREE.BoxGeometry(), material)];
  parts[1].position.set(3, 2, 1); parts[1].rotation.z = .7;
  parts.forEach(part => part.updateMatrixWorld(true));
  return parts;
}

test('aircraft batches preserve independent articulated poses through growth, removal and reentry', () => {
  const parts = sources(), batch = new AircraftPartsBatch(parts, 'test');
  const matrix = new THREE.Matrix4(), expected = new THREE.Matrix4();
  try {
    for (let plane = 0; plane < 130; plane++) {
      parts[1].rotation.z = plane * .01; parts[1].updateMatrixWorld(true);
      matrix.makeTranslation(plane * 10, 100, -plane);
      batch.setPose(plane, matrix);
      expected.multiplyMatrices(matrix, parts[1].matrixWorld);
      const actual = batch.mesh.getMatrixAt(plane * 2 + 1, new THREE.Matrix4());
      actual.elements.forEach((value, i) => expect(value).toBeCloseTo(expected.elements[i], 5));
    }
    batch.publish(130);
    expect(batch.mesh.getVisibleAt(259)).toBe(true);
    batch.publish(1);
    expect(batch.mesh.getVisibleAt(0)).toBe(true);
    expect(batch.mesh.getVisibleAt(2)).toBe(false);
    expect(batch.mesh.getVisibleAt(259)).toBe(false);
    batch.setPose(1, matrix.makeTranslation(7, 8, 9)); batch.publish(2);
    expect(batch.mesh.getVisibleAt(2)).toBe(true);
    expect(batch.mesh.getVisibleAt(4)).toBe(false);
    expect(batch.mesh.geometry.index!.array).toBeInstanceOf(Uint32Array);
    batch.publish(0); expect(batch.mesh.visible).toBe(false);
  } finally { batch.dispose(); parts.forEach(part => part.geometry.dispose()); (parts[0].material as THREE.Material).dispose(); }
});

test('dormant aircraft warmup restores visibility and does not overwrite an active pose', () => {
  const parts = sources(), batch = new AircraftPartsBatch(parts, 'test');
  try {
    const restore = batch.warmup()!;
    expect(batch.mesh.visible).toBe(true);
    restore(); expect(batch.mesh.visible).toBe(false);
    expect(batch.mesh.getVisibleAt(0)).toBe(false);
    const pose = new THREE.Matrix4().makeTranslation(15, 20, 25);
    batch.setPose(0, pose); batch.publish(1);
    expect(batch.warmup()).toBeUndefined();
    expect(batch.mesh.getMatrixAt(0, new THREE.Matrix4()).equals(pose)).toBe(true);
  } finally { batch.dispose(); parts.forEach(part => part.geometry.dispose()); (parts[0].material as THREE.Material).dispose(); }
});

test('aircraft grouping leaves transparency, reflected poses and incompatible vertex layouts separate', () => {
  const parts = sources();
  const transparent = new THREE.Mesh(parts[0].geometry, new THREE.MeshBasicMaterial({ transparent: true }));
  const reflected = new THREE.Mesh(parts[0].geometry, parts[0].material);
  reflected.scale.x = -1; reflected.updateMatrixWorld(true);
  const different = new THREE.Mesh(parts[0].geometry.clone(), parts[0].material);
  different.geometry.deleteAttribute('uv');
  try { expect(aircraftPartGroups([...parts, transparent, reflected, different])).toEqual([parts]); }
  finally { parts.forEach(part => part.geometry.dispose()); different.geometry.dispose(); transparent.material.dispose(); (parts[0].material as THREE.Material).dispose(); }
});
