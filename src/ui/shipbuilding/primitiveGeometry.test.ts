import { beforeAll, expect, test } from 'bun:test';
import * as THREE from 'three';
import init, { compile_construction } from '../../generated/naval-wasm/naval_wasm';
import catalogJson from '../../../public/models/components/catalog.json';
import type { ConstructionCatalog, ConstructionPrimitive, ConstructionResult } from '../../ships/blueprint';
import { createStarterSource } from '../../ships/constructionStarter';
import { primitiveGeometry, primitiveOutlineGeometry } from './primitiveGeometry';
import { CONSTRUCTION_SHAPES } from '../../ships/constructionShapes';
import { mirroredPrimitive, decodeConstructionSource, copyConstructionSelection } from '../../ships/constructionEditor';
import { HULL_SHAPES } from './builderLayers';
import { defaultBalcony } from '../../ships/constructionBalcony';
import { placementCenter } from './placement';

beforeAll(async () => { await init({ module_or_path: await Bun.file(new URL('../../generated/naval-wasm/naval_wasm_bg.wasm', import.meta.url)).arrayBuffer() }); });

function pointKey(values: readonly number[]) { return JSON.stringify(values.map(value => Math.round(value * 1e5) / 1e5)); }
function onPolygon(point: THREE.Vector3, polygon: readonly number[][]) {
  const a = new THREE.Vector3(...polygon[0]);
  for (let i = 1; i < polygon.length - 1; i++) {
    const triangle = new THREE.Triangle(a, new THREE.Vector3(...polygon[i]), new THREE.Vector3(...polygon[i + 1]));
    if (triangle.closestPointToPoint(point,new THREE.Vector3()).distanceTo(point)<2e-5) return true;
  }
  return false;
}

test.each(Object.keys(CONSTRUCTION_SHAPES) as ConstructionPrimitive['kind'][])('%s draft and cursor match the native exterior at every quarter turn', kind => {
  const catalog = catalogJson as ConstructionCatalog;
  for (const rotationDeg of [0, 90, 180, 270]) {
    const source = createStarterSource(catalog, 'blank');
    const piece: ConstructionPrimitive = { id: 'shape', kind, size: [8, 6, 14], position: [7, -3, 11], rotationDeg };
    source.construction.primitives = [piece];
    const native = JSON.parse(compile_construction(JSON.stringify(source), JSON.stringify(catalog))) as ConstructionResult;
    expect(native.definition, `${kind}: ${JSON.stringify(native.diagnostics)}`).toBeDefined();
    const geometry = primitiveGeometry(kind, piece.size);
    try {
      geometry.rotateY(rotationDeg * Math.PI / 180).translate(...piece.position);
      const positions = geometry.getAttribute('position');
      const vertices = Array.from({ length: positions.count }, (_, i) => pointKey([positions.getX(i), positions.getY(i), positions.getZ(i)]));
      // Native clipping may subdivide a polygon; every display vertex still
      // belongs to its boundary, and no new visible face fills an opening.
      for (const vertex of new Set(vertices)) expect(native.surfaces.some(surface => onPolygon(new THREE.Vector3(...JSON.parse(vertex)),surface.vertices)), `${kind} ${rotationDeg}: ${vertex}`).toBe(true);
      // Every rendered triangle lies on a native exterior plane, rather than
      // merely sharing the same bounding box with the intended shape.
      for (let i = 0; i < positions.count; i += 3) {
        const triangle = [0, 1, 2].map(offset => new THREE.Vector3().fromBufferAttribute(positions, i + offset));
        expect(native.surfaces.some(surface => {
          const normal = new THREE.Vector3(...surface.normal), origin = new THREE.Vector3(...surface.vertices[0]);
          return triangle.every(vertex => Math.abs(normal.dot(vertex.clone().sub(origin))) < 1e-5);
        })).toBe(true);
        const center = triangle.reduce((sum,v)=>sum.add(v),new THREE.Vector3()).divideScalar(3);
        expect(native.surfaces.some(surface => onPolygon(center,surface.vertices)),`${kind} triangle covers native void`).toBe(true);
      }
    } finally { geometry.dispose(); }
  }
});

test('asymmetric curves and panels mirror their full geometry and survive source copy/reload', () => {
  for (const kind of Object.keys(CONSTRUCTION_SHAPES) as ConstructionPrimitive['kind'][]) for (const rotationDeg of [0, 90, 180, 270]) {
    const piece: ConstructionPrimitive = { id: 'shape', kind, size: [8, 6, 14], position: [7, -3, 11], rotationDeg };
    const twin = mirroredPrimitive(piece);
    const points = (p: ConstructionPrimitive, reflect = false) => {
      const geometry = primitiveGeometry(p.kind, p.size).rotateY(p.rotationDeg * Math.PI / 180).translate(...p.position);
      const positions = geometry.getAttribute('position');
      const points = Array.from({ length: positions.count }, (_,i) => [(reflect ? -1 : 1) * positions.getX(i),positions.getY(i),positions.getZ(i)]);
      geometry.dispose(); return points;
    };
    const original = points(piece,true), mirrored = points(twin);
    for (const [a,b] of [[original,mirrored],[mirrored,original]]) {
      const triangles = Array.from({length:b.length/3},(_,i)=>b.slice(i*3,i*3+3));
      for (let i=0;i<a.length;i+=3) {
        const point = new THREE.Vector3(...a[i]);
        expect(triangles.some(t=>onPolygon(point,t)),`${kind} ${rotationDeg} mirror`).toBe(true);
      }
    }
    const source = createStarterSource(catalogJson as ConstructionCatalog, 'blank'); source.construction.primitives = [piece];
    copyConstructionSelection(source,new Set(['shape']),{mirror:true});
    const reloaded = decodeConstructionSource(JSON.parse(JSON.stringify(source)));
    expect(reloaded.construction.primitives[1]).toEqual({...twin,id:reloaded.construction.primitives[1].id});
  }
});

test.each(HULL_SHAPES)('$name has physical deck contact when placed at its default size', shape => {
  const catalog = catalogJson as ConstructionCatalog;
  const source = createStarterSource(catalog, 'blank');
  source.construction.primitives = [{ id: 'deck', kind: 'box', size: shape.kind === 'custom-hull' ? [80, 2, 80] : [30, 2, 30], position: [0, 0, 0], rotationDeg: 0 }];
  const position = placementCenter({ kind: 'hull', shape: shape.kind, size: shape.size, rotationDeg: 0 }, { point: [3, 1, 3], normal: [0, 1, 0] }, 1);
  source.construction.primitives.push({ id: 'added', kind: shape.kind, size: shape.size, position, rotationDeg: 0,
    ...(shape.kind === 'balcony' ? { balcony: defaultBalcony() } : {}),
    ...(shape.kind === 'custom-hull' ? { customHull: createStarterSource(catalog, 'patrol-hull').construction.primitives[0].customHull } : {}) });
  const result = JSON.parse(compile_construction(JSON.stringify(source), JSON.stringify(catalog))) as ConstructionResult;
  expect(result.definition, JSON.stringify(result.diagnostics)).toBeDefined();
});

test('a sphere seats into a side face instead of making unsupported point contact', () => {
  const source = createStarterSource(catalogJson as ConstructionCatalog, 'blank');
  source.construction.primitives[0].size = [8, 8, 8];
  const size: [number,number,number] = [4,4,4];
  const position = placementCenter({kind:'hull',shape:'sphere',size,rotationDeg:0},{point:[4,0,0],normal:[1,0,0]},1);
  source.construction.primitives.push({id:'sphere',kind:'sphere',position,size,rotationDeg:0});
  const result = JSON.parse(compile_construction(JSON.stringify(source),JSON.stringify(catalogJson))) as ConstructionResult;
  expect(result.definition,JSON.stringify(result.diagnostics)).toBeDefined();
  expect(position[0]).toBeCloseTo(5.95,6);
});

test('warped vertex drafts match native triangular boundaries, split solids compile, and edited ships remain launchable', () => {
  const catalog = catalogJson as ConstructionCatalog;
  const source=createStarterSource(catalog,'blank');
  source.construction.primitives=[{id:'shape',kind:'vertex',size:[8,6,14],position:[7,-3,11],rotationDeg:90,
    vertices:[[-.5,-.5,-.5],[.5,-.5,-.5],[.3,.5,-.5],[-.5,.5,-.5],[-.5,-.5,.5],[.5,-.5,.5],[.5,.5,.5],[-.5,.5,.5]]}];
  const p=source.construction.primitives[0];
  const native=JSON.parse(compile_construction(JSON.stringify(source),JSON.stringify(catalog))) as ConstructionResult;
  expect(native.diagnostics.filter(d=>d.severity==='error')).toEqual([]);expect(native.definition).toBeDefined();
  const g=primitiveGeometry('vertex',p.size,p.vertices).rotateY(Math.PI/2).translate(...p.position), positions=g.getAttribute('position');
  let area=0;
  for(let i=0;i<positions.count;i+=3){
    const triangle=[0,1,2].map(k=>new THREE.Vector3().fromBufferAttribute(positions,i+k));
    area+=new THREE.Triangle(...triangle as [THREE.Vector3,THREE.Vector3,THREE.Vector3]).getArea();
    expect(native.surfaces.some(s=>triangle.every(p=>Math.abs(new THREE.Vector3(...s.normal).dot(p.clone().sub(new THREE.Vector3(...s.vertices[0]))))<1e-5))).toBe(true);
  }
  expect(area).toBeCloseTo(native.surfaces.reduce((sum,s)=>sum+s.areaM2,0),3);
  g.dispose();
  const {splitVertexPrimitive}=require('../../ships/constructionVertex') as typeof import('../../ships/constructionVertex');
  splitVertexPrimitive(source,'shape',2,4);
  const split=JSON.parse(compile_construction(JSON.stringify(source),JSON.stringify(catalog))) as ConstructionResult;
  expect(split.diagnostics.filter(d=>d.severity==='error')).toEqual([]);expect(split.definition).toBeDefined();
  expect(split.loading!.envelopeVolumeM3).toBeCloseTo(native.loading!.envelopeVolumeM3,5);
});


test.each(['patrol-hull', 'destroyer-hull', 'battleship-hull', 'barge-hull'] as const)('%s display and section outlines match the native hull after placement', preset => {
  const catalog = catalogJson as ConstructionCatalog, source = createStarterSource(catalog, preset);
  const piece = source.construction.primitives[0]; piece.position = [7, -3, 11]; piece.rotationDeg = 90;
  const result = JSON.parse(compile_construction(JSON.stringify(source), JSON.stringify(catalog))) as ConstructionResult;
  expect(result.definition, JSON.stringify(result.diagnostics)).toBeDefined();
  const geometry = primitiveGeometry(piece.kind, piece.size, piece.vertices, piece.customHull);
  const outline = primitiveOutlineGeometry(piece);
  try {
    for (const display of [geometry, outline]) {
      display.rotateY(Math.PI / 2).translate(...piece.position);
      const positions = display.getAttribute('position'), stride = display === geometry ? 3 : 2;
      // Sampling inside each rendered triangle/line also catches incorrect
      // diagonal choices on non-planar panels, not merely matching endpoints.
      for (let i = 0; i < positions.count; i += stride) {
        const middle = new THREE.Vector3();
        for (let j = 0; j < stride; j++) middle.add(new THREE.Vector3().fromBufferAttribute(positions, i + j));
        middle.divideScalar(stride);
        expect(result.surfaces.some(surface => onPolygon(middle, surface.vertices)), `${preset}: ${middle.toArray()}`).toBe(true);
      }
    }
  } finally { geometry.dispose(); outline.dispose(); }
});
