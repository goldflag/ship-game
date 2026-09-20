import { expect, test } from 'bun:test';
import { assignConstructionSurfaces, copyConstructionSelection, decodeConstructionSource, solidPanels, surfaceKey } from './constructionEditor';
import { createStarterSource } from './constructionStarter';
import { applyConstructionBatch } from './constructionCommands';
import { primitiveGeometry } from '../game/constructionShapeGeometry';
import type { ConstructionCatalog, ConstructionPrimitive, ConstructionSolidPart, Vec3 } from './blueprint';
import catalog from '../../public/models/components/catalog.json';

/** One axis-aligned convex part over the shared vertex pool, wound outward. */
function boxPart(vertices: Vec3[], id: string, low: Vec3, high: Vec3, group?: string): ConstructionSolidPart {
  const base = vertices.length;
  for (let i = 0; i < 8; i++) vertices.push([0, 1, 2].map(k => ((i >> k) & 1 ? high : low)[k]) as Vec3);
  const quads = [[0, 4, 6, 2], [1, 3, 7, 5], [0, 1, 5, 4], [2, 6, 7, 3], [0, 2, 3, 1], [4, 5, 7, 6]];
  return { id, faces: quads.map(q => ({ corners: q.map(k => base + k), ...(group ? { group } : {}) })) };
}
/** An L: two parts that meet on one face, which no single convex block can be. The corners are
 * authored in metres and normalized into the ±0.5 frame the format requires. */
function lBlock(): ConstructionPrimitive {
  const metres: Vec3[] = [];
  const parts = [boxPart(metres, 'leg', [0, 0, 0], [1, 3, 1], 'leg'), boxPart(metres, 'foot', [1, 0, 0], [3, 1, 1], 'foot')];
  const low = [0, 1, 2].map(k => Math.min(...metres.map(v => v[k])));
  const size = [0, 1, 2].map(k => Math.max(...metres.map(v => v[k])) - low[k] || 1) as Vec3;
  const vertices = metres.map(v => v.map((n, k) => (n - low[k]) / size[k] - 0.5) as Vec3);
  return { id: 'solid', kind: 'vertex', size, position: [0, 4, 0], rotationDeg: 0, solid: { version: 1, label: 'L block', vertices, parts } };
}

test('a compound solid survives the source decoder, a batch and a copy unchanged', () => {
  const source = createStarterSource(catalog as ConstructionCatalog, 'blank');
  const piece = lBlock(), before = structuredClone(piece);
  const changed = applyConstructionBatch(source, { version: 1, expectedRevision: source.revision, label: 'Add solid', commands: [{ op: 'primitive', value: piece }] });
  expect(decodeConstructionSource(JSON.parse(JSON.stringify(changed))).construction.primitives.at(-1)).toEqual(before);
  const [copy] = copyConstructionSelection(changed, new Set([piece.id]), [0, 0, 5]);
  expect(changed.construction.primitives.find(p => p.id === copy)!.solid).toEqual(before.solid!);
});

test('the decoder rejects the shapes Rust would reject, naming what is wrong', () => {
  const broken = (edit: (p: ConstructionPrimitive) => void) => {
    const source = createStarterSource(catalog as ConstructionCatalog, 'blank'), piece = lBlock();
    edit(piece);
    source.construction.primitives.push(piece);
    return () => decodeConstructionSource(JSON.parse(JSON.stringify(source)));
  };
  expect(broken(p => { p.solid!.version = 2 as 1; })).toThrow('compound solid');
  expect(broken(p => { p.kind = 'box'; })).toThrow('compound solid');
  expect(broken(p => { p.vertices = Array.from({ length: 8 }, () => [0, 0, 0] as Vec3); })).toThrow('compound solid');
  expect(broken(p => { p.solid!.label = ''; })).toThrow('1–80 characters');
  expect(broken(p => { p.solid!.parts = []; })).toThrow('1–256 convex parts');
  expect(broken(p => { p.solid!.parts[1].id = p.solid!.parts[0].id; })).toThrow('unique');
  expect(broken(p => { p.solid!.parts[0].faces.length = 3; })).toThrow('4–128 polygons');
  expect(broken(p => { p.solid!.parts[0].faces[0].corners = [0, 0, 1]; })).toThrow('distinct vertex indices');
  expect(broken(p => { p.solid!.parts[0].faces[0].corners = [0, 1, 99]; })).toThrow('distinct vertex indices');
  expect(broken(p => { p.solid!.parts[0].faces[0].group = 'a:b'; })).toThrow('cannot contain');
  expect(broken(p => { p.solid!.vertices[0] = [0, 0.75, 0]; })).toThrow('normalized within');
});

test('surface groups are addressable per side and draft geometry covers every part', () => {
  const piece = lBlock();
  const panels = solidPanels(piece);
  expect([...new Set(panels.map(panel => panel.panelId))].sort()).toEqual(['foot', 'leg']);
  const source = createStarterSource(catalog as ConstructionCatalog, 'blank');
  source.construction.primitives.push(piece);
  assignConstructionSurfaces(source, new Set([surfaceKey(piece.id, 'port', 'leg')]), { thicknessMm: 120, material: 'armor-steel' });
  const belt = source.construction.surfaces.find(surface => surface.panelId === 'leg');
  expect(belt).toMatchObject({ primitiveId: 'solid', face: 'port', panelId: 'leg', thicknessMm: 120, material: 'armor-steel' });
  // The draft envelope is display-only, but it must show both parts: 2 x 6 quads as triangles.
  const geometry = primitiveGeometry(piece.kind, piece.size, undefined, undefined, undefined, undefined, undefined, piece.solid);
  expect(geometry.getAttribute('position').count).toBe(2 * 6 * 2 * 3);
});
