import { expect, test } from 'bun:test';
import { paintedHullFace } from './constructionHullPaint';
import { createStarterSource } from './constructionStarter';
import { customHullPrimitive, editableCustomHull } from './customHullModel';
import { applyConstructionBatch } from './constructionCommands';
import { copyConstructionSelection, decodeConstructionSource, moveConstructionSelection } from './constructionEditor';
import type { ConstructionCatalog, ConstructionSurface, Vec3 } from './blueprint';
const catalog = { revision: 'test' } as ConstructionCatalog;
const surface: ConstructionSurface = { id: 'hull:port', primitiveId: 'hull', face: 'port', panelId: 'panel', vertices: [[0, -2, -2], [0, 2, -2], [0, 2, 2], [0, -2, 2]], normal: [-1, 0, 0], areaM2: 16, paint: 'sea-blue', thicknessMm: 100, material: 'armor-steel', open: false };
test('red coating clips at an exact hull-local height, retaining face geometry and lighting', () => {
  const source = createStarterSource(catalog, 'fletcher-hull'), hull = source.construction.primitives[0];
  hull.position[1] = 1; hull.customHull!.redPaintY = -.5;
  const before = structuredClone(surface), normals: Vec3[] = [[-1,0,0],[-.8,.6,0],[-.8,.6,0],[-1,0,0]];
  const faces = paintedHullFace(surface, hull, normals);
  expect(faces).toHaveLength(2);
  expect(faces.find(f => f.paint === 'red-oxide')!.vertices.every(v => v[1] <= .5)).toBe(true);
  expect(faces.find(f => f.paint === 'sea-blue')!.vertices.every(v => v[1] >= .5)).toBe(true);
  expect(faces.every(f => f.normals.every(n => Math.abs(Math.hypot(...n) - 1) < 1e-10))).toBe(true);
  const cut = faces[0].vertices.findIndex(v => v[1] === .5);
  expect(faces[0].normals[cut][1]).toBeCloseTo(.375 / Math.hypot(.875, .375));
  const area = (v: Vec3[]) => Math.abs(v.reduce((sum, p, i) => sum + p[1] * v[(i+1)%v.length][2] - p[2] * v[(i+1)%v.length][1], 0)) / 2;
  expect(faces.reduce((sum, f) => sum + area(f.vertices), 0)).toBeCloseTo(16);
  expect(surface).toEqual(before);
  hull.customHull!.redPaintY = -500; expect(paintedHullFace(surface, hull)[0].paint).toBe('sea-blue');
  hull.customHull!.redPaintY = 500; expect(paintedHullFace(surface, hull)[0].paint).toBe('red-oxide');
  delete hull.customHull!.redPaintY; expect(paintedHullFace(surface, hull)[0].vertices).toEqual(surface.vertices);
});
test('paint height persists through editor commands, reload, placement and mirrored copies; legacy data remains optional', () => {
  const source = createStarterSource(catalog, 'fletcher-hull'), hull = source.construction.primitives[0];
  const draft = editableCustomHull(hull); draft.redPaintY = 1.25;
  const edited = applyConstructionBatch(source, { version: 1, expectedRevision: source.revision, label: 'Paint height', commands: [{ op: 'primitive', value: customHullPrimitive(draft, hull) }] });
  const loaded = decodeConstructionSource(JSON.parse(JSON.stringify(edited)));
  moveConstructionSelection(loaded, new Set(['hull']), [0, 4, 0]);
  const [id] = copyConstructionSelection(loaded, new Set(['hull']), { mirror: true });
  expect(editableCustomHull(loaded.construction.primitives.find(p => p.id === id)!).redPaintY).toBe(1.25);
  delete hull.customHull!.redPaintY; expect(decodeConstructionSource(source).construction.primitives[0].customHull!.redPaintY).toBeUndefined();
  for (const bad of [NaN, Infinity, 501]) { hull.customHull!.redPaintY = bad; expect(() => decodeConstructionSource(source)).toThrow(); }
});
