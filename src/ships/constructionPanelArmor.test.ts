import { beforeAll, expect, test } from 'bun:test';
import init, { compile_construction } from '../generated/naval-wasm/naval_wasm';
import catalogJson from '../../public/models/components/catalog.json';
import type { ConstructionCatalog, ConstructionResult, ConstructionSource } from './blueprint';
import { createStarterSource } from './constructionStarter';
import { customHullPanels, mirroredPanelId } from './constructionPanels';
import { assignConstructionSurfaces, copyConstructionSelection, decodeConstructionSource, surfaceKey, surfaceSelectionKey } from './constructionEditor';
import { applyConstructionBatch, constructionDiffCommands } from './constructionCommands';
import { surfaceGroups, surfaceOutline } from '../ui/shipbuilding/surfaceOutline';
const catalog = catalogJson as ConstructionCatalog;
beforeAll(async () => { await init({ module_or_path: await Bun.file(new URL('../generated/naval-wasm/naval_wasm_bg.wasm', import.meta.url)).arrayBuffer() }); });
const compile = (source: ConstructionSource): ConstructionResult => JSON.parse(compile_construction(JSON.stringify(source), JSON.stringify(catalog)));
test('panel armor overrides one face while preserving the whole-side default and real mass', () => {
  const source = createStarterSource(catalog, 'destroyer-hull');
  assignConstructionSurfaces(source, new Set([surfaceKey('hull','port')]), { thicknessMm: 25, paint: 'sea-blue' });
  const before = compile(source); expect(before.definition, JSON.stringify(before.diagnostics)).toBeDefined();
  const groups = surfaceGroups(before.surfaces.filter(s => s.face === 'port'));
  expect(groups.length).toBeGreaterThan(7);
  const group = groups[Math.floor(groups.length / 2)], key = surfaceSelectionKey(group[0]);
  expect(surfaceOutline(group)).toHaveLength(4);
  const next = structuredClone(source); assignConstructionSurfaces(next, new Set([key]), { thicknessMm: 100, material: 'armor-steel' });
  const committed = applyConstructionBatch(source, { version: 1, expectedRevision: source.revision, label: 'Armor one panel', commands: constructionDiffCommands(source, next) });
  const reloaded = decodeConstructionSource(JSON.parse(JSON.stringify(committed))), after = compile(reloaded);
  expect(after.definition, JSON.stringify(after.diagnostics)).toBeDefined();
  expect(after.surfaces.filter(s => surfaceSelectionKey(s) === key).every(s => s.thicknessMm === 100 && s.paint === 'sea-blue')).toBe(true);
  expect(after.surfaces.filter(s => s.face === 'port' && surfaceSelectionKey(s) !== key).every(s => s.thicknessMm === 25)).toBe(true);
  expect(after.surfaces.filter(s => s.face === 'starboard').every(s => s.thicknessMm === 16)).toBe(true);
  expect(after.loading!.massKg).toBeGreaterThan(before.loading!.massKg);
});
test('panel IDs survive resizing and mirrored copies retain the matching opposite panel', () => {
  const source = createStarterSource(catalog, 'patrol-hull'), hull = source.construction.primitives[0];
  const panel = customHullPanels(hull)[9];
  assignConstructionSurfaces(source, new Set([surfaceKey(hull.id,panel.face,panel.panelId)]), { thicknessMm: 90 });
  const ids = customHullPanels(hull); hull.size = [10,8,60]; expect(customHullPanels(hull)).toEqual(ids);
  const [copy] = copyConstructionSelection(source, new Set([hull.id]), { mirror: true });
  expect(source.construction.surfaces.find(s => s.primitiveId === copy && s.panelId === mirroredPanelId(panel.panelId))).toMatchObject({ face: 'starboard', thicknessMm: 90 });
});

test('red paint elevation leaves native surfaces, loading and armor unchanged', () => {
  const source = createStarterSource(catalog, 'destroyer-hull');
  const before = compile(source);
  source.construction.primitives[0].customHull!.redPaintY = 2;
  const after = compile(source);
  expect(after.definition, JSON.stringify(after.diagnostics)).toBeDefined();
  expect(after.surfaces).toEqual(before.surfaces);
  expect(after.loading).toEqual(before.loading);
});
