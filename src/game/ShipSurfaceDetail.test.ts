import { expect, test } from 'bun:test';
import * as THREE from 'three/webgpu';
import { ShipMaterialPalette } from './ShipMaterialPalette';
import { PLATE, plateTexels, setShipSurfaceDetail, TEAK, teakTexels } from './ShipSurfaceDetail';

const channel = (pixels: Uint8Array, c: number) => pixels.filter((_, i) => i % 4 === c);
const mean = (values: ArrayLike<number>) => Array.from(values).reduce((a, b) => a + b, 0) / values.length;

test('plating relief averages out, so distant paint keeps its authored shading', () => {
  const size = PLATE.size, pixels = plateTexels(size);
  // Mipmaps average gradients; a biased tile would tilt every far hull.
  expect(Math.abs(mean(channel(pixels, 0)) - 127.5)).toBeLessThan(1);
  expect(Math.abs(mean(channel(pixels, 1)) - 127.5)).toBeLessThan(1);
  expect(Math.abs(mean(channel(pixels, 2)) / 255 - .5)).toBeLessThan(.05);
  // Strake seams run along whole rows every 2 m: the vertical gradient flips across them.
  const row = (y: number) => mean(Array.from({ length: size }, (_, x) => Math.abs(pixels[(y * size + x) * 4 + 1] - 127.5)));
  const seamRow = Math.round(PLATE.strake / (PLATE.tile / size)), midRow = seamRow + Math.round(seamRow / 2);
  expect(Math.max(row(seamRow - 1), row(seamRow))).toBeGreaterThan(4 * row(midRow));
});

test('teak keeps the map mean tone, with caulked planks and staggered butts', () => {
  const width = TEAK.width, length = TEAK.length, pixels = teakTexels(width, length);
  const albedo = channel(pixels, 0), caulk = channel(pixels, 1);
  const withCaulk = mean(Array.from(albedo, (r, i) => r / 127.5 * (1 - .62 * caulk[i] / 255)));
  expect(Math.abs(withCaulk - 1)).toBeLessThan(.01);
  // Longitudinal seams sit on every plank edge.
  const plankTexels = width * TEAK.plank / TEAK.across;
  expect(Math.max(caulk[Math.round(plankTexels) - 1], caulk[Math.round(plankTexels)])).toBeGreaterThan(40);
  // Butts: rows (along the ship) where a whole plank is caulked. Neighbouring planks never share one.
  const buttRows = (plank: number) => {
    const x = Math.round((plank + .5) * plankTexels);
    return Array.from({ length }, (_, z) => z).filter(z => caulk[z * width + x] > 25);
  };
  for (let plank = 0; plank < 15; plank++) {
    const a = buttRows(plank), b = new Set(buttRows(plank + 1));
    expect(a.length).toBeGreaterThan(0);
    expect(a.some(z => b.has(z))).toBe(false);
  }
});

test('ship palette classifies plated paint per vertex and teak per material, and can switch detail off', () => {
  const root = new THREE.Group(), palette = new ShipMaterialPalette({ surfaceDetail: true });
  const paint = (extra: Record<string, unknown>) => { const m = new THREE.MeshStandardMaterial({ roughness: .78 }); m.userData = extra; return m; };
  const hull = new THREE.Mesh(new THREE.BoxGeometry(10, 6, 40), paint({ surfaceFinish: 'painted-steel', paintId: 'x-authored-hullgray' }));
  const door = new THREE.Mesh(new THREE.BoxGeometry(1, 2, .1), paint({ surfaceFinish: 'painted-steel', paintId: 'x-authored-hullgray' }));
  const fitting = new THREE.Mesh(new THREE.BoxGeometry(10, 6, 40), paint({ surfaceFinish: 'painted-steel', paintId: 'x-authored-edge' }));
  const canvas = new THREE.Mesh(new THREE.BoxGeometry(10, 6, 40), paint({ componentMaterialRole: 'canvas' }));
  const map = new THREE.Texture(); map.wrapS = map.wrapT = THREE.RepeatWrapping;
  const teakMaterial = new THREE.MeshStandardMaterial({ map }); teakMaterial.name = 'Teak decking - original procedural planks';
  const deck = new THREE.Mesh(new THREE.BoxGeometry(10, .2, 40), teakMaterial);
  root.add(hull, door, fitting, canvas, deck); palette.apply(root);
  const plated = (mesh: THREE.Mesh) => mesh.geometry.getAttribute('shipSurface').getZ(0);
  expect([hull, door, fitting, canvas].map(plated)).toEqual([1, 0, 0, 0]);
  expect(hull.material).toBe(canvas.material);
  const shared = hull.material as unknown as THREE.MeshStandardNodeMaterial, teak = deck.material as unknown as THREE.MeshStandardNodeMaterial;
  expect(shared.normalNode).not.toBeNull(); expect(teak.colorNode).not.toBeNull(); expect(teak.userData.shipSurfaceMode).toBe('teak');
  setShipSurfaceDetail(root, false);
  expect(shared.normalNode).toBeNull(); expect(teak.colorNode).toBeNull(); expect(teak.normalNode).toBeNull();
  setShipSurfaceDetail(root, true);
  expect(shared.normalNode).not.toBeNull(); expect(teak.colorNode).not.toBeNull();
});

test('aircraft palettes stay without surface detail', () => {
  const root = new THREE.Group(), mesh = new THREE.Mesh(new THREE.BoxGeometry(10, 6, 40), new THREE.MeshStandardMaterial());
  mesh.material.userData = { surfaceFinish: 'painted-steel' }; root.add(mesh);
  new ShipMaterialPalette().apply(root);
  expect((mesh.material as unknown as THREE.MeshStandardNodeMaterial).normalNode).toBeNull();
  expect(mesh.geometry.getAttribute('shipSurface').getZ(0)).toBe(0);
});
