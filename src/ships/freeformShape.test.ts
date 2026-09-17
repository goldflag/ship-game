import { beforeAll, expect, test } from 'bun:test';
import * as THREE from 'three';
import init, { compile_construction } from '../generated/naval-wasm/naval_wasm';
import catalogJson from '../../public/models/components/catalog.json';
import type { ConstructionCatalog, ConstructionPrimitive, ConstructionResult } from './blueprint';
import { emptyShaping, shapedFaces, mirroredIndices, envelopeVertices } from './freeformShape';
import { mirroredPrimitive, decodeConstructionSource } from './constructionEditor';
import { cornerVertices, freeformEdit } from './constructionVertex';
import { createStarterSource } from './constructionStarter';
import { createConstructionHistory, editConstruction, undoConstruction, redoConstruction } from './constructionHistory';
const cube=():ConstructionPrimitive=>({id:'shape',kind:'vertex',size:[4,4,4],position:[0,0,0],rotationDeg:0,shaping:emptyShaping()});
beforeAll(async()=>{await init({module_or_path:await Bun.file(new URL('../generated/naval-wasm/naval_wasm_bg.wasm',import.meta.url)).arrayBuffer()});});
function compile(p:ConstructionPrimitive) {
  const source=createStarterSource(catalogJson as ConstructionCatalog,'blank');source.construction.primitives=[p];
  const result=JSON.parse(compile_construction(JSON.stringify(source),JSON.stringify(catalogJson))) as ConstructionResult;
  expect(result.diagnostics.filter(d=>d.severity==='error')).toEqual([]);expect(result.definition).toBeDefined();return result;
}
for(const name of ['round','chamfer','selected-edges','warped-round','warped-chamfer','zero-radius'] as const)test(`${name}: preview area and every triangle match native physics`,()=>{
  const p=cube(),s=p.shaping!;
  s.edges=name==='selected-edges'?[8,9]:Array.from({length:12},(_,i)=>i);
  s.radius=name==='zero-radius'?0:.4;s.style=name.includes('chamfer')?'chamfer':'round';
  if(name.startsWith('warped')) {
    p.size=[8,6,12];p.vertices=cornerVertices(p);p.vertices[0][0]=-.35;
  }
  const result=compile(p),faces=shapedFaces(p);let area=0,volume=0;
  for(const f of faces){const [a,b,c]=f.points.map(v=>new THREE.Vector3(...v));area+=new THREE.Triangle(a,b,c).getArea();volume+=a.dot(b.clone().cross(c))/6;
    const center=a.clone().add(b).add(c).multiplyScalar(1/3);
    expect(result.surfaces.some(s=>{
      for(let i=1;i<s.vertices.length-1;i++){const tri=new THREE.Triangle(...[s.vertices[0],s.vertices[i],s.vertices[i+1]].map(v=>new THREE.Vector3(...v)) as [THREE.Vector3,THREE.Vector3,THREE.Vector3]);if(tri.closestPointToPoint(center,new THREE.Vector3()).distanceTo(center)<1e-5)return true;}return false;
    })).toBe(true);
  }
  expect(area).toBeCloseTo(result.surfaces.reduce((sum,s)=>sum+s.areaM2,0),4);
  expect(volume).toBeCloseTo(result.loading!.envelopeVolumeM3,4);
},30000);

test('mirror copy reflects edge treatments exactly twice',()=>{
  const p=cube();p.shaping!.edges=[1,9];p.vertices=cornerVertices(p);
  const mirrored=mirroredPrimitive(p);expect(mirrored.shaping!.edges).toEqual([3,8]);
  expect(mirroredPrimitive(mirrored)).toEqual(p);
  expect(mirroredIndices('edge',[8],[true,false,false])).toEqual([8,9]);
});
test('corner movement, undo/redo, source decode and bounds retain one rounded block',()=>{
  const p=cube();p.shaping!.edges=[8,9];p.shaping!.radius=.4;
  const source=createStarterSource(catalogJson as ConstructionCatalog,'blank');source.construction.primitives=[p];
  const replacements=freeformEdit(source,p.id,{mode:'vertex',index:0},[.1,0,0],[false,false,false],false);
  const h=editConstruction(createConstructionHistory(source),'Move corner',draft=>draft.construction.primitives=replacements);
  expect(h.source.construction.primitives).toHaveLength(1);expect(replacements[0].id).toBe(p.id);
  expect(replacements[0].shaping).toEqual(p.shaping);
  expect(redoConstruction(undoConstruction(h)).source).toEqual(h.source);
  expect(decodeConstructionSource(JSON.parse(JSON.stringify(h.source)))).toEqual(h.source);
  expect(Math.max(...envelopeVertices(p).map(v=>v[0]))).toBe(.5);
  compile(replacements[0]);
});
