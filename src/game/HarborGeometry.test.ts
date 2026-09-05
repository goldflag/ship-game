import { expect, test } from 'bun:test';
import * as THREE from 'three/webgpu';
import { HarborGeometry, type HarborMaterials } from './HarborGeometry';
import { HarborStructures } from './HarborStructures';
import { createHarborTerrain, terrainHeight } from './HarborTerrain';

test('town walls have one visible surface at each facade bay', () => {
  const root = new THREE.Group();
  const material = new THREE.MeshStandardMaterial();
  const materials = new Proxy({} as HarborMaterials, { get: () => material });
  const geometry = new HarborGeometry(root);
  new HarborStructures(root, geometry, materials).house(-800, 0, 22, 30, 3);
  geometry.finish();
  root.updateMatrixWorld(true);
  const ground = Math.max(6.4, ...[-1, 1].flatMap(sx => [-1, 1].map(sz => terrainHeight(-800 + sx * 11, sz * 15)))) + .08;
  const hits = new THREE.Raycaster(new THREE.Vector3(-760, ground + 5, 1), new THREE.Vector3(-1, 0, 0), 0, 40).intersectObject(root, true);
  expect(hits.length).toBe(1);
  root.traverse(object => { if (object instanceof THREE.Mesh) object.geometry.dispose(); });
  material.dispose();
});

// This test uses the actual rendered triangle mesh, including its diagonal and
// float32 coordinates, rather than comparing two copies of a noise function.
for (const quality of ['medium', 'high']) test(`terrain roots match the rendered ${quality} surface`, () => {
  const map = new THREE.Texture();
  const textures = new Proxy({} as Record<string, THREE.Texture>, { get: () => map });
  const terrain = createHarborTerrain(textures, quality);
  terrain.updateMatrixWorld(true);
  const ray = new THREE.Raycaster();
  for (const [x, z] of [[-1913, -71], [-1573.7, 472.1], [-2000, -1000], [-1000.01, 33.2], [-999.99, 33.2], [2061.3, -428.6]]) {
    ray.set(new THREE.Vector3(x, 2000, z), new THREE.Vector3(0, -1, 0));
    const hit = ray.intersectObject(terrain, true)[0];
    expect(hit).toBeDefined();
    expect(Math.abs(terrainHeight(x, z, quality) - hit.point.y)).toBeLessThan(.002);
  }
  terrain.traverse(object => { if (object instanceof THREE.Mesh) { object.geometry.dispose(); (object.material as THREE.Material).dispose(); } });
  map.dispose();
});
