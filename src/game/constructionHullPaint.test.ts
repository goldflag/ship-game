import { beforeAll, expect, test } from 'bun:test';
import * as THREE from 'three/webgpu';
import init, { compile_construction } from '../generated/naval-wasm/naval_wasm';
import catalog from '../../public/models/components/catalog.json';
import { createStarterSource } from '../ships/constructionStarter';
import { createConstructionHull, createConstructionModel, disposeConstructionModel } from './constructionModel';
import { constructionPaintColor, roofShade } from '../ships/constructionPaints';
import type { ConstructionCatalog, ConstructionResult, ConstructionSource, ConstructionSurface, Vec3 } from '../ships/blueprint';

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

test('decks wearing the ship paint take the roof colour; sides, teak and other paints keep theirs', () => {
  const face = (id: string, paint: string, normal: Vec3): ConstructionSurface => ({ id, primitiveId: 'hull', face: id, paint, normal, open: false, areaM2: 1,
    thicknessMm: 10, material: 'steel', vertices: normal[1] ? [[0, 1, 0], [0, 1, 1], [1, 1, 0]] : [[0, 0, 0], [0, 1, 0], [0, 0, 1]] });
  const surfaces = [face('deck', 'light-gray', [0, 1, 0]), face('side', 'light-gray', [1, 0, 0]), face('teak', 'teak-natural', [0, 1, 0]), face('other', 'dark-gray', [0, 1, 0])];
  const colors = (appearance?: Pick<ConstructionSource['construction'], 'paint' | 'roofPaint'>) => {
    const data = appearance && { version: 2 as const, catalogRevision: 'test', defaultThicknessMm: 10, primitives: [], surfaces: [], equipment: [], boundaries: [], loads: [], ...appearance };
    const hull = createConstructionHull(surfaces, [], undefined, data), found: Record<string, string> = {};
    hull.traverse(node => { if (node instanceof THREE.Mesh) found[node.name] = '#' + (node.material as THREE.MeshStandardMaterial).color.getHexString(); });
    disposeConstructionModel(hull);
    return found;
  };
  const shaded = roofShade(constructionPaintColor('light-gray'));
  expect(shaded).not.toBe(constructionPaintColor('light-gray'));
  expect(colors({ paint: 'light-gray' })).toEqual({
    'hull.light-gray:true': shaded, 'hull.light-gray:false': '#b5bfbc', 'hull.teak-natural:true': '#97856a', 'hull.dark-gray:true': '#43565f',
  });
  expect(colors({ paint: 'light-gray', roofPaint: 'deck-gray' })['hull.light-gray:true']).toBe('#64716f');
  // Without a ship paint the ship paint is naval gray, so these light gray decks are an accent.
  expect(colors()['hull.light-gray:true']).toBe('#b5bfbc');
  expect(colors({ paint: 'dark-gray' })['hull.dark-gray:true']).toBe(roofShade('#43565f'));
});
