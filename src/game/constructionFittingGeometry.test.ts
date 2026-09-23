import { expect, test } from 'bun:test';
import * as THREE from 'three';
import catalog from '../../public/models/components/catalog.json';
import type { ConstructionEquipmentPart, ConstructionFittingDefinition, ConstructionSurface, Vec3 } from '../ships/blueprint';
import { componentMaterial } from '../ships/componentMaterials';
import { encodeFittingMesh, type FittingMeshTriangle } from '../ships/constructionFittingMesh';
import { createConstructionFittingModel, fittingModelTriangles, type FittingRoof } from './constructionFittingModel';
import { paintConstructionFitting } from './constructionFittingPaint';
import { createConstructionWallModel } from './constructionWallModel';
import { constructionTubeGeometry } from './constructionTubeGeometry';
import { disposeConstructionModel } from './constructionModel';

test('resizing installed vents adds fins with a constant physical section', () => {
  const surfaces = [{ normal: [0, 0, -1], open: false, vertices: [[-3, -3, 0], [-3, 3, 0], [3, 3, 0], [3, -3, 0]] }] as ConstructionSurface[];
  for (const id of ['generic-louvered-vent', 'generic-round-wall-vent']) {
    const part = catalog.equipment.find(p => p.id === id)! as ConstructionEquipmentPart;
    const counts: number[] = [], sections: THREE.Vector3[] = [];
    for (const heightM of [.3, .55, 1.1, 2.2]) {
      const model = createConstructionWallModel(new THREE.Group(), part, { id: 'vent', partId: id, position: [0, 0, 0], bearingDeg: 0, wall: { version: 1, widthM: .8, heightM } }, surfaces);
      const fins = model.children.filter(n => n.name === 'vent-fin') as THREE.Mesh[];
      counts.push(fins.reduce((sum, fin) => sum + fin.geometry.getAttribute('position').count / (id === 'generic-louvered-vent' ? 4 : 24), 0));
      for (const fin of fins) {
        const position = fin.geometry.getAttribute('position'), stride = id === 'generic-louvered-vent' ? 4 : 24;
        for (let i = 0; i < position.count; i += stride) {
          const bounds = new THREE.Box3().setFromPoints(Array.from({ length: stride }, (_, j) => new THREE.Vector3().fromBufferAttribute(position, i + j)));
          sections.push(bounds.getSize(new THREE.Vector3()));
          expect(bounds.min.y).toBeGreaterThanOrEqual(-heightM / 2);
          expect(bounds.max.y).toBeLessThanOrEqual(heightM / 2);
        }
      }
      disposeConstructionModel(model);
    }
    for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeGreaterThan(counts[i - 1]);
    for (const section of sections) { expect(section.y).toBeCloseTo(sections[0].y, 6); expect(section.z).toBeCloseTo(sections[0].z, 6); }
  }
});

test('ladder corners are a closed shared mesh with six-sided tubing', () => {
  const points: Vec3[] = [[-.225, 0, 0], [-.225, 0, -.16], [.225, 0, -.16], [.225, 0, 0]];
  const geometry = constructionTubeGeometry([points], .014), index = geometry.index!;
  const edges = new Map<string, number>();
  for (let i = 0; i < index.count; i += 3) for (let j = 0; j < 3; j++) {
    const a = index.getX(i + j), b = index.getX(i + (j + 1) % 3), key = [a, b].sort((a, b) => a - b).join(':');
    edges.set(key, (edges.get(key) ?? 0) + 1);
  }
  expect([...edges.values()].every(count => count === 2)).toBe(true);
  expect(index.count / 3).toBe(44); // Previously 120 triangles in three capped rods.
  geometry.computeBoundingBox();
  expect(geometry.boundingBox!.min.z).toBeCloseTo(-.174, 3);
  expect(geometry.boundingBox!.max.z).toBeCloseTo(0, 6);
  geometry.dispose();
});

test('ladder attachment rings seat flush on sloping walls', async () => {
  const { createConstructionPathModel } = await import('./constructionPathModel');
  const part = catalog.equipment.find(p => p.id === 'generic-surface-ladder')! as ConstructionEquipmentPart;
  const normal = new THREE.Vector3(0, .2, -1).normalize().toArray() as Vec3;
  const surfaces = [{ normal, open: false, vertices: [[-2,-2,-.4],[-2,2,.4],[2,2,.4],[2,-2,-.4]] }] as ConstructionSurface[];
  const item = { id: 'ladder', partId: part.id, position: [0,0,0] as Vec3, bearingDeg: 0, path: { points: [[0,0,0],[0,1,.2]] as Vec3[] } };
  const model = createConstructionPathModel(part, item.path, false, { item, surfaces });
  const position = (model.children[0] as THREE.Mesh).geometry.getAttribute('position');
  for (let rung = 0; rung < position.count; rung += 24) for (const ring of [0,18]) for (let side = 0; side < 6; side++) {
    const i = rung + ring + side;
    expect(position.getZ(i)).toBeCloseTo(position.getY(i) * .2, 6);
  }
  disposeConstructionModel(model);
});

test('custom fittings draw roofs that follow the installation or wear the ship paint as their own coats', () => {
  const quad = (soup: FittingMeshTriangle[], group: string | undefined, a: Vec3, b: Vec3, c: Vec3, d: Vec3) => soup.push({ a, b, c, group }, { a, b: c, c: d, group });
  // A 10 cm slab exported with its top wound downward, a deck-gray roof and a bare roof that follows the installation.
  const soup: FittingMeshTriangle[] = [];
  quad(soup, 'slab', [0, 3.1, 0], [2, 3.1, 0], [2, 3.1, 2], [0, 3.1, 2]);
  quad(soup, 'slab', [0, 3, 0], [2, 3, 0], [2, 3, 2], [0, 3, 2]);
  quad(soup, 'slab', [0, 3, 0], [0, 3.1, 0], [2, 3.1, 0], [2, 3, 0]);
  quad(soup, 'deck', [5, 3.1, 0], [5, 3.1, 2], [7, 3.1, 2], [7, 3.1, 0]);
  quad(soup, undefined, [10, 4, 0], [10, 4, 2], [12, 4, 2], [12, 4, 0]);
  const box = (id: string, x: number, paint?: string) => ({ id, kind: 'box' as const, size: [2, 1, 2] as Vec3, position: [x, .5, 0] as Vec3, rotationDeg: 0, ...(paint ? { paint } : {}) });
  const def: ConstructionFittingDefinition = { id: 'fit', name: 'Fit', version: 2, attach: 'deck', massKg: 100,
    solids: [box('house', 0), box('painted', 4, 'light-gray'), box('accent', 8, 'dark-gray')],
    tubes: [{ id: 'rail', points: [[0, 2, 0], [4, 2, 0]], diameterM: .2 }],
    meshes: [encodeFittingMesh('shell', soup, { slab: 'light-gray', deck: 'deck-gray' })] };
  const drawn = (roof?: FittingRoof) => {
    const model = createConstructionFittingModel(def, { roof });
    const meshes = Object.fromEntries(model.children.map(node => [node.name, node as THREE.Mesh]));
    return { model, meshes, triangles: Object.fromEntries(Object.entries(meshes).map(([name, mesh]) => [name, mesh.geometry.index!.count / 3])) };
  };
  const hex = (mesh: THREE.Mesh) => '#' + (mesh.material as THREE.MeshStandardMaterial).color.getHexString();
  const plain = drawn(), roofed = drawn({ shipPaint: 'light-gray', color: '#123456' });
  expect(fittingModelTriangles(roofed.model)).toBe(fittingModelTriangles(plain.model));
  // Bare roofs split out either way: the box top and the bare mesh roof; tubes have none.
  expect(plain.triangles['fit.roof']).toBe(4);
  const bare = plain.meshes['fit.roof'].material as THREE.MeshStandardMaterial;
  expect(bare.userData).toEqual(componentMaterial('roof').userData);
  expect(bare.color.equals(new THREE.Color().setRGB(...componentMaterial('roof').color as [number, number, number]))).toBe(true);
  // The ship-paint box top and the downward-wound slab top wear the roof colour; the slab's underside does not.
  expect(plain.triangles['fit.light-gray.roof']).toBeUndefined();
  expect(roofed.triangles['fit.light-gray.roof']).toBe(4);
  expect(roofed.triangles['fit.light-gray']).toBe(plain.triangles['fit.light-gray'] - 4);
  expect(hex(roofed.meshes['fit.light-gray.roof'])).toBe('#123456');
  expect(roofed.triangles['fit.deck-gray']).toBe(2);
  expect(roofed.triangles['fit.dark-gray']).toBe(12);
  expect(Object.keys(roofed.triangles).sort()).toEqual(['fit', 'fit.dark-gray', 'fit.deck-gray', 'fit.light-gray', 'fit.light-gray.roof', 'fit.roof']);
  paintConstructionFitting(roofed.model, 'sea-blue', false, undefined, undefined, '#654321');
  expect(hex(roofed.meshes['fit.roof'])).toBe('#654321');
  expect(hex(roofed.meshes.fit)).toBe('#405d70');
  disposeConstructionModel(plain.model); disposeConstructionModel(roofed.model);
});
