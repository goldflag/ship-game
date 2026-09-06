import { expect, test } from 'bun:test';
import { Mesh } from 'three/webgpu';
import { createBattleLandscape } from './BattleLandscape';
import { islandHeight, mapIslands, oceanMap } from '../maps/catalog';
import { disposeObjects } from './disposeObjects';

test('rendered island vertices match CPU terrain and upward-facing triangles', () => {
  for (const id of ['pacific-islands', 'arctic-passage', 'indian-volcanic-coast'] as const) {
    const islands = mapIslands(id, 5000, 1), root = createBattleLandscape(oceanMap(id), islands, 'medium');
    for (const island of islands) {
      const mesh = root.getObjectByName(island.id) as Mesh;
      const positions = mesh.geometry.getAttribute('position'), normals = mesh.geometry.getAttribute('normal');
      for (let i = 0; i < positions.count; i += 17) {
        expect(positions.getY(i)).toBeCloseTo(islandHeight(island, positions.getX(i), positions.getZ(i)), 1);
        if (normals.getY(i) !== 0) expect(normals.getY(i)).toBeGreaterThan(0);
      }
    }
    disposeObjects(root);
  }
});

test('terrain keeps its geography when deployment moves', () => {
  for (const id of ['pacific-islands', 'arctic-passage', 'indian-volcanic-coast'] as const) {
    const original = mapIslands(id, 1000, 1), shifted = mapIslands(id, 20000, 30);
    for (let i = 0; i < original.length; i++) {
      const a = original[i], b = shifted[i];
      for (const [u, v] of [[0,0], [.25,.3], [-.4,.2], [.5,-.5]]) {
        expect(islandHeight(a, a.x + a.rx*u, a.z + a.rz*v)).toBeCloseTo(islandHeight(b, b.x + b.rx*u, b.z + b.rz*v), 7);
      }
    }
  }
});
