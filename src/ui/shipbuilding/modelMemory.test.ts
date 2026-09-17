import { expect, test } from 'bun:test';
import * as THREE from 'three';
import type { ConstructionSource, ShipDefinition } from '../../ships/blueprint';
import { jsonBytes, modelMB, SHARED_MODEL, simulationMemory, visualMemory } from './modelMemory';
const source = { id: 'design', revision: 'r1', construction: { primitives: [{ id: 'hull' }], equipment: [{ id: 'gun-a' }, { id: 'gun-b' }], boundaries: [] } } as unknown as ConstructionSource;

test('shared geometry and textures count once and split equally between identical fittings', () => {
  const geometry = new THREE.BoxGeometry(), texture = new THREE.DataTexture(new Uint8Array(4 * 4 * 4), 4, 4);
  texture.generateMipmaps = true;
  const material = new THREE.MeshBasicMaterial({ map: texture }), root = new THREE.Group();
  for (const id of ['gun-a', 'gun-b']) { const mesh = new THREE.Mesh(geometry, material); mesh.userData.sourceId = id; root.add(mesh); }
  const report = visualMemory([root, root], source, true);
  const geometryBytes = Object.values(geometry.attributes).reduce((n, a) => n + a.array.byteLength, geometry.index!.array.byteLength);
  expect(report.geometry).toBe(geometryBytes);
  expect(report.textures).toBe((16 + 4 + 1) * 4);
  expect(report.triangles).toBe(24);
  expect(report.meshes).toBe(2);
  expect(report.parts['gun-a'].geometry).toBe(geometryBytes / 2);
  expect(report.parts['gun-b'].textures).toBe(report.textures / 2);
  expect(report.missing).toEqual([]);
});

test('interleaved backing buffers are counted once and hull batches follow their source triangles', () => {
  const geometry = new THREE.BufferGeometry(), buffer = new THREE.InterleavedBuffer(new Float32Array(36), 6);
  geometry.setAttribute('position', new THREE.InterleavedBufferAttribute(buffer, 3, 0));
  geometry.setAttribute('normal', new THREE.InterleavedBufferAttribute(buffer, 3, 3));
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  mesh.userData.constructionSurfaces = [{ primitiveId: 'hull' }, { primitiveId: 'hull-2' }];
  const report = visualMemory([mesh], { ...source, construction: { ...source.construction, primitives: [{ id: 'hull' }, { id: 'hull-2' }] as ConstructionSource['construction']['primitives'] } }, true);
  expect(report.geometry).toBe(144);
  expect(report.parts.hull.geometry).toBe(72);
  expect(report.parts['hull-2'].triangles).toBe(1);
  expect(report.missing).toEqual(['gun-a', 'gun-b']);
});

test('simulation attribution preserves exact UTF-8 JSON size and keeps anonymous geometry shared', () => {
  const definition = { name: '巡洋艦', mounts: [{ id: 'gun-a', weapon: { name: '炮', power: 8 } }], modules: [{ id: 'gun-a-magazine', size: [1, 2, 3] }], hull: { cells: [{ faces: [[1, 2, 3]] }] } } as unknown as ShipDefinition;
  const report = simulationMemory(definition, ['gun', 'gun-a']);
  expect(report.json).toBe(jsonBytes(definition));
  expect(Object.values(report.parts).reduce((a, b) => a + b, 0)).toBe(report.json);
  expect(report.parts['gun-a']).toBe(jsonBytes(definition.mounts[0]) + jsonBytes(definition.modules![0]));
  expect(report.parts.gun).toBeUndefined();
  expect(report.parts[SHARED_MODEL]).toBeGreaterThan(0);
  expect(report.encoded).toBeGreaterThan(0);
});

test('small nonzero values remain visible and removed parts stop consuming totals', () => {
  expect(modelMB(32)).toBe('<0.001');
  expect(modelMB(1_000_000)).toBe('1.000');
  const report = visualMemory([], source, false);
  expect(report.geometry + report.textures).toBe(0);
  expect(report.hullReady).toBe(false);
  expect(report.missing).toHaveLength(2);
});


test('compiled fitting enclosures belong to the installed part', () => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  mesh.userData.constructionSurfaces = Array.from({ length: 12 }, () => ({ primitiveId: 'equipment:gun-a' }));
  const report = visualMemory([mesh], source, true);
  expect(report.parts['gun-a'].geometry).toBeCloseTo(report.geometry);
  expect(report.parts[SHARED_MODEL]).toBeUndefined();
});
