import { expect, test } from 'bun:test';
import { balconyFaces, balconyProblem, balconyTriangles, defaultBalcony } from './constructionBalcony';
import { mirroredPrimitive, decodeConstructionSource } from './constructionEditor';
import { createStarterSource } from './constructionStarter';
import { applyConstructionBatch } from './constructionCommands';
import type { ConstructionCatalog, ConstructionPrimitive } from './blueprint';
import catalog from '../../public/models/components/catalog.json';
import { HULL_SHAPES } from '../ui/shipbuilding/builderLayers';

test('Hull starts with freeform and a 2 by 1 metre walled balcony', () => {
  expect(HULL_SHAPES.slice(0, 2).map(shape => shape.id)).toEqual(['vertex', 'balcony']);
  expect(HULL_SHAPES[1].size).toEqual([2, .08, 1]);
  expect(defaultBalcony().points.map(point => point.edge)).toEqual(['wall', 'wall', 'wall', 'wall']);
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
  piece.balcony!.points[0].edge='railing';piece.balcony!.points[1].edge='wall';
  const before=structuredClone(piece);
  const changed=applyConstructionBatch(source,{version:1,expectedRevision:source.revision,label:'Add balcony',commands:[{op:'primitive',value:piece}]});
  expect(decodeConstructionSource(JSON.parse(JSON.stringify(changed))).construction.primitives.at(-1)).toEqual(piece);
  expect(mirroredPrimitive(mirroredPrimitive(piece))).toEqual(before);
  expect(piece).toEqual(before);
  expect(balconyProblem(piece.balcony!)).toBeUndefined();
  expect(balconyFaces(piece.size,piece.balcony).flat().some(v=>v[1]>.08)).toBe(true);
  const open = defaultBalcony(); open.points.forEach(point => { point.edge = 'open'; });
  expect(Math.max(...balconyFaces(piece.size,open).flat().map(v=>v[1]))).toBe(.04);
});
