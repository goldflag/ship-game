import { expect, test } from 'bun:test';
import * as THREE from 'three/webgpu';
import { ShipMaterialPalette } from './ShipMaterialPalette';
import { finishTexels, isPlatedPaint, PLATE, plateTexels, setShipSurfaceDetail, STREAK, streakTexels, TEAK, teakTexels } from './ShipSurfaceDetail';

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

test('construction plating shares the premade tile seams, draws a line along each and a shade per plate, and tilts nothing far off', () => {
  const size = PLATE.size, finish = finishTexels(size), plate = plateTexels(size);
  expect(Math.abs(mean(channel(finish, 0)) - 127.5)).toBeLessThan(1);
  expect(Math.abs(mean(channel(finish, 1)) - 127.5)).toBeLessThan(1);
  expect(Math.abs(mean(channel(finish, 3)) - 127.5)).toBeLessThan(3);
  const perStrake = Math.round(PLATE.strake / (PLATE.tile / size)), at = (pixels: Uint8Array, x: number, y: number, c: number) => pixels[(y * size + x) * 4 + c];
  for (let strake = 0; strake < PLATE.tile / PLATE.strake; strake++) {
    const seamRow = strake * perStrake, middle = seamRow + perStrake / 2;
    // A strake seam is a line of grime along its whole length; mid-strake paint carries none except at the butts.
    const line = mean(Array.from({ length: size }, (_, x) => at(finish, x, seamRow, 2)));
    expect(line).toBeGreaterThan(80);
    const butts = Array.from({ length: size }, (_, x) => x).filter(x => at(finish, x, middle, 2) > 60);
    expect(butts.length).toBeGreaterThan(0);
    expect(butts.length).toBeLessThan(size / 50);
    // Each butt lies where the premade tile's weld groove flips its gradient along the strake.
    for (const x of butts) {
      const groove = [-3, -2, -1, 0, 1, 2, 3].map(d => Math.abs(at(plate, (x + d + size) % size, middle, 0) - 127.5));
      expect(Math.max(...groove)).toBeGreaterThan(20);
    }
    // Plates either side of a butt take their own shade.
    const shade = (x: number) => mean(Array.from({ length: 32 }, (_, k) => at(finish, (x + k) % size, middle - 20 + k, 3)));
    expect(Math.abs(shade(butts[0] + 40) - shade((butts[0] - 72 + size) % size))).toBeGreaterThan(2);
  }
});

test('runoff streaks hang from the edge, grow with wear and end before the tile foot; mottling averages out', () => {
  const pixels = streakTexels(), { width, height } = STREAK;
  const row = (y: number, level: number) => mean(Array.from({ length: width }, (_, x) => pixels[(y * width + x) * 4 + level]));
  const levels = [0, 1, 2, 3].map(level => mean(channel(pixels, level)));
  for (let level = 1; level < 4; level++) expect(levels[level]).toBeGreaterThan(levels[level - 1]);
  // Most coverage right under the edge; nothing left at the foot, where `WEAR_NONE` clamps.
  for (let level = 0; level < 4; level++) { expect(row(0, level)).toBeGreaterThan(row(Math.round(height / 4), level)); expect(row(height - 1, level)).toBe(0); }
  // A streak drawn at one wear is drawn at every greater wear.
  for (let k = 0; k < width * height; k++) for (let level = 1; level < 4; level++) if (pixels[k * 4 + level - 1] > 128) expect(pixels[k * 4 + level]).toBeGreaterThan(0);
  expect(Math.abs(mean(channel(plateTexels(), 3)) - 127.5)).toBeLessThan(1.5);
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
  // Without detail, paint draws no wear either: its colour is the plain material colour.
  setShipSurfaceDetail(root, false);
  expect(shared.normalNode).toBeNull(); expect(shared.colorNode).toBeNull(); expect(teak.colorNode).toBeNull(); expect(teak.normalNode).toBeNull();
  setShipSurfaceDetail(root, true);
  expect(shared.normalNode).not.toBeNull(); expect(shared.colorNode).not.toBeNull(); expect(teak.colorNode).not.toBeNull();
});

test('player-built hulls, blocks and painted design-local fittings are plate; timber and component finishes keep their class', () => {
  const named = (name: string, userData: Record<string, unknown> = {}) => { const m = new THREE.MeshStandardMaterial(); m.name = name; m.userData = userData; return m; };
  expect(isPlatedPaint(named('construction.light-gray'))).toBe(true);
  expect(isPlatedPaint(named('custom-fitting.light-gray'))).toBe(true);
  expect(isPlatedPaint(named('custom-fitting.light-gray.roof'))).toBe(true);
  expect(isPlatedPaint(named('custom-fitting.teak-natural'))).toBe(false);
  expect(isPlatedPaint(named('custom-fitting', { componentMaterialRole: 'canvas' }))).toBe(false);
  expect(isPlatedPaint(named('custom-fitting', { componentMaterialRole: 'naval' }))).toBe(true);
  expect(isPlatedPaint(named('custom-fittings-panel'))).toBe(false);
});

test('aircraft palettes stay without surface detail', () => {
  const root = new THREE.Group(), mesh = new THREE.Mesh(new THREE.BoxGeometry(10, 6, 40), new THREE.MeshStandardMaterial());
  mesh.material.userData = { surfaceFinish: 'painted-steel' }; root.add(mesh);
  new ShipMaterialPalette().apply(root);
  expect((mesh.material as unknown as THREE.MeshStandardNodeMaterial).normalNode).toBeNull();
  expect(mesh.geometry.getAttribute('shipSurface').getZ(0)).toBe(0);
});
