import { expect, test } from 'bun:test';
import * as THREE from 'three/webgpu';
import { ExpandableInstances } from './ExpandableInstances';
import { prepareInstanceUploads } from './InstanceUploads';
test.each([false, true])('live objects grow, clear and repopulate across GPU pages (storage=%s)', storage => {
  const mesh = new ExpandableInstances(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), 256);
  mesh.geometry.setAttribute('opacity', new THREE.InstancedBufferAttribute(new Float32Array(256), 1));
  if (storage) prepareInstanceUploads(mesh);
  const matrix = new THREE.Matrix4();
  for (let i = 0; i < 1800; i++) {
    mesh.setMatrixAt(i, matrix.makeTranslation(i, 1, 2));
    mesh.setScalarAttributeAt('opacity', i, i / 2048);
  }
  mesh.publish(1800);
  expect(mesh.children.length).toBe(7);
  for (const page of [mesh, ...mesh.children as THREE.InstancedMesh[]]) expect(page.instanceMatrix.array.byteLength).toBeLessThanOrEqual(65536);
  const last = mesh.children.at(-1) as THREE.InstancedMesh;
  expect((last.geometry as THREE.InstancedBufferGeometry).instanceCount).toBe(8);
  expect(last.count).toBe(256);
  expect(last.instanceMatrix instanceof THREE.StorageInstancedBufferAttribute).toBe(storage);
  last.getMatrixAt(7, matrix); expect(matrix.elements[12]).toBe(1799);
  expect(last.geometry.getAttribute('opacity').getX(7)).toBe(1799 / 2048);
  mesh.publish(0);
  expect(mesh.visible).toBe(false);
  expect((last.geometry as THREE.InstancedBufferGeometry).instanceCount).toBe(0);
  for (const page of [mesh, ...mesh.children as THREE.InstancedMesh[]]) expect([...page.instanceMatrix.array].every(n => n === 0)).toBe(true);
  mesh.setMatrixAt(0, matrix.makeTranslation(-5, 3, 7));
  mesh.setScalarAttributeAt('opacity', 0, .25); mesh.publish(1);
  mesh.getMatrixAt(0, matrix); expect(matrix.elements[12]).toBe(-5);
  expect(mesh.geometry.getAttribute('opacity').getX(0)).toBe(.25);
  expect(mesh.visible).toBe(true);
  expect(mesh.children.every(page => !page.visible)).toBe(true);
  mesh.dispose(); mesh.geometry.dispose(); mesh.material.dispose();
});
