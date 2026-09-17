import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { itemOutlineGeometry } from './itemOutline';

test('item outlines include all nested model parts at their world positions, excluding other items', () => {
  const root = new THREE.Group();
  root.position.set(10, 2, -5); root.rotation.y = Math.PI / 2;
  const a = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2));
  const b = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2));
  const other = new THREE.Mesh(new THREE.BoxGeometry(50, 50, 50));
  a.userData.sourceId = b.userData.sourceId = 'gun'; other.userData.sourceId = 'other';
  b.position.x = 4; root.add(a, b, other);
  const outline = itemOutlineGeometry([a, b, other], 'gun');
  outline.computeBoundingBox();
  expect(outline.getAttribute('position').count).toBe(48);
  expect(outline.boundingBox!.min.toArray()).toEqual([9, 1, -10]);
  expect(outline.boundingBox!.max.toArray()).toEqual([11, 3, -4]);
  outline.dispose();
  // Disposing an outline must leave the source model's geometry usable.
  expect(a.geometry.getAttribute('position').count).toBe(24);
  for (const mesh of [a, b, other]) { mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose(); }
});
