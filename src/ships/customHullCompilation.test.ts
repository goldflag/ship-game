import { beforeAll, expect, test } from 'bun:test';
import init, { compile_construction } from '../generated/naval-wasm/naval_wasm';
import catalogJson from '../../public/models/components/catalog.json';
import type { ConstructionCatalog, ConstructionResult } from './blueprint';
import { createStarterSource } from './constructionStarter';
import { addHullPointPair, customHullPrimitive, editableCustomHull, removeHullPointPair } from './customHullModel';
import { customHullPanels } from './constructionPanels';
import { pendingHullSurfaces } from '../ui/shipbuilding/pendingHull';
import { primitiveOutlineGeometry } from '../ui/shipbuilding/primitiveGeometry';
import { HULL_PRESETS } from './constructionHullPresets';
import { decodeConstructionSource } from './constructionEditor';

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
  const source = createStarterSource(catalogJson as ConstructionCatalog, 'barge-hull'), p = source.construction.primitives[0], h = editableCustomHull(p);
  removeHullPointPair(h, 1); removeHullPointPair(h, 1);
  for (const count of [5, 33]) {
    while (h.stations[0].points.length < count) addHullPointPair(h, 0);
    source.construction.primitives[0] = customHullPrimitive(h, p);
    const result: ConstructionResult = JSON.parse(compile_construction(JSON.stringify(source), JSON.stringify(catalogJson)));
    expect(result.definition, JSON.stringify(result.diagnostics)).toBeDefined();
    expect(result.loading!.massKg).toBeGreaterThan(0);
  }
});
