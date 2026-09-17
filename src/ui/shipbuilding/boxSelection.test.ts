import { expect, test } from 'bun:test';
import * as THREE from 'three';
import catalogJson from '../../../public/models/components/catalog.json';
import type { ConstructionCatalog } from '../../ships/blueprint';
import { createStarterSource } from '../../ships/constructionStarter';
import { boxSelectedPieces } from './boxSelection';

const catalog = catalogJson as ConstructionCatalog;
const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, .1, 100);
camera.position.set(0, 0, 50); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true);

test('box selection encloses rotated blocks without selecting larger overlapping pieces', () => {
  const source = createStarterSource(catalog, 'blank');
  source.construction.primitives = [
    { id: 'turned', kind: 'box', size: [2, 2, 8], position: [0, 0, 0], rotationDeg: 90 },
    { id: 'far', kind: 'box', size: [2, 2, 2], position: [15, 0, 0], rotationDeg: 0 },
    { id: 'behind-camera', kind: 'box', size: [2, 2, 2], position: [0, 0, 60], rotationDeg: 0 },
  ];
  expect(boxSelectedPieces(source, catalog, camera, { left: 64, right: 67, top: 49, bottom: 51 }, 100, 100)).toEqual([]);
  expect(boxSelectedPieces(source, catalog, camera, { left: 29, right: 71, top: 44, bottom: 56 }, 100, 100)).toEqual(['turned']);
  expect(boxSelectedPieces(source, catalog, camera, { left: 0, right: 100, top: 0, bottom: 100 }, 100, 100)).toEqual(['turned']);
});

test('box selection respects slice height and hidden internal equipment', () => {
  const source = createStarterSource(catalog);
  const rect = { left: -100, right: 200, top: -100, bottom: 200 };
  const selected = boxSelectedPieces(source, catalog, camera, rect, 100, 100);
  expect(selected).toContain('hull'); expect(selected).toContain('funnel'); expect(selected).not.toContain('engine');
  const internal = boxSelectedPieces(source, catalog, camera, rect, 100, 100, undefined, true);
  expect(internal).toContain('engine'); expect(internal).not.toContain('hull'); expect(internal).not.toContain('funnel');
  const sliced = boxSelectedPieces(source, catalog, camera, rect, 100, 100, 0, true);
  expect(sliced).not.toContain('funnel'); expect(sliced).not.toContain('hull'); expect(sliced).toContain('engine');
  expect(boxSelectedPieces(source, catalog, camera, rect, 100, 100, -20, true)).toEqual([]);
});
