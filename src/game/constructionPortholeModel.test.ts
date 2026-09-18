import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import catalog from '../../public/models/components/catalog.json';
import type { ConstructionEquipmentPart, ConstructionSurface, Vec3 } from '../ships/blueprint';
import { createConstructionWallModel } from './constructionWallModel';
import { disposeConstructionModel } from './constructionModel';

test('published rimmed porthole keeps its low-poly relief and attachment on sloped walls at every scale', async () => {
  const part = catalog.equipment.find(p => p.id === 'generic-rimmed-porthole')! as ConstructionEquipmentPart;
  const bytes = await Bun.file(new URL(`../../public${part.modelUrl}`, import.meta.url)).arrayBuffer();
  const { scene: template } = await new GLTFLoader().parseAsync(bytes, '');
  const normal = new THREE.Vector3(0, .2, -1).normalize().toArray() as Vec3;
  const surfaces = [{ normal, open: false, vertices: [[-4,-4,-.8],[-4,4,.8],[4,4,.8],[4,-4,-.8]] }] as ConstructionSurface[];
  for (const scale of [.25, 1, 2, 5]) {
    const item = { id: 'porthole', partId: part.id, position: [0,0,0] as Vec3, bearingDeg: 0,
      wall: { version: 1 as const, widthM: part.size[0] * scale, heightM: part.size[1] * scale } };
    const model = createConstructionWallModel(template, part, item, surfaces);
    let triangles = 0, minimumDepth = Infinity, maximumDepth = -Infinity;
    model.traverse(node => {
      if (!(node instanceof THREE.Mesh)) return;
      expect(node.userData.wallSurfaceDetail).toBe(true);
      const positions = node.geometry.getAttribute('position');
      triangles += (node.geometry.index?.count ?? positions.count) / 3;
      for (let i = 0; i < positions.count; i++) {
        const depth = positions.getY(i) * .2 - positions.getZ(i);
        minimumDepth = Math.min(minimumDepth, depth); maximumDepth = Math.max(maximumDepth, depth);
      }
    });
    expect(triangles).toBeGreaterThan(0);
    expect(triangles).toBeLessThanOrEqual(160);
    expect(minimumDepth).toBeCloseTo(.0005, 5);
    expect(maximumDepth).toBeCloseTo(.036 * scale + .0005, 5);
    disposeConstructionModel(model);
  }
  disposeConstructionModel(template);
});
