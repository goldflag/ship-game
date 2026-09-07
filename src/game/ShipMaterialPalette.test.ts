import { expect, test } from 'bun:test';
import * as THREE from 'three/webgpu';
import { ShipMaterialPalette } from './ShipMaterialPalette';

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
