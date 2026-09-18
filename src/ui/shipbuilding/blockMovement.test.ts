import { beforeAll, expect, test } from 'bun:test';
import init from '../../generated/naval-wasm/naval_wasm';
import type { ConstructionPrimitive, ConstructionSource, Vec3 } from '../../ships/blueprint';
import { blockMoveConstraint, blockPlacementAllowed, placementBlocks } from './blockMovement';
beforeAll(async () => { await init({ module_or_path: await Bun.file(new URL('../../generated/naval-wasm/naval_wasm_bg.wasm', import.meta.url)).arrayBuffer() }); });
const block = (id: string, position: Vec3, size: Vec3 = [2, 2, 2], rotationDeg = 0): ConstructionPrimitive => ({ id, kind: 'box', position, size, rotationDeg });
const source = (primitives: ConstructionPrimitive[]) => ({ construction: { primitives } } as ConstructionSource);
const move = (primitives: ConstructionPrimitive[], delta: Vec3, ids = ['a']) => blockMoveConstraint(source(primitives), new Set(ids))(delta);
const near = (actual: Vec3, expected: Vec3) => actual.forEach((v,k) => expect(v).toBeCloseTo(expected[k], 5));

test('balcony placement previews and mirrored commits carry valid outline data', () => {
  let id = 0;
  const pieces = placementBlocks({ kind: 'hull', shape: 'balcony', size: [2, .08, 1], rotationDeg: 0 }, [[2, 1.04, 0]], true, () => `balcony-${id++}`);
  expect(pieces).toHaveLength(2);
  expect(pieces.every(p => p.balcony?.points.length === 4 && p.balcony.points.filter(point => point.edge === 'wall').length === 3 && p.balcony.points.filter(point => point.edge === 'open').length === 1)).toBe(true);
  expect(pieces[1].position).toEqual([-2, 1.04, 0]);
  expect(blockPlacementAllowed(source([block('hull', [0, 0, 0], [10, 2, 10])]), pieces)).toBe(true);
});

test('90% overlap is allowed, and fast movement stops before complete burial', () => {
  const parts = [block('a',[0,0,0]),block('b',[5,0,0])];
  near(move(parts,[20,0,0]),[4.8,0,0]);
  near(move(parts,[4,0,0]),[4,0,0]);
  near(move(parts,[-20,0,0]),[-20,0,0]);
});
test('all axes allow seating and retain tangent movement at the limit', () => {
  for(let k=0;k<3;k++) {
    const p:Vec3=[0,0,0];p[k]=2;
    const delta:Vec3=[0,0,0];delta[k]=1.8;
    near(move([block('a',[0,0,0]),block('b',p)],delta),delta);
    p[k]=.2;
    near(move([block('a',[0,0,0]),block('b',p)],delta),[0,0,0]);
    const tangent:Vec3=[0,0,0];tangent[(k+1)%3]=4;
    near(move([block('a',[0,0,0]),block('b',p)],tangent),tangent);
  }
});
test('a rigid selection checks its own members against the complete union', () => {
  const parts=[block('a',[0,0,0]),block('b',[2,0,0]),block('c',[7,0,0])];
  near(move(parts,[10,0,0],['a','b']),[4.8,0,0]);
  near(move(parts,[10,2,0],['a','b','c']),[10,2,0]);
});
test('existing excessive overlap can recover without becoming deeper', () => {
  const parts=[block('a',[0,0,0]),block('b',[.1,0,0])];
  near(move(parts,[-1,0,0]),[-1,0,0]);
  near(move(parts,[.05,0,0]),[0,0,0]);
  near(move([block('a',[0,0,0]),block('b',[0,0,0])],[0,3,0]),[0,3,0]);
  near(move([block('a',[0,0,0]),block('b',[0,0,0],[20,20,20])],[12,0,0]),[12,0,0]);
});
test('a large block cannot swallow a stationary small block', () => {
  near(move([block('a',[0,0,0],[10,10,10]),block('b',[10,0,0])],[20,0,0]),[5.8,0,0]);
});
test('several neighbors count together, without double counting shared overlap', () => {
  const base=[block('left',[-1,0,0]),block('right',[1,0,0])];
  expect(blockPlacementAllowed(source(base),[block('new',[0,0,0])])).toBe(false);
  const overlapping=[block('left',[-1,0,0]),block('same',[-1,0,0])];
  expect(blockPlacementAllowed(source(overlapping),[block('new',[0,0,0])])).toBe(true);
  // Each individual neighbor covers only 50%, but the pair buries the moving block.
  const result=move([block('a',[0,0,-5]),...base],[0,0,10]);
  near(result,[0,0,4.8]);
});
test('placements reject duplicates, swallowed neighbors and invalid mirrored batches', () => {
  expect(blockPlacementAllowed(source([block('old',[0,0,0])]),[block('new',[0,0,0])])).toBe(false);
  expect(blockPlacementAllowed(source([block('old',[0,0,0])]),[block('new',[0,0,0],[10,10,10])])).toBe(false);
  expect(blockPlacementAllowed(source([block('old',[0,-2,0])]),[block('new',[.05,0,0]),block('mirror',[-.05,0,0])])).toBe(false);
  expect(blockPlacementAllowed(source([block('old',[0,0,0])]),[block('new',[.2,0,0])])).toBe(true);
});
test('curved and hollow shapes use their solids rather than enclosing boxes', () => {
  const sphere={...block('a',[0,0,0]),kind:'sphere' as const};
  near(move([sphere,block('b',[2,0,0])],[.5,0,0]),[.5,0,0]);
  const shell={...block('shell',[0,0,0],[10,10,10]),kind:'hollow-cube' as const};
  expect(blockPlacementAllowed(source([shell]),[block('small',[0,0,0],[.25,.25,.25])])).toBe(true);
});
test('rotation and deformed corners affect actual volume', () => {
  near(move([block('a',[0,0,0],[6,2,2],90),block('b',[5,0,0])],[10,0,0]),[4.8,0,0]);
  const p={...block('a',[0,0,0]),kind:'vertex' as const,vertices:[[-.5,-.5,-.5],[1,-.5,-.5],[1,.5,-.5],[-.5,.5,-.5],[-.5,-.5,.5],[1,-.5,.5],[1,.5,.5],[-.5,.5,.5]] as Vec3[]};
  near(move([p,block('b',[5,0,0])],[10,0,0]),[3.8,0,0]);
});
test('ballast still stops at contact with other ballast', () => {
  const parts=[{...block('a',[0,0,0]),kind:'ballast' as const},{...block('b',[5,0,0]),kind:'ballast' as const}];
  near(move(parts,[20,0,0]),[3,0,0]);
  expect(blockPlacementAllowed(source([parts[0]]),[{...parts[1],position:[1,0,0]}])).toBe(false);
});
test('fitting-only moves remain free and invalid inputs fail closed', () => {
  near(move([block('a',[0,0,0])],[1,2,3],['fitting']),[1,2,3]);
  near(move([block('a',[0,0,0])],[NaN,0,0]),[0,0,0]);
});


test('a long diagonal drag skips empty spatial bins and does not stop at a grazed corner', () => {
  near(move([block('a',[0,0,0]),block('b',[0,100,0])],[1000,1000,1000]),[1000,1000,1000]);
  near(move([block('a',[0,0,0]),block('b',[4,0,0])],[4,4,0]),[4,4,0]);
});
