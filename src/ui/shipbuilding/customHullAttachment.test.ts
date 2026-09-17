import { beforeAll, expect, test } from 'bun:test';
import * as THREE from 'three';
import init, { compile_construction } from '../../generated/naval-wasm/naval_wasm';
import catalog from '../../../public/models/components/catalog.json';
import type { ConstructionCatalog, ConstructionResult, ConstructionSource, Vec3 } from '../../ships/blueprint';
import { createStarterSource } from '../../ships/constructionStarter';
import { HULL_PRESETS } from '../../ships/constructionHullPresets';
import { physicalPlacementHit, placementCenter } from './placement';

beforeAll(async () => { await init({ module_or_path: await Bun.file(new URL('../../generated/naval-wasm/naval_wasm_bg.wasm', import.meta.url)).arrayBuffer() }); });
const compile = (source: ConstructionSource): ConstructionResult => JSON.parse(compile_construction(JSON.stringify(source), JSON.stringify(catalog)));

test.each([...HULL_PRESETS])('$name supports blocks placed by raycasting its rendered deck', preset => {
  const source = createStarterSource(catalog as ConstructionCatalog, preset.id), native = compile(source);
  expect(native.definition).toBeDefined();
  const positions: number[] = [], triangles: typeof native.surfaces = [];
  for (const surface of native.surfaces) for (let i = 1; i + 1 < surface.vertices.length; i++) {
    positions.push(...surface.vertices[0], ...surface.vertices[i], ...surface.vertices[i + 1]); triangles.push(surface);
  }
  // Match the viewport's Float32 pick mesh; exact decimal test coordinates
  // miss the sub-micrometre gaps introduced by rendered vertices.
  const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  try {
    const mesh = new THREE.Mesh(geometry, material);
    const hit = new THREE.Raycaster(new THREE.Vector3(1, 30, 0), new THREE.Vector3(0, -1, 0)).intersectObject(mesh)[0];
    expect(hit).toBeDefined();
    const surface = triangles[hit.faceIndex!]; expect(surface.face).toBe('top');
    const support = physicalPlacementHit({ point: hit.point.toArray() as Vec3, normal: hit.face!.normal.toArray() as Vec3 }, surface);
    for (const shape of ['box', 'vertex'] as const) {
      const position = placementCenter({ kind: 'hull', shape, size: [1, 1, 1], rotationDeg: 0 }, support, 1);
      const placed = structuredClone(source); placed.construction.primitives.push({ id: 'added', kind: shape, size: [1, 1, 1], position, rotationDeg: 0 });
      const result = compile(placed);
      expect(result.definition, JSON.stringify(result.diagnostics)).toBeDefined();
      // The fix must not relax native attachment checks for actually floating blocks.
      placed.construction.primitives[1].position[1] += .001;
      expect(compile(placed).diagnostics.some(d => d.code === 'attachment')).toBe(true);
    }
  } finally { geometry.dispose(); material.dispose(); }
});
