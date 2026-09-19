import { expect, test } from 'bun:test';
import { hullPaintBands, editHullPaintBands, hullPaintBandsError } from './hullPaintBands';
import { paintedHullFace } from './constructionHullPaint';
import { createStarterSource } from './constructionStarter';
import { editableCustomHull, customHullPrimitive, lockSymmetry } from './customHullModel';
import { applyConstructionBatch } from './constructionCommands';
import { copyConstructionSelection, decodeConstructionSource } from './constructionEditor';
import { primitivePoint, unorientVector } from './constructionOrientation';
import type { ConstructionCatalog, ConstructionHullPaintBands, ConstructionSurface, Vec3 } from './blueprint';

const catalog = { revision: 'test' } as ConstructionCatalog;
const bands = (): ConstructionHullPaintBands => ({ version: 1, bands: [
  { id: 'underwater', upperY: -.5, paint: 'red-oxide' },
  { id: 'waterline', upperY: .25, paint: 'boot-top-black' },
  { id: 'stripe', upperY: .7, paint: 'light-gray' },
] });

test('legacy paint upgrades only on edit, and removing all bands keeps the coating disabled', () => {
  const hull = { redPaintY: -.3, paintBands: undefined as ConstructionHullPaintBands | undefined };
  expect(hullPaintBands(hull)).toEqual([{ id: 'lower-hull', upperY: -.3, paint: 'red-oxide' }]);
  expect(hull.paintBands).toBeUndefined();
  editHullPaintBands(hull)[0].paint = 'sea-blue';
  expect(hull.redPaintY).toBeUndefined();
  expect(hull.paintBands?.bands[0].paint).toBe('sea-blue');
  hull.paintBands!.bands = []; hull.redPaintY = 5;
  expect(hullPaintBands(hull)).toEqual([]);
});

test('bands split sloping faces at every local height after pitch, roll and placement', () => {
  const source = createStarterSource(catalog, 'fletcher-hull'), hull = source.construction.primitives[0];
  hull.customHull!.paintBands = bands();
  hull.position = [5, 12, -8]; hull.rotationDeg = 63; hull.tilt = { version: 1, pitchDeg: 17, rollDeg: -12 };
  const local: Vec3[] = [[0, -2, -2], [0, 2, -2], [0, 2, 2], [0, -2, 2]];
  const surface: ConstructionSurface = { id: 'hull:bow', primitiveId: hull.id, face: 'bow', vertices: local.map(v => primitivePoint(hull, v)), normal: [1, 0, 0], areaM2: 16, paint: 'sea-blue', thicknessMm: 20, material: 'steel', open: false };
  const before = structuredClone(surface);
  const faces = paintedHullFace(surface, hull);
  expect(faces.map(f => f.paint)).toEqual(['sea-blue', 'light-gray', 'boot-top-black', 'red-oxide']);
  const ranges: Record<string, [number, number]> = { 'red-oxide': [-2, -.5], 'boot-top-black': [-.5, .25], 'light-gray': [.25, .7], 'sea-blue': [.7, 2] };
  let area = 0;
  for (const face of faces) {
    const vertices = face.vertices.map(v => unorientVector(hull, v.map((n, k) => n - hull.position[k]) as Vec3));
    const ys = vertices.map(v => v[1]);
    expect(Math.min(...ys)).toBeCloseTo(ranges[face.paint][0]);
    expect(Math.max(...ys)).toBeCloseTo(ranges[face.paint][1]);
    area += Math.abs(vertices.reduce((sum, p, i) => sum + p[1] * vertices[(i + 1) % vertices.length][2] - p[2] * vertices[(i + 1) % vertices.length][1], 0)) / 2;
  }
  expect(area).toBeCloseTo(16);
  expect(surface).toEqual(before);
});

test('paint bands survive source commands, hull editing, save/reopen and mirrored copies', () => {
  const source = createStarterSource(catalog, 'fletcher-hull');
  const edited = applyConstructionBatch(source, { version: 1, expectedRevision: source.revision, label: 'Paint bands', commands: [{ op: 'primitive-patch', id: 'hull', changes: { customHull: { paintBands: bands(), redPaintY: null } } }] });
  const loaded = decodeConstructionSource(JSON.parse(JSON.stringify(edited)));
  const hull = loaded.construction.primitives[0];
  expect(customHullPrimitive(lockSymmetry(editableCustomHull(hull)), hull)).toEqual(hull);
  const [id] = copyConstructionSelection(loaded, new Set(['hull']), { mirror: true });
  const copy = loaded.construction.primitives.find(p => p.id === id)!;
  expect(copy.customHull!.paintBands).toEqual(bands());
  copy.customHull!.paintBands!.bands[0].paint = 'sea-blue';
  expect(hull.customHull!.paintBands).toEqual(bands());
});

test('invalid band versions, ordering, identities, heights and sizes are rejected on import', () => {
  for (const invalid of [null, { version: 2, bands: [] }, { version: 1, bands: null },
    { version: 1, bands: Array.from({ length: 9 }, (_, i) => ({ id: String(i), upperY: i, paint: 'red-oxide' })) },
    ...[NaN, Infinity, 501].map(upperY => ({ version: 1, bands: [{ id: 'a', upperY, paint: 'red-oxide' }] })),
    ...[{ id: 'underwater' }, { upperY: -.5 }, { upperY: -1 }, { paint: '' }].map(patch => { const value = bands(); Object.assign(value.bands[1], patch); return value; }),
  ]) {
    expect(hullPaintBandsError(invalid)).toBeDefined();
    const source = createStarterSource(catalog, 'fletcher-hull');
    source.construction.primitives[0].customHull!.paintBands = invalid as ConstructionHullPaintBands;
    expect(() => decodeConstructionSource(source)).toThrow();
  }
});
