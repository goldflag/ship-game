import { beforeAll, expect, test } from 'bun:test';
import * as THREE from 'three/webgpu';
import init, { compile_construction, construction_custom_fitting_parts } from '../generated/naval-wasm/naval_wasm';
import published from '../../public/models/components/catalog.json';
import type {
  ConstructionCatalog,
  ConstructionEquipmentPart,
  ConstructionFittingDefinition,
  ConstructionResult,
  ConstructionSource,
  Vec3,
} from './blueprint';
import { customFittingBudgets, customFittingFault, resolveCustomFitting } from './constructionCustomFittings';
import { decodeConstructionSource } from './constructionEditor';
import {
  decodeFittingMesh,
  encodeFittingMesh,
  FITTING_MESH_LIMITS,
  fittingMeshBoxes,
  type FittingMeshTriangle,
} from './constructionFittingMesh';
import { createStarterSource } from './constructionStarter';
import { createConstructionFittingModel, fittingModelTriangles } from '../game/constructionFittingModel';
import { createConstructionModel, disposeConstructionModel } from '../game/constructionModel';

const catalog = published as unknown as ConstructionCatalog;
beforeAll(async () => {
  await init({ module_or_path: await Bun.file(new URL('../generated/naval-wasm/naval_wasm_bg.wasm', import.meta.url)).arrayBuffer() });
});

const quad = (soup: FittingMeshTriangle[], group: string, a: Vec3, b: Vec3, c: Vec3, d: Vec3) =>
  soup.push({ a, b, c, group }, { a, b: c, c: d, group });
/** An open U-shaped deckhouse shell, 6 m wide, 8 m long and 2.5 m high, with a 2 m notch open to the bow
 * (x −1…1, z −4…1): walls and roof in 1 m panels, no floor. The same shape as the native test's. */
function uDeckhouse(): FittingMeshTriangle[] {
  const outline = [
    [-3, -4],
    [-1, -4],
    [-1, 1],
    [1, 1],
    [1, -4],
    [3, -4],
    [3, 4],
    [-3, 4],
  ];
  const soup: FittingMeshTriangle[] = [];
  outline.forEach((a, i) => {
    const b = outline[(i + 1) % outline.length],
      n = Math.round(Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]));
    for (let s = 0; s < n; s++) {
      const at = (f: number) => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
      const p = at(s / n),
        q = at((s + 1) / n);
      quad(soup, 'walls', [p[0], 0, p[1]], [q[0], 0, q[1]], [q[0], 2.5, q[1]], [p[0], 2.5, p[1]]);
    }
  });
  for (const [x0, x1, z0, z1] of [
    [-3, -1, -4, 1],
    [1, 3, -4, 1],
    [-3, 3, 1, 4],
  ])
    for (let x = x0; x < x1; x++)
      for (let z = z0; z < z1; z++) quad(soup, 'roof', [x, 2.5, z], [x, 2.5, z + 1], [x + 1, 2.5, z + 1], [x + 1, 2.5, z]);
  return soup;
}
const deckhouse = (): ConstructionFittingDefinition => ({
  id: 'fit-deckhouse',
  name: 'U deckhouse',
  version: 2,
  attach: 'deck',
  solids: [],
  tubes: [],
  massKg: 12_000,
  meshes: [encodeFittingMesh('shell', uDeckhouse(), { roof: 'deck-gray' })],
});
/** A mesh with a solid mast and a tube rail beside it, and an explicit centre of gravity. */
const mixed = (): ConstructionFittingDefinition => ({
  id: 'fit-mixed',
  name: 'House with mast',
  version: 2,
  attach: 'deck',
  massKg: 9_000,
  centerOfGravity: [0, 1.1, 0.5],
  solids: [{ id: 'mast', kind: 'cylinder', size: [0.3, 6, 0.3], position: [0, 5.5, 3], rotationDeg: 0 }],
  tubes: [
    {
      id: 'rail',
      points: [
        [-3, 3.5, 4],
        [3, 3.5, 4],
      ],
      diameterM: 0.05,
    },
  ],
  meshes: [encodeFittingMesh('shell', uDeckhouse())],
});
/** `n` quads of a flat 0.1 m grid with shared vertices. */
function grid(id: string, n: number): FittingMeshTriangle[] {
  const soup: FittingMeshTriangle[] = [];
  for (let i = 0; i < n; i++) {
    const x = (i % 100) * 0.1,
      z = Math.floor(i / 100) * 0.1;
    quad(soup, id, [x, 0, z], [x + 0.1, 0, z], [x + 0.1, 0, z + 0.1], [x, 0, z + 0.1]);
  }
  return soup.map(({ group: _, ...t }) => t);
}
function source(definitions: ConstructionFittingDefinition[]): ConstructionSource {
  const s = createStarterSource(catalog, 'fletcher-hull');
  s.construction.fittings = structuredClone(definitions);
  return s;
}
const nativeParts = (s: ConstructionSource) =>
  JSON.parse(construction_custom_fitting_parts(JSON.stringify(s))) as {
    parts?: ConstructionEquipmentPart[];
    diagnostics?: { code: string; message: string; sourceId: string }[];
  };
const compile = (s: ConstructionSource): ConstructionResult => JSON.parse(compile_construction(JSON.stringify(s), JSON.stringify(catalog)));

test('a non-convex open shell round-trips through the codec, welded and grouped', () => {
  const soup = uDeckhouse(),
    mesh = encodeFittingMesh('shell', soup, { roof: 'deck-gray' });
  expect(mesh).toMatchObject({ encoding: 'deflate-q16-u16-v1', triangles: soup.length, bounds: { min: [-3, 0, -4], max: [3, 2.5, 4] } });
  // Shared corners weld: far fewer vertices than three per triangle.
  expect(mesh.vertices).toBeLessThan(soup.length);
  expect(mesh.groups).toEqual([
    { start: 0, count: 76, name: 'walls' },
    { start: 76, count: 76, name: 'roof', paint: 'deck-gray' },
  ]);
  const decoded = decodeFittingMesh(mesh);
  soup.forEach((t, i) =>
    [t.a, t.b, t.c].forEach((p, c) => {
      for (let k = 0; k < 3; k++) expect(Math.abs(decoded.points[3 * decoded.triangles[3 * i + c] + k] - p[k])).toBeLessThan(1e-4);
    }),
  );
  // Conservative boxes that leave the notch between the arms empty.
  const boxes = fittingMeshBoxes(decoded),
    inside = (p: Vec3) => boxes.some((b) => [0, 1, 2].every((k) => Math.abs(p[k] - b.center[k]) <= b.size[k] / 2));
  expect(boxes.length).toBeGreaterThan(1);
  expect(boxes.length).toBeLessThanOrEqual(8);
  for (let v = 0; v < mesh.vertices; v++)
    expect(inside([decoded.points[3 * v], decoded.points[3 * v + 1], decoded.points[3 * v + 2]])).toBe(true);
  expect(inside([0, 1.2, -2.5])).toBe(false);
  // Triangles that collapse when quantized are dropped; too many vertices or triangles are refused with the counts.
  expect(encodeFittingMesh('flat', [...soup, { a: [0, 0, 0], b: [0, 0, 1e-9], c: [1, 0, 0] }]).triangles).toBe(soup.length);
  expect(() => encodeFittingMesh('big', grid('big', 10_001))).toThrow('has 20002 triangles; a mesh holds 1–20000');
});

test('the TypeScript resolver matches the native one for mesh fittings', () => {
  const definitions = [deckhouse(), mixed()],
    native = nativeParts(source(definitions));
  expect(native.diagnostics).toBeUndefined();
  for (const [i, def] of definitions.entries()) {
    const mine = resolveCustomFitting(def),
      theirs = native.parts![i];
    const shape = { size: 0, boundsCenter: 0, centerOfGravity: 0, fitting: 0, contentHash: 0 };
    expect({ ...mine, ...shape }).toEqual({ ...theirs, ...shape } as never);
    for (const key of ['size', 'boundsCenter', 'centerOfGravity'] as const)
      for (let k = 0; k < 3; k++) expect(mine[key][k]).toBeCloseTo(theirs[key][k], 9);
    expect(mine.massKg).toBe(theirs.massKg!);
    expect(mine.fitting!.length).toBe(theirs.fitting!.length);
    mine.fitting!.forEach((box, n) => {
      for (let k = 0; k < 3; k++) {
        expect(box.center[k]).toBeCloseTo(theirs.fitting![n].center[k], 9);
        expect(box.size[k]).toBeCloseTo(theirs.fitting![n].size[k], 9);
      }
    });
  }
  // The area centroid of a shell symmetric about x = 0, below its roof; the explicit one wins.
  const house = resolveCustomFitting(deckhouse());
  expect(house.centerOfGravity[0]).toBeCloseTo(0, 9);
  expect(house.centerOfGravity[1]).toBeGreaterThan(1);
  expect(house.centerOfGravity[1]).toBeLessThan(2.5);
  expect(resolveCustomFitting(mixed()).centerOfGravity).toEqual([0, 1.1, 0.5]);
});

test('both resolvers refuse the same broken meshes and name the mesh', () => {
  const house = deckhouse(),
    shell = house.meshes![0];
  const faults: [string, ConstructionFittingDefinition][] = [
    ['need version 2', { ...house, version: 1 }],
    ['give it a massKg', { ...house, massKg: undefined }],
    ['mesh shell uses the encoding', { ...house, meshes: [{ ...shell, encoding: 'deflate-f32-u32-v1' as never }] }],
    ['mesh shell has data that does not decode', { ...house, meshes: [{ ...shell, triangles: shell.triangles - 1, groups: undefined }] }],
    ['mesh shell has data that does not decode', { ...house, meshes: [{ ...shell, data: 'AAAA' + shell.data }] }],
    ['mesh shell needs finite bounds', { ...house, meshes: [{ ...shell, bounds: { min: [-3, 0, -4], max: [3, 200, 4] } }] }],
    [
      'non-overlapping',
      {
        ...house,
        meshes: [
          {
            ...shell,
            groups: [
              { start: 0, count: 10 },
              { start: 5, count: 10 },
            ],
          },
        ],
      },
    ],
    ['above its datum', { ...house, meshes: [{ ...shell, bounds: { min: [-3, 1, -4], max: [3, 3.5, 4] } }] }],
    ['repeats the solid, tube or mesh ID shell', { ...house, meshes: [shell, shell] }],
    ["centerOfGravity outside its shapes' bounds", { ...house, centerOfGravity: [0, 9, 0] }],
  ];
  for (const [text, def] of faults) {
    expect(customFittingFault(def)).toContain(text);
    const native = nativeParts(source([def]));
    expect(native.diagnostics?.[0]).toMatchObject({ code: 'custom-fitting', sourceId: 'fit-deckhouse' });
    expect(native.diagnostics![0].message).toContain(text);
  }
  // The source decoder accepts version 2 meshes and refuses them on version 1.
  expect(decodeConstructionSource(source([house])).construction.fittings![0].meshes).toHaveLength(1);
  expect(() => decodeConstructionSource(source([{ ...house, version: 1 }]))).toThrow('need version 2');
});

test('a mesh fitting compiles as mass only and draws each definition once', async () => {
  const s = source([deckhouse()]);
  s.construction.equipment = [
    { id: 'house-fwd', partId: 'design:fit-deckhouse', position: [0, 5, -40], bearingDeg: 0 },
    { id: 'house-aft', partId: 'design:fit-deckhouse', position: [0, 5, 30], bearingDeg: 180, scale: [0.6, 1.2, 0.6] },
  ];
  const bare = compile(source([deckhouse()])),
    result = compile(s);
  expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  expect(result.loading!.massKg - bare.loading!.massKg).toBeCloseTo(12_000 * (1 + 0.6 * 1.2 * 0.6), 3);
  // Shells ignore it: the compiled hull surfaces are unchanged.
  expect(JSON.stringify(result.surfaces)).toBe(JSON.stringify(bare.surfaces));
  const drawing = createConstructionFittingModel(deckhouse());
  expect(fittingModelTriangles(drawing)).toBe(152);
  // Roof and walls keep separate coatings; the 90° roof edge stays a crease.
  const roof = drawing.children.find((node) => node.name === 'fit-deckhouse.deck-gray') as THREE.Mesh;
  const normals = roof.geometry.getAttribute('normal');
  for (let i = 0; i < normals.count; i++) expect(Math.abs(normals.getY(i))).toBeCloseTo(1, 6);
  // The model reads the design's catalog revision; serve the published one.
  const fetched = globalThis.fetch;
  globalThis.fetch = (async () => Response.json(catalog)) as unknown as typeof fetch;
  const model = await createConstructionModel(s, result).finally(() => (globalThis.fetch = fetched));
  const fwd = model.getObjectByName('house-fwd')!,
    aft = model.getObjectByName('house-aft')!;
  const meshes = (node: THREE.Object3D) => node.children.filter((child): child is THREE.Mesh => child instanceof THREE.Mesh);
  expect(meshes(fwd).map((mesh) => mesh.geometry)).toEqual(meshes(aft).map((mesh) => mesh.geometry));
  expect(fittingModelTriangles(fwd)).toBe(152);
  expect(aft.scale.toArray()).toEqual([0.6, 1.2, 0.6]);
  aft.updateMatrixWorld(true);
  expect(meshes(aft)[0].matrixWorld.determinant()).toBeGreaterThan(0);
  disposeConstructionModel(model);
});

test('design budgets count unique mesh triangles once and drawn triangles per instance', () => {
  const sheet = (id: string): ConstructionFittingDefinition => ({
    id,
    name: id,
    version: 2,
    attach: 'deck',
    solids: [],
    tubes: [],
    massKg: 500,
    meshes: [encodeFittingMesh('m', grid('m', 9_000))],
  });
  const six = Array.from({ length: 6 }, (_, i) => sheet(`fit-${i}`)),
    s = source(six);
  expect(customFittingBudgets(s.construction)).toMatchObject({ meshTriangles: 108_000, renderedTriangles: 0 });
  const fault = compile(s).diagnostics.find((d) => d.code === 'custom-fitting')!;
  expect(fault).toMatchObject({ sourceId: 'fit-5' });
  expect(fault.message).toContain(
    `108000 visual mesh triangles (18000 of them its own); a design holds at most ${FITTING_MESH_LIMITS.designMeshTriangles}`,
  );
  const one = source([sheet('fit-sheet')]);
  one.construction.equipment = Array.from({ length: 56 }, (_, i) => ({
    id: `s${i}`,
    partId: 'design:fit-sheet',
    position: [0, 5, -50 + 2 * i] as Vec3,
    bearingDeg: 0,
  }));
  expect(customFittingBudgets(one.construction).renderedTriangles).toBe(1_008_000);
  const drawn = compile(one).diagnostics.find((d) => d.code === 'custom-fitting')!;
  expect(drawn).toMatchObject({ sourceId: 'fit-sheet' });
  expect(drawn.message).toContain('56 instances × 18000 triangles');
});
