import {beforeAll,expect,test} from 'bun:test';
import init,{compile_construction} from '../generated/naval-wasm/naval_wasm';
import catalog from '../../public/models/components/catalog.json';
import type {ConstructionCatalog,ConstructionPrimitive,ConstructionResult} from './blueprint';
import {createStarterSource} from './constructionStarter';
import {decodeConstructionSource,mirroredPrimitive} from './constructionEditor';
import {editableMesh,EDITABLE_SHAPES,editPrismOutline,insertMeshRing,removeMeshRing,scaleMeshRing,meshFaces} from './constructionMesh';
import {freeformEdit,selectionCorners} from './constructionVertex';
const source=(p:ConstructionPrimitive)=>{const s=createStarterSource(catalog as ConstructionCatalog,'blank');s.construction.primitives=[p];return s;};
const seed=(kind:ConstructionPrimitive['kind']):ConstructionPrimitive=>({id:'shape',kind,size:[4,4,4],position:[0,0,0],rotationDeg:0});
beforeAll(async()=>{await init({module_or_path:await Bun.file(new URL('../generated/naval-wasm/naval_wasm_bg.wasm',import.meta.url)).arrayBuffer()});});
function compile(p:ConstructionPrimitive){const result=JSON.parse(compile_construction(JSON.stringify(source(p)),JSON.stringify(catalog))) as ConstructionResult;expect(result.diagnostics.filter(d=>d.severity==='error')).toEqual([]);expect(result.definition).toBeDefined();return result;}
for(const kind of EDITABLE_SHAPES)test(`${kind}: conversion, display volume, mirror and save retain the native solid`,()=>{
  const original=compile(seed(kind)),p=editableMesh(seed(kind)),result=compile(p);
  expect(result.loading!.envelopeVolumeM3).toBeCloseTo(original.loading!.envelopeVolumeM3,6);
  const volume=meshFaces(p.mesh!,p.size).reduce((sum,{points:[a,b,c]})=>sum+(a[0]*(b[1]*c[2]-b[2]*c[1])+a[1]*(b[2]*c[0]-b[0]*c[2])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6,0);
  expect(volume).toBeCloseTo(result.loading!.envelopeVolumeM3,6);
  expect(mirroredPrimitive(mirroredPrimitive(p))).toEqual(p);
  expect(compile(mirroredPrimitive(p)).loading!.envelopeVolumeM3).toBeCloseTo(volume,6);
  const saved=source(p);expect(decodeConstructionSource(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
});
for(const kind of ['cylinder','half-cylinder','quarter-cylinder','cone','hemisphere','half-hemisphere','quarter-hemisphere'] as const)test(`${kind}: rings insert without changing volume and remain editable`,()=>{
  const p=editableMesh(seed(kind)),before=compile(p),added=insertMeshRing(p,0);
  expect(added.mesh!.rings.length).toBe(p.mesh!.rings.length+1);
  expect(compile(added).loading!.envelopeVolumeM3).toBeCloseTo(before.loading!.envelopeVolumeM3,6);
  const removed=removeMeshRing(added,1);
  expect(compile(removed).loading!.envelopeVolumeM3).toBeCloseTo(before.loading!.envelopeVolumeM3,6);
  const resized=scaleMeshRing(added,1,0,.9);compile(resized);
  const moved=freeformEdit(source(p),p.id,{mode:'ring',index:0},[.05,0,0],[false,false,false],false)[0];
  expect(moved.mesh).toBeDefined();expect(selectionCorners({mode:'ring',index:0},p).length).toBeGreaterThan(1);compile(moved);
},30000);
test('prism outline addition, removal, taper and offset compile',()=>{
  const p=editableMesh(seed('prism')),before=compile(p),added=editPrismOutline(p,0,false);
  expect(added.mesh!.rings[0]).toHaveLength(9);expect(compile(added).loading!.envelopeVolumeM3).toBeCloseTo(before.loading!.envelopeVolumeM3,6);
  const removed=editPrismOutline(added,1,true);expect(compile(removed).loading!.envelopeVolumeM3).toBeCloseTo(before.loading!.envelopeVolumeM3,6);
  const tapered=scaleMeshRing(removed,1,0,.6),moved=freeformEdit(source(tapered),p.id,{mode:'ring',index:1},[.2,0,0],[false,false,false],false)[0];compile(moved);
});
test('malformed and open topology cannot launch',()=>{
  const p=editableMesh(seed('cylinder'));p.mesh!.faces.pop();
  const result=JSON.parse(compile_construction(JSON.stringify(source(p)),JSON.stringify(catalog))) as ConstructionResult;
  expect(result.definition).toBeUndefined();expect(result.diagnostics.some(d=>d.severity==='error')).toBe(true);
  p.mesh!.faces[0].corners[0]=999;expect(()=>decodeConstructionSource(source(p))).toThrow();
});

test('snapping follows a wedge with six corners and a dome with many rings',async()=>{
  const {primitiveSnapFeatures}=await import('../ui/shipbuilding/snapping');
  for(const kind of ['wedge','hemisphere'] as const){
    const p=editableMesh(seed(kind)),features=primitiveSnapFeatures(p);
    expect(features.length).toBeGreaterThan(1);
    expect(features.every(f=>f.point.every(Number.isFinite))).toBe(true);
    for(const f of features.filter(f=>f.kind==='corner'))expect(p.mesh!.vertices.some(v=>v.every((n,k)=>Math.abs(n*p.size[k]-f.point[k])<1e-7))).toBe(true);
  }
});
test('agent vertex commands convert presets and accept actual ring and vertex counts',async()=>{
  const {applyConstructionBatch}=await import('./constructionCommands');
  const s=source(seed('cylinder'));
  const edited=applyConstructionBatch(s,{version:1,expectedRevision:s.revision,label:'Shape cylinder',commands:[{op:'vertices',id:'shape',selection:{mode:'ring',index:1},delta:[0,.2,0]}]});
  expect(edited.construction.primitives[0].mesh).toBeDefined();compile(edited.construction.primitives[0]);
});
