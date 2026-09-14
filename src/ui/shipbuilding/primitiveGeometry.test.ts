import { beforeAll, expect, test } from 'bun:test';
import * as THREE from 'three';
import init, { compile_construction } from '../../generated/naval-wasm/naval_wasm';
import catalogJson from '../../../public/models/components/catalog.json';
import type { ConstructionCatalog, ConstructionPrimitive, ConstructionResult } from '../../ships/blueprint';
import { createStarterSource } from '../../ships/constructionStarter';
import { primitiveGeometry } from './primitiveGeometry';

beforeAll(async () => { await init({ module_or_path: await Bun.file(new URL('../../generated/naval-wasm/naval_wasm_bg.wasm', import.meta.url)).arrayBuffer() }); });

function pointKey(values: readonly number[]) { return JSON.stringify(values.map(value => Math.round(value * 1e5) / 1e5)); }

test('draft and cursor shapes match the native exterior at every supported quarter turn', () => {
  const catalog = catalogJson as ConstructionCatalog;
  for (const kind of ['box', 'wedge', 'corner', 'inverse-corner'] as const) for (const rotationDeg of [0, 90, 180, 270]) {
    const source = createStarterSource(catalog, 'blank');
    const piece: ConstructionPrimitive = { id: 'shape', kind, size: [8, 6, 14], position: [7, -3, 11], rotationDeg };
    source.construction.primitives = [piece];
    const native = JSON.parse(compile_construction(JSON.stringify(source), JSON.stringify(catalog))) as ConstructionResult;
    expect(native.surfaces.length).toBeGreaterThan(0);
    const geometry = primitiveGeometry(kind, piece.size);
    try {
      geometry.rotateY(rotationDeg * Math.PI / 180).translate(...piece.position);
      const positions = geometry.getAttribute('position');
      const vertices = Array.from({ length: positions.count }, (_, i) => pointKey([positions.getX(i), positions.getY(i), positions.getZ(i)]));
      expect([...new Set(vertices)].sort()).toEqual([...new Set(native.surfaces.flatMap(surface => surface.vertices.map(pointKey)))].sort());
      // Every rendered triangle lies on a native exterior plane, rather than
      // merely sharing the same bounding box with the intended shape.
      for (let i = 0; i < positions.count; i += 3) {
        const triangle = [0, 1, 2].map(offset => new THREE.Vector3().fromBufferAttribute(positions, i + offset));
        expect(native.surfaces.some(surface => {
          const normal = new THREE.Vector3(...surface.normal), origin = new THREE.Vector3(...surface.vertices[0]);
          return triangle.every(vertex => Math.abs(normal.dot(vertex.clone().sub(origin))) < 1e-5);
        })).toBe(true);
      }
    } finally { geometry.dispose(); }
  }
});
