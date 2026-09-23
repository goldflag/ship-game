import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { ConstructionResult, ConstructionSource, Vec3 } from '../../src/ships/blueprint';
import { createStarterSource } from '../../src/ships/constructionStarter';
import { parseConstructionCatalog } from '../../src/ships/constructionEquipment';
import { CORNER_SIGNS, VERTEX_FACES } from '../../src/ships/constructionVertex';
import { blenderEdits, blenderScene, hexahedronCorners, type DumpObject, type SceneDump } from './blenderScene';
import { toBlender } from './blenderFrame';

// Pure halves of the Blender front end, with dumps written by hand instead of by Blender.
const root = resolve(import.meta.dir, '../..');
const catalog = parseConstructionCatalog(JSON.parse(await readFile(join(root, 'public/models/components/catalog.json'), 'utf8')));
const cube = CORNER_SIGNS.map((s) => s.map((n) => n / 2) as Vec3);
const quads = VERTEX_FACES.map((face) => [...face.corners]);

function source(): ConstructionSource {
  const s = createStarterSource(catalog, 'destroyer-hull');
  s.id = 'scene-test';
  s.construction.primitives.push(
    { id: 'house', kind: 'box', size: [4, 2, 8], position: [0, 5, 0], rotationDeg: 0, tilt: { version: 1, pitchDeg: 5, rollDeg: 0 } },
    { id: 'mast-step', kind: 'box', size: [1, 1, 1], position: [0, 6.5, 0], rotationDeg: 0 },
  );
  s.construction.surfaces.push({ primitiveId: 'house', face: 'port', thicknessMm: 25, material: 'armor-steel', paint: 'dark-gray' });
  return s;
}
const noResult = { surfaces: [], diagnostics: [] } as unknown as ConstructionResult;
/** A dump object as export_scene.py writes it, at a Blender location with a Z rotation. */
function object(name: string, props: Record<string, unknown>, at: Vec3, yawDeg = 0, mesh?: DumpObject['mesh'], hashes = { shapeHash: 'new', meshHash: 'new' }): DumpObject {
  const a = (yawDeg * Math.PI) / 180;
  return {
    name,
    type: mesh ? 'MESH' : 'EMPTY',
    collections: ['Blocks'],
    props,
    matrix: [[Math.cos(a), -Math.sin(a), 0, at[0]], [Math.sin(a), Math.cos(a), 0, at[1]], [0, 0, 1, at[2]], [0, 0, 0, 1]],
    ...hashes,
    ...(mesh ? { mesh } : {}),
  };
}
const dump = (objects: DumpObject[], s: ConstructionSource, imported: string[]): SceneDump => ({
  version: 1,
  file: 'test.blend',
  scene: { constructionShip: s.id, constructionRevision: s.revision, constructionImported: JSON.stringify(imported) },
  objects,
});
const block = (id: string, extra: Record<string, unknown> = {}) => ({ constructionId: id, constructionRole: 'block', importName: id, shapeHash: 'was', meshHash: 'mesh', ...extra });

test('a hexahedron is recognised as quads or triangles and ordered by octant; anything else is not', () => {
  const skewed = cube.map((v, i) => (i === 6 ? ([0.7, 0.6, 0.5] as Vec3) : v));
  expect(hexahedronCorners(skewed, quads)).toEqual(skewed);
  const shuffled = [3, 7, 0, 5, 1, 6, 2, 4];
  const vertices = shuffled.map((i) => cube[i]);
  const triangles = quads.flatMap(([a, b, c, d]) => [[a, b, c], [a, c, d]].map((t) => t.map((i) => shuffled.indexOf(i))));
  expect(hexahedronCorners(vertices, triangles)).toEqual(cube);
  // A box with one face split into a pyramid is not a hexahedron.
  expect(hexahedronCorners([...cube, [0, 0, -0.8]], quads)).toBeUndefined();
  expect(hexahedronCorners(cube, quads.slice(1))).toBeUndefined();
});

test('the scene carries Blender axes, yaw, tilt baked into the mesh, and every exported ID', () => {
  const s = source();
  s.construction.equipment.push({ id: 'gun', partId: 'us-5in38-mk30-mod0-single', position: [0, 4.55, -25], bearingDeg: 90 });
  s.construction.loads.push({ id: 'stores', name: 'Stores', center: [0, 2, 12], size: [2, 1, 3], massKg: 8000 });
  const scene = blenderScene({ source: s, hash: 'h' }, noResult, catalog);
  const house = scene.objects.find((o) => o.id === 'house')!;
  expect(house.location).toEqual(toBlender([0, 5, 0]).map((n) => n + 0) as Vec3);
  // Pitch is in the mesh: the bow end of the roof sits higher than the stern end.
  const roof = house.mesh!.vertices.filter((v) => v[2] > 0.5);
  expect(Math.max(...roof.filter((v) => v[0] > 0).map((v) => v[2]))).toBeGreaterThan(Math.max(...roof.filter((v) => v[0] < 0).map((v) => v[2])));
  const gun = scene.objects.find((o) => o.id === 'gun')!;
  expect([gun.role, gun.yawDeg, gun.seat]).toEqual(['equipment', 270, true]);
  expect(scene.objects.find((o) => o.id === 'hull')!.role).toBe('reference');
  expect(scene.imported.sort()).toEqual(['gun', 'house', 'mast-step', 'stores']);
});

test('export: moves keep the record, copies get new IDs, deletions remove, unknown materials and roles are refused', () => {
  const s = source();
  const moved = object('house', block('house'), [-2, 0, 5], 90, { vertices: cube, faces: quads, faceMaterials: [], materials: [] }, { shapeHash: 'moved', meshHash: 'mesh' });
  const copy = object('house.001', block('house'), [4, 0, 5], 0, { vertices: cube, faces: quads, faceMaterials: [], materials: [] }, { shapeHash: 'copy', meshHash: 'mesh' });
  const painted = object('Plate', {}, [10, 0, 5], 0, { vertices: cube, faces: quads, faceMaterials: [0, 0, 0, 0, 0, 0], materials: ['Material.001'] });
  const stray = { ...object('Camera helper', {}, [0, 0, 0]), collections: ['Scene Collection'] };
  const edits = blenderEdits(s, dump([moved, copy, painted, stray], s, ['house', 'mast-step']), catalog);
  expect(edits.report.failures).toEqual([
    { object: 'Plate', id: 'plate', error: expect.stringContaining('material "Material.001" is not a construction paint ID') },
  ]);
  expect(edits.report.ignored).toEqual([{ object: 'Camera helper', reason: expect.stringContaining('no constructionRole') }]);
  expect(edits.report.moved).toEqual(['house']);
  expect(edits.report.reassigned).toEqual([{ object: 'house.001', from: 'house', to: 'house-copy' }]);
  expect(edits.report.removed).toEqual(['mast-step']);
  const house = edits.after.construction.primitives.find((p) => p.id === 'house')!;
  expect(house.position).toEqual([0, 5, 2]);
  expect(house.rotationDeg).toBe(90);
  expect(house.tilt).toEqual({ version: 1, pitchDeg: 5, rollDeg: 0 });
  const twin = edits.after.construction.primitives.find((p) => p.id === 'house-copy')!;
  expect([twin.kind, twin.position]).toEqual(['box', [0, 5, -4]]);
  expect(edits.after.construction.surfaces.filter((x) => x.primitiveId === 'house-copy')).toEqual([
    { primitiveId: 'house-copy', face: 'port', thicknessMm: 25, material: 'armor-steel', paint: 'dark-gray' },
  ]);
  expect(edits.after.construction.primitives.some((p) => p.id === 'mast-step')).toBe(false);

  // Mapped, the same material is a paint; the plate becomes an eight-corner block in dark gray.
  const mapped = blenderEdits(s, dump([painted], s, []), catalog, { materials: { 'Material.001': 'dark-gray' } });
  expect(mapped.report.failures).toEqual([]);
  expect(mapped.report.reshaped).toEqual([{ id: 'plate', as: 'eight-corner block' }]);
  const plate = mapped.after.construction.primitives.find((p) => p.id === 'plate')!;
  expect([plate.kind, plate.size, plate.position]).toEqual(['vertex', [1, 1, 1], [0, 5, -10]]);
  expect(mapped.after.construction.surfaces.filter((x) => x.primitiveId === 'plate').map((x) => x.paint)).toEqual(Array(7).fill('dark-gray'));
});

test('export: equipment empties take position and bearing, and ask to be seated unless they may float', () => {
  const s = source();
  s.construction.equipment.push({ id: 'gun', partId: 'us-5in38-mk30-mod0-single', position: [0, 4.55, -25], bearingDeg: 0 });
  const empty = { ...object('gun', { constructionId: 'gun', constructionRole: 'equipment', partId: 'us-5in38-mk30-mod0-single', seat: true, shapeHash: 'was' }, [30, 0, 4.55], -45), collections: ['Equipment'] };
  const fresh = { ...object('generic-twin-bitts.001', { constructionRole: 'equipment' }, [20, -3, 4.05], 0), collections: ['Equipment'] };
  const edits = blenderEdits(s, dump([empty, fresh], s, ['gun']), catalog);
  expect(edits.report.failures).toEqual([]);
  const gun = edits.after.construction.equipment.find((e) => e.id === 'gun')!;
  expect([gun.position, gun.bearingDeg]).toEqual([[0, 4.55, -30], 45]);
  expect(edits.seat.map((item) => item.equipment.id)).toEqual(['gun']);
  const bitts = edits.after.construction.equipment.find((e) => e.partId === 'generic-twin-bitts')!;
  expect([bitts.id, bitts.position]).toEqual(['generic-twin-bitts', [3, 4.05, -20]]);
});

test('export: a record deleted from the source after the import stays deleted unless its object changed', () => {
  const s = source();
  s.construction.primitives = s.construction.primitives.filter((p) => p.id !== 'mast-step');
  const mesh = { vertices: cube, faces: quads, faceMaterials: [], materials: [] };
  const untouched = object('mast-step', block('mast-step'), [0, 0, 6.5], 0, mesh, { shapeHash: 'was', meshHash: 'mesh' });
  const kept = blenderEdits(s, dump([untouched], s, ['house', 'mast-step']), catalog);
  expect(kept.after.construction.primitives.some((p) => p.id === 'mast-step')).toBe(false);
  expect(kept.report.warnings.some((w) => w.includes('removed from the source after the import'))).toBe(true);
  expect(kept.report.removed).toEqual(['house']);
  const edited = object('mast-step', block('mast-step'), [0, 0, 7], 0, mesh, { shapeHash: 'moved', meshHash: 'mesh' });
  const back = blenderEdits(s, dump([edited], s, ['mast-step']), catalog);
  expect(back.report.added).toEqual([{ id: 'mast-step', object: 'mast-step', role: 'block' }]);
});
