import { expect, test } from 'bun:test';
import * as THREE from 'three/webgpu';
import { float } from 'three/tsl';
import { ShipMaterialPalette, wetBandHeight } from './ShipMaterialPalette';

test('different linear paint colors share shading while preserving every vertex and texture', () => {
  const root = new THREE.Group(), geometry = new THREE.BoxGeometry();
  const map = new THREE.Texture(), palette = new ShipMaterialPalette();
  const a = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: '#56789a', map, roughness: .8 }));
  const b = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: '#785632', map, roughness: .8 }));
  const colors = [a.material.color.clone(), b.material.color.clone()];
  root.add(a, b); palette.apply(root);
  expect(a.material).toBe(b.material); expect(a.material.map).toBe(map); expect(a.material.color.toArray()).toEqual([1, 1, 1]);
  for (const [i, mesh] of [a, b].entries()) {
    expect(mesh.geometry.index!.array).toEqual(geometry.index!.array);
    for (const name of ['position', 'normal', 'uv']) expect(mesh.geometry.getAttribute(name).array).toEqual(geometry.getAttribute(name).array);
    const paint = mesh.geometry.getAttribute('color');
    for (let v = 0; v < paint.count; v++) for (let c = 0; c < 3; c++) expect(paint.getComponent(v, c)).toBeCloseTo(colors[i].toArray()[c], 6);
  }
  const other = new THREE.Group(), c = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ map, roughness: .8 }));
  other.add(c); palette.apply(other); expect(c.material).toBe(a.material);
});

test('surface parameters remain per vertex; distinct textures and custom materials remain independent', () => {
  const root = new THREE.Group(), geometry = new THREE.BoxGeometry(), palette = new ShipMaterialPalette();
  const materials = [new THREE.MeshStandardMaterial({roughness:.8}), new THREE.MeshStandardMaterial({roughness:.7}),
    new THREE.MeshStandardMaterial({map:new THREE.Texture()}), new THREE.MeshStandardMaterial({map:new THREE.Texture()}),
    new THREE.MeshStandardMaterial({transparent:true,opacity:.5}), new THREE.MeshStandardMaterial({vertexColors:true})];
  const meshes = materials.map(m => new THREE.Mesh(geometry, m)); root.add(...meshes);
  palette.apply(root);
  expect(meshes[0].material).toBe(meshes[1].material);
  expect(meshes[0].geometry.getAttribute('shipSurface').getX(0)).toBeCloseTo(.8);
  expect(meshes[1].geometry.getAttribute('shipSurface').getX(0)).toBeCloseTo(.7);
  expect(new Set(meshes.map(m=>m.material)).size).toBe(materials.length - 1);
  expect(meshes[4].material).toBe(materials[4]); expect(meshes[5].material).toBe(materials[5]);
  expect(meshes[4].geometry).toBe(geometry); expect(meshes[5].geometry).toBe(geometry);
});

test('texture pixels are never read while keying materials', () => {
  // Serializing a texture encodes it to a base64 PNG (or copies out every sample), costs
  // seconds across a fleet, and is thrown away — the key only needs the image UUID.
  let reads = 0;
  const image = { width: 4, height: 4, get data() { reads++; return new Uint8Array(64); } };
  const root = new THREE.Group(), geometry = new THREE.BoxGeometry(), palette = new ShipMaterialPalette();
  const textured = () => new THREE.MeshStandardMaterial({ map: new THREE.Texture(image as unknown as ImageData) });
  root.add(...[textured(), textured(), textured()].map(material => new THREE.Mesh(geometry, material)));
  palette.apply(root);
  expect(reads).toBe(0);
});

test('every paint carries its hull\'s wet-band height, and weathering layers over surface detail with one wrapper per base', () => {
  const dry = float(.8), gloss = float(.5), palette = new ShipMaterialPalette({ surfaceDetail: true, weathering: { dry, gloss } });
  const hull = (length: number, material: THREE.MeshStandardMaterial) => {
    const root = new THREE.Group(), mesh = new THREE.Mesh(new THREE.BoxGeometry(10, 10, length), material);
    root.add(mesh); palette.apply(root); return mesh;
  };
  const map = new THREE.Texture(); map.wrapS = map.wrapT = THREE.RepeatWrapping;
  const teak = (color = '#ffffff') => new THREE.MeshStandardMaterial({ name: 'Teak decking', map, color });
  const destroyer = hull(110, new THREE.MeshStandardMaterial({ color: '#445566' })), battleship = hull(260, new THREE.MeshStandardMaterial({ color: '#665544' }));
  const surface = destroyer.geometry.getAttribute('shipSurface');
  expect(surface.itemSize).toBe(4);
  expect(surface.getW(0)).toBeCloseTo(wetBandHeight(110));
  expect(battleship.geometry.getAttribute('shipSurface').getW(0)).toBeCloseTo(wetBandHeight(260));
  expect(wetBandHeight(260)).toBeGreaterThan(wetBandHeight(110));
  expect(destroyer.material).toBe(battleship.material);
  const paint = destroyer.material as unknown as THREE.MeshStandardNodeMaterial;
  const planks = hull(200, teak()).material as unknown as THREE.MeshStandardNodeMaterial;
  expect(planks).not.toBe(paint);
  // Each wraps its own detail: paint its plated roughness, teak its planked colour and roughness.
  expect(paint.colorNode).not.toBeNull(); expect(planks.colorNode).not.toBeNull(); expect(paint.normalNode).not.toBeNull();
  expect(planks.colorNode).not.toBe(paint.colorNode); expect(planks.roughnessNode).not.toBe(paint.roughnessNode);
  // Another teak hull, stained differently, shares the palette entry and its wrappers.
  const other = hull(150, teak('#d0c0a0')).material as unknown as THREE.MeshStandardNodeMaterial;
  expect(other.colorNode).toBe(planks.colorNode); expect(other.roughnessNode).toBe(planks.roughnessNode);
  // Ship views clone the paint; switching surface detail keeps the band over the new nodes.
  const clone = paint.clone(), root = new THREE.Group();
  expect(clone.colorNode).toBe(paint.colorNode);
  root.add(new THREE.Mesh(new THREE.BoxGeometry(), clone));
  palette.setSurfaceDetail(root, false);
  expect(clone.normalNode).toBeNull();
  expect(clone.roughnessNode).not.toBe(paint.roughnessNode); expect(clone.colorNode).toBe(paint.colorNode);
  palette.setSurfaceDetail(root, true);
  expect(clone.roughnessNode).toBe(paint.roughnessNode);
});
