import { expect, test } from 'bun:test';
import { Group, type InstancedBufferGeometry, type Material, type Mesh } from 'three/webgpu';
import { createBattleLandscape, TERRAIN_LOD } from './BattleLandscape';
import { heightBounds, sampleHeights } from './terrain/TerrainField';
import { PATCH_FLOATS, PATCH_QUADS, TerrainLod } from './terrain/TerrainLod';
import { oceanMap } from '../maps/catalog';
import { OPEN_SEA, OPEN_SEA_M, type Heightfield } from '../maps/heightfield';
import { installMapTerrain } from '../maps/testing';

/** The vertex shader's height (`terrainHeight` in TerrainMaterial) on the CPU: texels of the height texture, the same
 * clamps and the same bilinear order, in single precision as the GPU evaluates it. */
function shaderHeight(field: Heightfield, texels: Float32Array, x: number, z: number): number {
  const f = Math.fround, gx = f(f(x - field.originX) / field.cell), gz = f(f(z - field.originZ) / field.cell);
  if (!(gx >= 0 && gz >= 0 && gx <= field.columns - 1 && gz <= field.rows - 1)) return OPEN_SEA_M;
  const i = Math.min(Math.max(Math.floor(gx), 0), field.columns - 2), j = Math.min(Math.max(Math.floor(gz), 0), field.rows - 2);
  const u = f(gx - i), v = f(gz - j), at = j * field.columns + i;
  const top = f(f(texels[at] * f(1 - u)) + f(texels[at + 1] * u));
  const bottom = f(f(texels[at + field.columns] * f(1 - u)) + f(texels[at + field.columns + 1] * u));
  return f(f(top * f(1 - v)) + f(bottom * v));
}

test('every level-0 vertex the terrain draws stands on the heightfield the simulation reads', async () => {
  const field = await installMapTerrain('vestfjord'), texels = sampleHeights(field), settings = TERRAIN_LOD.high;
  for (let k = 0; k < texels.length; k += 997) expect(texels[k]).toBe(field.sample(k % field.columns, Math.floor(k / field.columns)));
  const [minX, minZ, maxX, maxZ] = field.bounds();
  const lod = new TerrainLod({ originX: minX, originZ: minZ, width: maxX - minX, depth: maxZ - minZ, cell: field.cell,
    bounds: heightBounds(field, texels, 8) }, settings);
  const out = new Float32Array(6144 * PATCH_FLOATS);
  const count = lod.select({ position: [2000, 40, -6000], planes: [], fovY: .9, heightPx: 900 }, out);
  let checked = 0, level0 = 0;
  for (let p = 0; p < count; p++) {
    const [cx, cz, level] = out.subarray(p * PATCH_FLOATS, p * PATCH_FLOATS + 3);
    if (level !== 0) continue;
    level0++;
    for (let j = 0; j <= PATCH_QUADS; j += 3) for (let i = 0; i <= PATCH_QUADS; i += 3) {
      const x = cx + i * settings.spacing, z = cz + j * settings.spacing;
      expect(Math.abs(shaderHeight(field, texels, x, z) - field.height(x, z))).toBeLessThan(2e-3);
      checked++;
    }
  }
  expect(level0).toBeGreaterThan(20);
  expect(checked).toBeGreaterThan(1000);
  // The level-0 patches with land lead the buffer, where the trees read them.
  for (let p = 0; p < lod.nearLand; p++) expect(out[p * PATCH_FLOATS + 2]).toBe(0);
  // Past `treePatches` of them, only the nearest carry trees, and they end before the nearest bare one.
  lod.treePatches = 12;
  lod.select({ position: [2000, 40, -6000], planes: [], fovY: .9, heightPx: 900 }, out);
  expect(lod.nearLand).toBe(12);
  const reach = (p: number) => Math.hypot(out[p * PATCH_FLOATS] + 160 - 2000, out[p * PATCH_FLOATS + 1] + 160 + 6000);
  for (let p = 1; p < 12; p++) expect(reach(p)).toBeGreaterThanOrEqual(reach(p - 1));
  expect(lod.treeReach).toBeLessThan(reach(12));
  expect(lod.treeReach).toBeGreaterThan(0);
});

test('the land builds its view, follows no camera of its own, and leaves the scene when disposed', async () => {
  const field = await installMapTerrain('strait-of-dover');
  const view = createBattleLandscape(oceanMap('strait-of-dover'), { field, offset: [0, -2500] }, 'high');
  const [land, trees] = view.root.children as Mesh<InstancedBufferGeometry>[];
  expect(land.position.toArray()).toEqual([0, 0, -2500]);
  expect(land.geometry.instanceCount).toBe(0);
  expect(trees.geometry.getAttribute('terrainPatch')).toBe(land.geometry.getAttribute('terrainPatch'));
  const disposed: string[] = [];
  for (const object of [land, trees]) {
    object.geometry.addEventListener('dispose', () => disposed.push(`${object.name} geometry`));
    (object.material as Material).addEventListener('dispose', () => disposed.push(`${object.name} material`));
  }
  const scene = new Group();
  scene.add(view.root);
  view.update(undefined as never);
  view.dispose();
  view.dispose();
  expect(view.root.parent).toBeNull();
  expect(disposed).toHaveLength(4);
  const medium = createBattleLandscape(oceanMap('strait-of-dover'), { field, offset: [0, 0] }, 'medium');
  expect(medium.root.children).toHaveLength(1);
  medium.dispose();
});

test('an open-sea map has no land to draw', () => {
  const view = createBattleLandscape(oceanMap('north-atlantic'), OPEN_SEA, 'high');
  expect(view.root.children).toHaveLength(0);
  const scene = new Group();
  scene.add(view.root);
  view.update(undefined as never);
  view.dispose();
  expect(view.root.parent).toBeNull();
});
