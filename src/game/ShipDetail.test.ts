import { expect, test } from 'bun:test';
import * as THREE from 'three/webgpu';
import { loadShipGeometry } from '../../scripts/diagnostics/load-ship-geometry';
import { MIXED_SHIPS } from '../../scripts/diagnostics/mixed-fleet';
import { batchShipModel } from './ShipBatching';
import { prepareShipDetail, shipDetailLevels } from './ShipDetail';
import { FleetShipDraws } from './FleetShipDraws';
import type { ShipView } from './ShipView';

test('all ten ship presets retain their original geometry and vertex attributes alongside smaller render buffers', async () => {
  for (const id of MIXED_SHIPS) {
    const model = await loadShipGeometry(id);
    batchShipModel(model);
    const meshes: THREE.Mesh[] = [];
    model.traverse(o => { if (o instanceof THREE.Mesh) meshes.push(o); });
    const hashes = meshes.map(m => Bun.hash(m.geometry.index?.array ?? m.geometry.attributes.position.array));
    await prepareShipDetail(model);
    let originalTriangles = 0, distantTriangles = 0;
    for (const [i, mesh] of meshes.entries()) {
      const original = mesh.geometry, levels = shipDetailLevels(original), distant = levels.at(-1)!.geometry;
      expect(levels[0].geometry).toBe(original);
      expect(Bun.hash(original.index?.array ?? original.attributes.position.array)).toBe(hashes[i]);
      originalTriangles += (original.index?.count ?? original.attributes.position.count) / 3;
      distantTriangles += (distant.index?.count ?? distant.attributes.position.count) / 3;
      if (distant === original) continue;
      expect(Object.keys(distant.attributes)).toEqual(Object.keys(original.attributes));
      // Simplification chooses existing vertices; it must not invent normals,
      // UVs or colors, or move sockets by modifying the authored surface.
      const signature = (g: THREE.BufferGeometry, vertex: number) => Object.values(g.attributes).flatMap(a =>
        Array.from({ length: a.itemSize }, (_, c) => a.array[vertex * a.itemSize + c])).join(',');
      const vertices = new Set(Array.from({ length: original.attributes.position.count }, (_, j) => signature(original, j)));
      for (let j = 0; j < distant.attributes.position.count; j += Math.max(1, Math.floor(distant.attributes.position.count / 20))) {
        expect(vertices.has(signature(distant, j))).toBe(true);
      }
      expect(levels.every(level => Number.isFinite(level.error) && level.error >= 0)).toBe(true);
    }
    expect(distantTriangles).toBeLessThan(originalTriangles * .25);
  }
}, 30000);

test('distance and binocular zoom select detail, subpixel parts return, and inspection restores authored surfaces', async () => {
  const geometry = new THREE.SphereGeometry(1, 64, 32), material = new THREE.MeshStandardMaterial();
  const template = new THREE.Group(); template.add(new THREE.Mesh(geometry, material));
  await prepareShipDetail(template);
  const levels = shipDetailLevels(geometry);
  expect(levels.length).toBeGreaterThan(1);
  const views = [0, 1].map(() => {
    const model = template.clone(true), mesh = model.children[0] as THREE.Mesh, root = new THREE.Group();
    root.add(model);
    root.updateMatrixWorld(true);
    return { root, model, renderMeshes: [{ mesh, material }], impactMarks: { renderMeshes: [] }, inspection: { mode: 'exterior' } } as unknown as ShipView;
  });
  const draws = new FleetShipDraws(views);
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, .1, 100000);
  const viewAt = (distance: number, zoom = 1) => {
    camera.position.z = distance; camera.zoom = zoom;
    camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
    draws.update(camera, 1080);
  };
  viewAt(100);
  expect(draws.diagnostics().reduced).toBe(2);
  viewAt(100, 100);
  expect(draws.diagnostics().reduced).toBe(0);
  viewAt(10000);
  expect(draws.diagnostics().subpixel).toBe(2);
  expect(draws.diagnostics().instances).toBe(0);
  viewAt(10000, 100);
  expect(draws.diagnostics().instances).toBe(2);
  views[0].inspection.mode = 'all';
  viewAt(100);
  expect(views[0].renderMeshes[0].mesh.layers.mask).toBe(1);
  expect(views[0].renderMeshes[0].mesh.geometry).toBe(geometry);
  views[1].root.visible = false;
  viewAt(100);
  expect(draws.diagnostics().instances).toBe(0);
  draws.dispose();
});
