import { beforeAll, expect, test } from 'bun:test';
import init, { compile_construction } from '../../generated/naval-wasm/naval_wasm';
import type { ConstructionCatalog, ConstructionResult, Vec3 } from '../../ships/blueprint';
import catalog from '../../../public/models/components/catalog.json';
import { createStarterSource } from '../../ships/constructionStarter';
import { defaultBalcony } from '../../ships/constructionBalcony';
import { balconyAttachmentPoints, balconyInnerEdge, balconyPlacement, reseatBalcony, seatBalconyOnHull } from './balconyPlacement';
import { placementCenter } from './placement';
import { placementBlocks } from './blockMovement';
import { pendingHullSurfaces } from './pendingHull';

beforeAll(async () => { await init({ module_or_path: await Bun.file('src/generated/naval-wasm/naval_wasm_bg.wasm').arrayBuffer() }); });
const compile = (source: ReturnType<typeof createStarterSource>) => JSON.parse(compile_construction(JSON.stringify(source), JSON.stringify(catalog))) as ConstructionResult;
const piece = { kind: 'hull' as const, shape: 'balcony' as const, size: [1, .08, 2] as Vec3, rotationDeg: 0 };
const source = () => {
  const result = createStarterSource(catalog as ConstructionCatalog, 'blank');
  result.construction.primitives[0].size = [8, 8, 8];
  return result;
};

test('the long open edge faces each clicked side, even an inward-facing wall away from the centerline', () => {
  for (const normal of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]] as Vec3[]) {
    const design = source(); design.construction.primitives[0].position = [10, 0, 0];
    const point = normal.map((v, k) => v * 4 + (k === 0 ? 10 : 0)) as Vec3;
    const oriented = balconyPlacement(piece, normal);
    const position = placementCenter(oriented, { point, normal }, 1);
    const [balcony] = placementBlocks(oriented, [position], false, () => 'balcony');
    const { corners, edge } = balconyInnerEdge(balcony, normal);
    expect(balcony.balcony!.points[edge].edge).toBe('open');
    expect(Math.hypot(...corners[0].map((v, k) => v - corners[2][k]))).toBeCloseTo(2.06, 7);
    design.construction.primitives.push(balcony);
    expect(compile(design).definition).toBeDefined();
  }
});

test('resizing and opening an existing detached balcony restore physical support in the saved source', () => {
  const design = source();
  const before = { id: 'balcony', kind: 'balcony' as const, size: [2, .08, 1] as Vec3, position: [5.1, 0, 0] as Vec3, rotationDeg: 0, balcony: defaultBalcony() };
  before.balcony.points.forEach(p => { p.edge = 'wall'; });
  design.construction.primitives.push(before);
  expect(compile(design).diagnostics.some(d => d.code === 'attachment')).toBe(true);
  const after = structuredClone(before); after.size[0] = 1; after.balcony.points[3].edge = 'open';
  const seated = reseatBalcony(design, before, after);
  expect(seated.position[0]).toBeCloseTo(4.49, 7);
  design.construction.primitives[1] = seated;
  expect(compile(design).definition).toBeDefined();
});

test('tapered and sloped hull sides meet the whole deck edge and compile', () => {
  for (const [dy, dz] of [[.2, 0], [-.2, 0], [0, .2], [.15, .15]]) {
    const design = source(), hull = design.construction.primitives[0];
    hull.kind = 'vertex';
    hull.vertices = [[-.5,-.5,-.5],[.5,-.5,-.5],[.5,.5,-.5],[-.5,.5,-.5],[-.5,-.5,.5],[.5,-.5,.5],[.5,.5,.5],[-.5,.5,.5]]
      .map(([x,y,z]) => [x === .5 ? x - dy * y - dz * z : x, y, z] as Vec3);
    const normal = [1, dy, dz].map(v => v / Math.hypot(1, dy, dz)) as Vec3;
    const oriented = balconyPlacement(piece, normal);
    const position = placementCenter(oriented, { point: [4, 0, 0], normal }, 1);
    const [balcony] = placementBlocks(oriented, [position], false, () => 'balcony');
    const surfaces = pendingHullSurfaces(design, { ...design, id: '' }, []);
    const support = surfaces.find(s => s.normal[0] > .9)!;
    balcony.position = seatBalconyOnHull(balcony, balcony.position, support, surfaces);
    for (const corner of balconyAttachmentPoints(balcony, normal)) {
      const world = corner.map((v, k) => v + balcony.position[k]);
      expect(world[0] + dy * world[1] + dz * world[2]).toBeLessThan(4);
    }
    design.construction.primitives.push(balcony);
    const result = compile(design);
    expect(result.definition, JSON.stringify(result.diagnostics)).toBeDefined();
  }
});
