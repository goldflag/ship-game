import { expect, test } from 'bun:test';
import { balconyFaces, balconyProblem, balconyTriangles, defaultBalcony, placementBalcony } from './constructionBalcony';
import { mirroredPrimitive, decodeConstructionSource } from './constructionEditor';
import { createStarterSource } from './constructionStarter';
import { applyConstructionBatch } from './constructionCommands';
import type { ConstructionCatalog, ConstructionPrimitive } from './blueprint';
import catalog from '../../public/models/components/catalog.json';
import { HULL_SHAPES } from '../ui/shipbuilding/builderLayers';

test('Hull starts with a standard block and a 1 by 2 metre walled balcony', () => {
  expect(HULL_SHAPES.slice(0, 2).map(shape => shape.id)).toEqual(['block', 'balcony']);
  expect(HULL_SHAPES[1].size).toEqual([1, .08, 2]);
  expect(defaultBalcony().points.map(point => point.edge)).toEqual(['wall', 'wall', 'wall', 'open']);
});

test('concave outlines triangulate without filling their notch, including reflected outlines', () => {
  const points = [{x:0,z:0},{x:1,z:0},{x:1,z:1},{x:.5,z:.5},{x:0,z:1}];
  for (const outline of [points, points.map(p => ({...p,x:-p.x}))]) {
    const triangles = balconyTriangles(outline);
    const area = triangles.reduce((sum, [a,b,c]) => { const p=outline[a],q=outline[b],r=outline[c]; return sum+Math.abs((q.x-p.x)*(r.z-p.z)-(q.z-p.z)*(r.x-p.x))/2; }, 0);
    expect(area).toBeCloseTo(.75, 10);
  }
  expect(() => balconyTriangles([points[0],points[2],points[1],points[4]])).toThrow('cross');
});

test('point insertion, edge treatments, source commands and mirrored copies retain their identities', () => {
  const source=createStarterSource(catalog as ConstructionCatalog,'blank');
  const piece:ConstructionPrimitive={id:'balcony',kind:'balcony',size:[4,.08,6],position:[4,3,0],rotationDeg:90,balcony:defaultBalcony()};
  piece.balcony!.points[0].edge='railing';piece.balcony!.points[1].edge='wall';piece.balcony!.points[2].edge='triple-railing';
  const before=structuredClone(piece);
  const changed=applyConstructionBatch(source,{version:1,expectedRevision:source.revision,label:'Add balcony',commands:[{op:'primitive',value:piece}]});
  expect(decodeConstructionSource(JSON.parse(JSON.stringify(changed))).construction.primitives.at(-1)).toEqual(piece);
  expect(mirroredPrimitive(mirroredPrimitive(piece))).toEqual(before);
  expect(piece).toEqual(before);
  expect(balconyProblem(piece.balcony!)).toBeUndefined();
  expect(balconyFaces(piece.size,piece.balcony).flat().some(v=>v[1]>.08)).toBe(true);
  // A triple railing adds exactly one rail (one six-faced bar) to the two-rail edge.
  const rails = (edge: 'railing' | 'triple-railing') => { const b = defaultBalcony(); b.points.forEach(point => { point.edge = 'open'; }); b.points[0].edge = edge; return balconyFaces(piece.size, b).length; };
  expect(rails('triple-railing') - rails('railing')).toBe(6);
  const open = defaultBalcony(); open.points.forEach(point => { point.edge = 'open'; });
  expect(Math.max(...balconyFaces(piece.size,open).flat().map(v=>v[1]))).toBe(.04);
});


test('the deck reaches the full wall footprint even after opening the inner edge', () => {
  const balcony = defaultBalcony();
  balcony.points[3].edge = 'wall';
  const deckExtent = () => Math.min(...balconyFaces([2, .08, 1], balcony).flat().filter(v => v[1] <= .04).map(v => v[0]));
  expect(deckExtent()).toBeCloseTo(-1.03, 8);
  balcony.points[3].edge = 'open';
  expect(deckExtent()).toBeCloseTo(-1.03, 8);
});

test('solid corners meet along a shared mitre without a missing outer corner', () => {
  const balcony = defaultBalcony();
  const tops = balconyFaces([2, .08, 1], balcony).filter(face => face.every(v => Math.abs(v[1] - 1.14) < 1e-8));
  const shared = tops[0].filter(a => tops[1].some(b => a.every((v, k) => Math.abs(v - b[k]) < 1e-8)));
  expect(shared).toHaveLength(2);
  expect(shared.some(v => Math.abs(v[0] - 1.03) < 1e-8 && Math.abs(v[2] + .53) < 1e-8)).toBe(true);
});


test('rotated balcony placements open the side facing the hull on either broadside', () => {
  for (const x of [-5, 5]) for (const rotation of [0, 90, 180, 270]) {
    const points = placementBalcony([x, 1, 0], rotation).points;
    const i = points.findIndex(p => p.edge === 'open'), a = points[i], b = points[(i + 1) % 4];
    const localX = (a.x + b.x) / 2, localZ = (a.z + b.z) / 2, angle = rotation * Math.PI / 180;
    expect(Math.sign(localX * Math.cos(angle) + localZ * Math.sin(angle))).toBe(-Math.sign(x));
  }
});
