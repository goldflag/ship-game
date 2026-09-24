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

test('publication clears exactly the slots written since, on every page, as clearing every tail did', () => {
  const mesh = new ExpandableInstances(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial(), 64);
  const pages = () => [mesh, ...mesh.children as THREE.InstancedMesh[]];
  let state = 5;
  const random = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296;
  const cleared: number[] = [];
  const fill = Float32Array.prototype.fill;
  try {
    for (let frame = 0; frame < 300; frame++) {
      const count = random() < .1 ? 0 : Math.floor(random() * (random() < .2 ? 300 : 90));
      // Writers fill instances [0, count) through page(), some leaving a zero scale; a few write past what they publish.
      const written = count + (random() < .1 ? Math.floor(random() * 20) : 0);
      for (let i = 0; i < written; i++) {
        const page = mesh.page(i), array = page.instanceMatrix.array as Float32Array;
        array.set(new THREE.Matrix4().makeTranslation(i + 1, frame, 1).elements, i % 64 * 16);
      }
      let floats = 0;
      for (const page of pages()) (page.instanceMatrix.array as Float32Array).fill = function (this: Float32Array, value: number, start = 0, end = this.length) {
        floats += end - start; return fill.call(this, value, start, end);
      };
      mesh.publish(count);
      cleared.push(floats);
      pages().forEach((page, p) => {
        const array = page.instanceMatrix.array as Float32Array;
        for (let slot = 0; slot < 64; slot++) {
          const index = p * 64 + slot;
          if (index < count) expect(array[slot * 16 + 12]).toBe(index + 1);
          else expect(array.subarray(slot * 16, slot * 16 + 16).every(v => v === 0)).toBe(true);
        }
        expect((page.geometry as THREE.InstancedBufferGeometry).instanceCount).toBe(Math.max(0, Math.min(64, count - p * 64)));
        expect(page.visible).toBe(count > p * 64);
      });
    }
    // A steady count clears nothing; the whole tail of every page was cleared before.
    expect(cleared.filter(n => n === 0).length).toBeGreaterThan(100);
  } finally { mesh.dispose(); mesh.geometry.dispose(); mesh.material.dispose(); }
});
