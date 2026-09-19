import { beforeAll, expect, test } from 'bun:test';
import * as THREE from 'three/webgpu';
import init, { compile_construction } from '../generated/naval-wasm/naval_wasm';
import catalog from '../../public/models/components/catalog.json';
import { createStarterSource } from '../ships/constructionStarter';
import { createConstructionModel, disposeConstructionModel } from './constructionModel';
import type { ConstructionCatalog, ConstructionResult } from '../ships/blueprint';

beforeAll(async () => { await init({ module_or_path: await Bun.file(new URL('../generated/naval-wasm/naval_wasm_bg.wasm', import.meta.url)).arrayBuffer() }); });

test('saved whole-bottom red paint respects the coating height in the compiled game model', async () => {
  const source = createStarterSource(catalog as ConstructionCatalog, 'fletcher-hull', 'sea-blue');
  const hull = source.construction.primitives[0];
  source.construction.surfaces.push({ primitiveId: hull.id, face: 'bottom', thicknessMm: 35, material: 'armor-steel', paint: 'red-oxide' });
  const original = structuredClone(source);
  const compile = (): ConstructionResult => JSON.parse(compile_construction(JSON.stringify(source), JSON.stringify(catalog)));
  const result = compile();
  expect(result.diagnostics.filter(d => d.severity === 'error')).toEqual([]);
  const raisedBottom = result.surfaces.find(s => s.face === 'bottom' && s.vertices.some(v => v[1] > hull.customHull!.redPaintY!))!;
  expect(raisedBottom).toBeDefined();
  const inspect = async (compiled: ConstructionResult) => {
    const model = await createConstructionModel(source, compiled);
    const above: string[] = [];
    let redVertices = 0;
    model.traverse(node => {
      if (!(node instanceof THREE.Mesh)) return;
      const positions = node.geometry.getAttribute('position');
      if (!node.name.startsWith('hull.red-oxide:')) return;
      redVertices += positions.count;
      for (let i = 0; i < positions.count; i++) if (positions.getY(i) > original.construction.primitives[0].customHull!.redPaintY! + 1e-5) {
        above.push(node.userData.constructionSurfaces[Math.floor(i / 3)].panelId);
      }
    });
    expect(redVertices).toBeGreaterThan(0);
    disposeConstructionModel(model);
    return above;
  };
  expect(await inspect(result)).toEqual([]);
  expect(source).toEqual(original);
  expect(result.surfaces.find(s => s.id === raisedBottom.id)).toMatchObject({ paint: 'red-oxide', thicknessMm: 35, material: 'armor-steel' });

  // An individually painted panel remains an intentional override.
  source.construction.surfaces.push({ ...source.construction.surfaces.at(-1)!, panelId: raisedBottom.panelId });
  const explicit = await inspect(compile());
  expect(explicit.length).toBeGreaterThan(0);
  expect(new Set(explicit)).toEqual(new Set([raisedBottom.panelId!]));
  source.construction.surfaces.pop();
  delete hull.customHull!.redPaintY;
  expect((await inspect(compile())).length).toBeGreaterThan(0);
});

test('native source retains multiple coatings and the game model clips every band including the bow', async () => {
  const source = createStarterSource(catalog as ConstructionCatalog, 'fletcher-hull', 'light-gray');
  const hull = source.construction.primitives[0];
  const compile = (): ConstructionResult => JSON.parse(compile_construction(JSON.stringify(source), JSON.stringify(catalog)));
  const original = compile();
  hull.customHull!.paintBands = { version: 1, bands: [
    { id: 'lower', upperY: -.5, paint: 'red-oxide' },
    { id: 'waterline', upperY: .25, paint: 'boot-top-black' },
    { id: 'stripe', upperY: 1.2, paint: 'sea-blue' },
  ] };
  const result = compile();
  expect(result.diagnostics.filter(d => d.severity === 'error')).toEqual([]);
  expect(result.surfaces).toEqual(original.surfaces);
  expect(result.loading).toEqual(original.loading);
  const model = await createConstructionModel(source, result);
  const ranges: Record<string, [number, number]> = { 'red-oxide': [-Infinity, -.5], 'boot-top-black': [-.5, .25], 'sea-blue': [.25, 1.2], 'light-gray': [1.2, Infinity], 'deck-gray': [1.2, Infinity] };
  const seen = new Set<string>();
  try {
    model.traverse(node => {
      if (!(node instanceof THREE.Mesh) || !node.name.startsWith('hull.')) return;
      const paint = node.name.slice(5).split(':')[0], [min, max] = ranges[paint];
      seen.add(paint);
      const p = node.geometry.getAttribute('position');
      for (let i = 0; i < p.count; i++) {
        expect(p.getY(i)).toBeGreaterThanOrEqual(min - 1e-5);
        expect(p.getY(i)).toBeLessThanOrEqual(max + 1e-5);
      }
    });
    expect(seen).toEqual(new Set(Object.keys(ranges)));
  } finally { disposeConstructionModel(model); }
});
