import { expect, test } from 'bun:test';
import * as THREE from 'three';
import type { ConstructionPrimitive } from '../../ships/blueprint';
import { emptyShaping } from '../../ships/freeformShape';
import { boundaryGeometry } from './boundaryGeometry';

const hull: ConstructionPrimitive = { id: 'hull', kind: 'wedge', size: [10, 4, 20], position: [14, 3, 25], rotationDeg: 0 };
function bounds(primitives: ConstructionPrimitive[], axis: 'x' | 'y' | 'z', offset: number) {
  const geometry = boundaryGeometry(primitives, axis, offset);
  geometry.computeBoundingBox();
  return geometry.boundingBox!;
}

test('boundary sections stay within the translated hull on every axis', () => {
  for (const [axis, offset] of [['x', 14], ['y', 3], ['z', 25]] as const) {
    const box = bounds([hull], axis, offset);
    expect(box.isEmpty()).toBe(false);
    expect(new THREE.Box3(new THREE.Vector3(9, 1, 15), new THREE.Vector3(19, 5, 35)).containsBox(box)).toBe(true);
    expect(box.min[axis]).toBe(offset);
    expect(box.max[axis]).toBe(offset);
  }
});
test('a plane outside the hull has no selectable or visible geometry', () => {
  expect(bounds([hull], 'y', 8).isEmpty()).toBe(true);
});
test('moving a section through a tapered hull changes its outline', () => {
  const low = bounds([hull], 'y', 1.5), high = bounds([hull], 'y', 4.5);
  expect(low.getSize(new THREE.Vector3()).z).not.toBe(high.getSize(new THREE.Vector3()).z);
});
test('disconnected hulls keep the water gap empty', () => {
  const geometry = boundaryGeometry([-5, 5].map(x => ({ ...hull, kind: 'box', size: [2, 4, 20], position: [x, 0, 0] })), 'y', 0);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  mesh.updateMatrixWorld();
  expect(new THREE.Raycaster(new THREE.Vector3(0, 10, 0), new THREE.Vector3(0, -1, 0)).intersectObject(mesh)).toHaveLength(0);
  expect(new THREE.Raycaster(new THREE.Vector3(5, 10, 0), new THREE.Vector3(0, -1, 0)).intersectObject(mesh).length).toBeGreaterThan(0);
});

test('a section preserves the hole in a hollow hull primitive', () => {
  const geometry = boundaryGeometry([{ ...hull, kind: 'hollow-cube', position: [0, 0, 0] }], 'y', 0);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  mesh.updateMatrixWorld();
  const ray = (x: number, z: number) => new THREE.Raycaster(new THREE.Vector3(x, 10, z), new THREE.Vector3(0, -1, 0)).intersectObject(mesh);
  expect(ray(0, 0)).toHaveLength(0);
  expect(ray(4.9, 9.9).length).toBeGreaterThan(0);
});

test('rotated hull sections stay attached to their source position', () => {
  const geometry = boundaryGeometry([{ ...hull, kind: 'box', rotationDeg: 45 }], 'y', 3);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  mesh.updateMatrixWorld();
  expect(new THREE.Raycaster(new THREE.Vector3(14, 10, 25), new THREE.Vector3(0, -1, 0)).intersectObject(mesh).length).toBeGreaterThan(0);
  expect(new THREE.Raycaster(new THREE.Vector3(24, 10, 15), new THREE.Vector3(0, -1, 0)).intersectObject(mesh)).toHaveLength(0);
});

for (const style of ['round', 'chamfer'] as const) test(`${style} edge treatments constrain the internal section`, () => {
  const geometry = boundaryGeometry([{ ...hull, kind: 'vertex', size: [4, 4, 4], position: [0, 0, 0],
    shaping: { ...emptyShaping(), style, radius: 1, edges: Array.from({ length: 12 }, (_, i) => i) } }], 'y', 0);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  mesh.updateMatrixWorld();
  const ray = (x: number, z: number) => new THREE.Raycaster(new THREE.Vector3(x, 10, z), new THREE.Vector3(0, -1, 0)).intersectObject(mesh);
  expect(ray(0, 0).length).toBeGreaterThan(0);
  expect(ray(1.9, 1.9)).toHaveLength(0);
});
