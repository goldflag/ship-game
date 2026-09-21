import { beforeAll, expect, test } from 'bun:test';
import { decodeConstructionResult } from './constructionTransport';
import init, { ConstructionCompiler } from '../generated/naval-wasm/naval_wasm';
import catalogJson from '../../public/models/components/catalog.json';
import { createStarterSource } from './constructionStarter';
import type { ConstructionCatalog, ConstructionResult } from './blueprint';

beforeAll(async () => {
  await init({ module_or_path: await Bun.file(new URL('../generated/naval-wasm/naval_wasm_bg.wasm', import.meta.url)).arrayBuffer() });
});

const fixture = () => ({
  format: 'naval-construction-result',
  version: 1,
  vertices: [
    [-0, 1 / 3, 1e-15],
    [1, 2, 3],
  ],
  hullSurfaceIndices: [0],
  loadingFromDefinition: true,
  result: {
    sourceId: 'ship',
    revision: 'revision',
    contentHash: 'hash',
    diagnostics: [],
    surfaces: [{ id: 'skin', vertices: [0, 1, 0], open: false }],
    definition: {
      hull: { volume: { cells: [{ faces: [{ vertices: [1, 0, 1] }] }] } },
      compartments: [{ volumes: [{ faces: [{ vertices: [0, 1, 0] }] }] }],
      construction: { primitives: [{ vertices: [0, 1] }] },
      loading: { massKg: 5, contributions: [{ massKg: 5 }] },
    },
  },
});

test('compact geometry restores all vertex fields, shared surfaces and loading exactly', () => {
  const packed = fixture();
  // JSON.stringify normalizes -0 just as it does for ordinary result JSON.
  const decoded = decodeConstructionResult(JSON.stringify(packed)) as any;
  const points = JSON.parse(JSON.stringify(packed.vertices));
  expect(decoded.surfaces[0].vertices).toEqual([points[0], points[1], points[0]]);
  expect(decoded.definition.hull.volume.cells[0].faces[0].vertices).toEqual([points[1], points[0], points[1]]);
  expect(decoded.definition.compartments[0].volumes[0].faces[0].vertices).toEqual([points[0], points[1], points[0]]);
  expect(decoded.definition.construction.primitives[0].vertices).toEqual(points);
  expect(decoded.definition.hull.volume.surfaces).toEqual(decoded.surfaces);
  expect(decoded.loading).toEqual(decoded.definition.loading);
  // Decoding must not introduce shared mutable arrays where JSON.parse made independent ones.
  decoded.surfaces[0].vertices[0][0] = 99;
  decoded.loading.contributions[0].massKg = 99;
  expect(decoded.surfaces[0].vertices[2][0]).toBe(0);
  expect(decoded.definition.hull.volume.surfaces[0].vertices[0][0]).toBe(0);
  expect(decoded.definition.loading.contributions[0].massKg).toBe(5);
});

test('error results and legacy full results keep their diagnostics without requiring a definition', () => {
  const result: ConstructionResult = {
    sourceId: 'ship',
    revision: 'bad',
    contentHash: 'hash',
    surfaces: [],
    diagnostics: [{ code: 'hull', severity: 'error', message: 'Invalid hull' }],
  };
  expect(decodeConstructionResult(JSON.stringify({ format: 'naval-construction-result', version: 1, vertices: [], result }))).toEqual(
    result,
  );
  expect(decodeConstructionResult(JSON.stringify(result))).toEqual(result);
});

test('signed zero and nearby floating point coordinates survive decoding without rounding', () => {
  const text = JSON.stringify(fixture()).replace('"vertices":[[0,', '"vertices":[[-0,');
  const point = decodeConstructionResult(text).surfaces[0].vertices[0];
  expect(Object.is(point[0], -0)).toBe(true);
  expect(point[1]).toBe(1 / 3);
  expect(point[2]).toBe(1e-15);
});

test('malformed versions, indices, coordinates and missing shared data are rejected', () => {
  const broken = [
    (x: any) => {
      x.version = 2;
    },
    (x: any) => {
      x.vertices[0] = [0, null, 1];
    },
    (x: any) => {
      x.result.surfaces[0].vertices[0] = -1;
    },
    (x: any) => {
      x.result.surfaces[0].vertices[0] = 0.5;
    },
    (x: any) => {
      x.result.surfaces[0].vertices[0] = 99;
    },
    (x: any) => {
      x.hullSurfaceIndices[0] = 99;
    },
    (x: any) => {
      delete x.result.definition.loading;
    },
    (x: any) => {
      delete x.result.definition;
    },
    (x: any) => {
      x.result.surfaces = null;
    },
  ];
  for (const breakIt of broken) {
    const packed = fixture();
    breakIt(packed);
    expect(() => decodeConstructionResult(JSON.stringify(packed))).toThrow();
  }
});

test('native compact output decodes exactly like full JSON through edits and failed compilation', () => {
  const catalog = catalogJson as ConstructionCatalog;
  const source = createStarterSource(catalog, 'blank');
  const compactCompiler = new ConstructionCompiler(),
    fullCompiler = new ConstructionCompiler();
  const cases = [structuredClone(source)];
  source.revision = 'armor-edit';
  source.construction.defaultThicknessMm += 0.1;
  cases.push(structuredClone(source));
  source.revision = 'hull-edit';
  source.construction.primitives[0].size[2] += 0.01;
  cases.push(structuredClone(source));
  source.revision = 'invalid';
  source.construction.defaultThicknessMm = -1;
  cases.push(structuredClone(source));
  try {
    for (const input of cases) {
      const json = JSON.stringify(input),
        parts = JSON.stringify(catalog);
      const full = fullCompiler.compile(json, parts),
        compact = compactCompiler.compile_compact(json, parts);
      const decoded = decodeConstructionResult(compact);
      expect(decoded).toEqual(JSON.parse(full));
      if (input.revision !== 'invalid') {
        expect(decoded.definition).toBeDefined();
        expect(compact.length).toBeLessThan(full.length * 0.8);
      } else expect(decoded.diagnostics.some((d) => d.severity === 'error')).toBe(true);
    }
  } finally {
    compactCompiler.free();
    fullCompiler.free();
  }
});
