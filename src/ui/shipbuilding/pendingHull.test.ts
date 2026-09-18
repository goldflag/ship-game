import { expect, test } from 'bun:test';
import type { ConstructionSource, ConstructionSurface } from '../../ships/blueprint';
import { pendingHullSurfaces } from './pendingHull';
import { customHullPrimitive, makeHull } from '../../ships/customHullModel';
import { customHullPanels } from '../../ships/constructionPanels';
import { paintedHullFace } from '../../ships/constructionHullPaint';

const source = (): ConstructionSource => ({ schemaVersion: 1, id: 'ship', revision: 'one', name: 'Ship', coordinates: 'meters-y-up-bow-negative-z', construction: { version: 1, catalogRevision: 'catalog', defaultThicknessMm: 12, primitives: [{ id: 'hull', kind: 'box', size: [4, 2, 8], position: [0, 0, 0], rotationDeg: 0 }], surfaces: [], equipment: [], boundaries: [], loads: [] } });
const face: ConstructionSurface = { id: 'native-top', primitiveId: 'hull', face: 'top', vertices: [[-2, 1, -4], [2, 1, 4], [2, 1, -4]], normal: [0, 1, 0], areaM2: 16, thicknessMm: 12, material: 'steel', paint: 'naval-gray', open: false };

test('adding a block retains native hull faces and immediately displays the new piece', () => {
  const before = source(), after = structuredClone(before);
  after.construction.primitives.push({ id: 'new', kind: 'box', size: [2, 2, 2], position: [0, 2, 0], rotationDeg: 0 });
  const surfaces = pendingHullSurfaces(after, before, [face]);
  expect(surfaces.find(s => s.id === face.id)).toBe(face);
  expect(surfaces.filter(s => s.primitiveId === 'new')).toHaveLength(6);
  expect(Math.max(...surfaces.flatMap(s => s.vertices.map(v => v[1])))).toBe(3);
});

test('moving and deleting pieces never leaves their old faces behind; pending paint and openings apply', () => {
  const before = source(), after = structuredClone(before);
  after.construction.primitives[0].position[0] = 10;
  after.construction.surfaces = [{ primitiveId: 'hull', face: 'top', thicknessMm: 12, material: 'steel', paint: 'sea-blue', open: true }];
  const surfaces = pendingHullSurfaces(after, before, [face]);
  expect(surfaces.some(s => s.id === face.id)).toBe(false);
  expect(surfaces.every(s => s.vertices.every(v => v[0] >= 8))).toBe(true);
  expect(surfaces.find(s => s.face === 'top')).toMatchObject({ paint: 'sea-blue', open: true });
  after.construction.primitives = [];
  expect(pendingHullSurfaces(after, before, [face])).toEqual([]);
});

test('another design cannot inherit compiled geometry', () => {
  const before = source(), after = source(); after.id = 'other';
  expect(pendingHullSurfaces(after, before, [face]).some(s => s.id === face.id)).toBe(false);
});

test('deleting or moving a touching block restores clipped faces on its neighbor immediately', () => {
  const before = source();
  before.construction.primitives.push({ id: 'cover', kind: 'box', size: [4, 2, 8], position: [0, 2, 0], rotationDeg: 0 });
  before.construction.primitives.push({ id: 'distant', kind: 'box', size: [2, 2, 2], position: [20, 0, 0], rotationDeg: 0 });
  before.construction.surfaces = [{ primitiveId: 'hull', face: 'top', thicknessMm: 20, material: 'steel', paint: 'teak-natural' },
    { primitiveId: 'hull', face: 'bottom', thicknessMm: 12, material: 'steel', paint: 'naval-gray', open: true }];
  const distant = { ...face, id: 'native-distant', primitiveId: 'distant' };
  // Native union has removed the hull's entire top where the cover touched it.
  const native = [distant];
  for (const move of [false, true]) {
    const after = structuredClone(before);
    if (move) after.construction.primitives[1].position[0] = 10;
    else after.construction.primitives.splice(1, 1);
    const surfaces = pendingHullSurfaces(after, before, native);
    const top = surfaces.filter(s => s.primitiveId === 'hull' && s.face === 'top');
    expect(top.reduce((area, s) => area + s.areaM2, 0)).toBe(32);
    expect(top.every(s => s.paint === 'teak-natural' && s.thicknessMm === 20 && !s.open)).toBe(true);
    expect(surfaces.find(s => s.primitiveId === 'hull' && s.face === 'bottom')?.open).toBe(true);
    expect(surfaces.find(s => s.id === distant.id)).toBe(distant);
    expect(surfaces.filter(s => s.primitiveId === 'cover').every(s => s.vertices.every(v => v[0] >= 8))).toBe(true);
  }
});

test('edited custom hulls retain panel paint, openings and the red waterline setting', () => {
  const before = source(), after = source();
  const hull = customHullPrimitive(makeHull(0)); hull.id = 'custom';
  hull.customHull!.redPaintY = 0;
  hull.position = [10, 2, 0]; hull.rotationDeg = 90;
  after.construction.primitives = [hull];
  const panel = customHullPanels(hull)[0];
  after.construction.surfaces = [{ primitiveId: hull.id, ...panel, thicknessMm: 30, material: 'armor-steel', paint: 'sea-blue', open: true }];
  const surfaces = pendingHullSurfaces(after, before, [face]);
  expect(surfaces.filter(s => s.panelId === panel.panelId)).toHaveLength(2);
  expect(surfaces.filter(s => s.panelId === panel.panelId).every(s => s.paint === 'sea-blue' && s.open && s.thicknessMm === 30)).toBe(true);
  expect(surfaces.every(s => s.vertices.every(v => v.every(Number.isFinite)) && Math.abs(Math.hypot(...s.normal) - 1) < 1e-8)).toBe(true);
  expect(surfaces.flatMap(s => paintedHullFace(s, hull)).some(f => f.paint === 'red-oxide')).toBe(true);
});
