import { beforeAll, expect, test } from 'bun:test';
import init, { compile_construction } from '../generated/naval-wasm/naval_wasm';
import catalogJson from '../../public/models/components/catalog.json';
import type { ConstructionCatalog, ConstructionResult } from './blueprint';
import { createStarterSource } from './constructionStarter';
import { addHullPointPair, customHullBilgeKeelFaces, customHullFaces, customHullPrimitive, editableCustomHull, removeHullPointPair } from './customHullModel';
import { customHullPanels } from './constructionPanels';
import { pendingHullSurfaces } from '../ui/shipbuilding/pendingHull';
import { primitiveOutlineGeometry } from '../ui/shipbuilding/primitiveGeometry';
import { HULL_PRESETS } from './constructionHullPresets';
import { decodeConstructionSource } from './constructionEditor';
import { primitivePoint } from './constructionOrientation';

beforeAll(async () => { await init({ module_or_path: await Bun.file(new URL('../generated/naval-wasm/naval_wasm_bg.wasm', import.meta.url)).arrayBuffer() }); });

test.each([...HULL_PRESETS])('$name with paired point edits compiles after save/reopen, with matching preview panels', preset => {
  const source = createStarterSource(catalogJson as ConstructionCatalog, preset.id);
  const original = structuredClone(source), primitive = source.construction.primitives[0], hull = editableCustomHull(primitive);
  addHullPointPair(hull, 7);
  source.construction.primitives[0] = customHullPrimitive(hull, primitive);
  const saved = decodeConstructionSource(JSON.parse(JSON.stringify(source)));
  const result: ConstructionResult = JSON.parse(compile_construction(JSON.stringify(saved), JSON.stringify(catalogJson)));
  expect(result.definition, JSON.stringify(result.diagnostics)).toBeDefined();
  const panels = customHullPanels(saved.construction.primitives[0]);
  expect(result.surfaces.every(s => panels.some(p => p.panelId === s.panelId && p.face === s.face))).toBe(true);
  const pending = pendingHullSurfaces(saved, original, []);
  expect(pending.every(s => panels.some(p => p.panelId === s.panelId && p.face === s.face))).toBe(true);
  expect(new Set(pending.map(s => s.panelId))).toEqual(new Set(result.surfaces.map(s => s.panelId)));
  const lines = primitiveOutlineGeometry(saved.construction.primitives[0]);
  expect(lines.getAttribute('position').count).toBe((hull.stations.length * 2 - 1) * 11 * 2);
  expect(Array.from(lines.getAttribute('position').array).every(Number.isFinite)).toBe(true);
  lines.dispose();
});

test('minimum and maximum point counts produce valid native hulls', () => {
  const source = createStarterSource(catalogJson as ConstructionCatalog, 'baltimore-hull'), p = source.construction.primitives[0], h = editableCustomHull(p);
  removeHullPointPair(h, 1); removeHullPointPair(h, 1);
  for (const count of [5, 33]) {
    while (h.stations[0].points.length < count) addHullPointPair(h, 0);
    source.construction.primitives[0] = customHullPrimitive(h, p);
    const result: ConstructionResult = JSON.parse(compile_construction(JSON.stringify(source), JSON.stringify(catalogJson)));
    expect(result.definition, JSON.stringify(result.diagnostics)).toBeDefined();
    expect(result.loading!.massKg).toBeGreaterThan(0);
  }
});


test.each([...HULL_PRESETS])('$name bilge keels match native export, stay symmetric and leave physics unchanged', preset => {
  const source = createStarterSource(catalogJson as ConstructionCatalog, preset.id), p = source.construction.primitives[0];
  const result: ConstructionResult = JSON.parse(compile_construction(JSON.stringify(source), JSON.stringify(catalogJson)));
  expect(result.definition, JSON.stringify(result.diagnostics)).toBeDefined();
  const faces = customHullBilgeKeelFaces(editableCustomHull(p)), native = result.bilgeKeelSurfaces!;
  expect(native.length).toBe(faces.length);
  for (let i=0;i<faces.length;i++) {
    expect(native[i].areaM2).toBeGreaterThan(0);
    for (let j=0;j<3;j++) for (let a=0;a<3;a++) expect(native[i].vertices[j][a]).toBeCloseTo(faces[i][j][a], 8);
    if (i%2===0) expect(faces[i+1]).toEqual([...faces[i]].reverse().map(p => [-p[0],p[1],p[2]]));
  }
  p.customHull!.bilgeKeels!.enabled=false;
  const without: ConstructionResult = JSON.parse(compile_construction(JSON.stringify(source), JSON.stringify(catalogJson)));
  expect(without.bilgeKeelSurfaces).toBeUndefined();
  expect(without.loading).toEqual(result.loading);
  expect(without.surfaces).toEqual(result.surfaces);
  expect(customHullBilgeKeelFaces(editableCustomHull(p))).toEqual([]);
});

test('native bilge keel validation rejects malformed dimensions', () => {
  const source = createStarterSource(catalogJson as ConstructionCatalog, 'fletcher-hull');
  source.construction.primitives[0].customHull!.bilgeKeels!.start = .9;
  const result: ConstructionResult = JSON.parse(compile_construction(JSON.stringify(source), JSON.stringify(catalogJson)));
  expect(result.definition).toBeUndefined();
  expect(result.diagnostics.some(d => d.message.includes('bilge keels'))).toBe(true);
});

test('configured bilge keels follow a moved, tilted hull after outline edits', () => {
  const source = createStarterSource(catalogJson as ConstructionCatalog, 'patrol-hull'), original = source.construction.primitives[0];
  const hull = editableCustomHull(original);
  addHullPointPair(hull, 2);
  hull.bilgeKeels = { version: 1, enabled: true, start: .02, end: .98, widthM: .65, thicknessM: .04, placement: .58 };
  const p = customHullPrimitive(hull, original);
  p.position = [3, -1, 7]; p.rotationDeg = 32; p.tilt = { version: 1, pitchDeg: 7, rollDeg: -9 };
  source.construction.primitives[0] = p;
  const result: ConstructionResult = JSON.parse(compile_construction(JSON.stringify(source), JSON.stringify(catalogJson)));
  expect(result.definition, JSON.stringify(result.diagnostics)).toBeDefined();
  const expected = customHullBilgeKeelFaces(hull).map(face => face.map(v => primitivePoint(p, v)));
  expect(result.bilgeKeelSurfaces!.length).toBe(expected.length);
  result.bilgeKeelSurfaces!.forEach((face, i) => face.vertices.forEach((v, j) => v.forEach((n, a) => expect(n).toBeCloseTo(expected[i][j][a], 8))));
});

test('a wine-glass bow compiles natively through the band cut, and the editor draws the same banded caps', () => {
  const source = createStarterSource(catalogJson as ConstructionCatalog, 'patrol-hull'), p = source.construction.primitives[0];
  // Flare over a narrow waist over a wider forefoot in every section: no single centre sees the whole span.
  const half = [[1, .5], [.12, .25], [.8, -.2], [.8, -.5]];
  for (const station of p.customHull!.stations) {
    const n = station.points.length, keel = (n - 1) / 2;
    station.points = station.points.map((point, i) => {
      if (i === keel) return { ...point, x: 0, y: -.5 };
      const j = Math.min(i, n - 1 - i), f = j / keel * (half.length - 1), k = Math.min(Math.floor(f), half.length - 2), t = f - k;
      const [x, y] = [half[k][0] + (half[k + 1][0] - half[k][0]) * t, half[k][1] + (half[k + 1][1] - half[k][1]) * t];
      return { ...point, x: i < keel ? -x : x, y };
    });
  }
  p.customHull!.bulb = 0; p.customHull!.rake = 0;
  const result: ConstructionResult = JSON.parse(compile_construction(JSON.stringify(source), JSON.stringify(catalogJson)));
  expect(result.definition, JSON.stringify(result.diagnostics)).toBeDefined();
  const area = (vertices: number[][]) => {
    let [x, y, z] = [0, 0, 0];
    for (let i = 1; i + 1 < vertices.length; i++) {
      const [a, b, c] = [vertices[0], vertices[i], vertices[i + 1]];
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      x += u[1] * v[2] - u[2] * v[1]; y += u[2] * v[0] - u[0] * v[2]; z += u[0] * v[1] - u[1] * v[0];
    }
    return Math.hypot(x, y, z) / 2;
  };
  // Banded caps: two triangles per band (none for the flat keel band), not the fan's one per outline edge.
  expect(customHullFaces(p).filter(f => f.group === 'bow').length).toBe(p.customHull!.stations[0].points.length - 2);
  for (const end of ['bow', 'stern']) {
    const native = result.surfaces.filter(s => s.primitiveId === p.id && s.face === end).reduce((sum, s) => sum + s.areaM2, 0);
    const drawn = customHullFaces(p).filter(f => f.group === end).reduce((sum, f) => sum + area(f.vertices), 0);
    expect(native).toBeGreaterThan(0);
    expect(drawn).toBeCloseTo(native, 3);
  }
});
