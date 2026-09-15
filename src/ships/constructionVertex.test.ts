import { expect, test } from 'bun:test';
import type { ConstructionSource, Vec3 } from './blueprint';
import { cornerVertices, editableCorners, replaceVertexPrimitives, sampleVertex, splitVertexPrimitive, vertexEdit, worldVertex } from './constructionVertex';
import { decodeConstructionSource, mirroredPrimitive } from './constructionEditor';
import { createConstructionHistory, editConstruction, undoConstruction } from './constructionHistory';
const source=():ConstructionSource=>({schemaVersion:1,id:'vertex-test',revision:'r1',name:'Vertex test',coordinates:'meters-y-up-bow-negative-z',construction:{version:1,catalogRevision:'test',defaultThicknessMm:10,primitives:[{id:'a',kind:'box',size:[4,4,4],position:[0,0,0],rotationDeg:0},{id:'b',kind:'box',size:[4,4,4],position:[4,0,0],rotationDeg:90}],surfaces:[],equipment:[{id:'fixed',partId:'deck-fitting',position:[0,2,0],bearingDeg:0}],boundaries:[],loads:[]}});
test('mirror combinations expose 4/2/1 controls; XYZ scales a square block and off edits one corner',()=>{
 expect(editableCorners(true,[true,false,false])).toHaveLength(4);
 expect(editableCorners(true,[true,true,false])).toHaveLength(2);
 expect(editableCorners(true,[true,true,true])).toEqual([2]);
 expect(editableCorners(false,[true,true,true])).toHaveLength(8);
 const s=source(), scaled=vertexEdit(s,'a',2,[.2,.4,-.6],true,[true,true,true],false)[0];
 cornerVertices(scaled).forEach((v,i)=>v.forEach((n,k)=>expect(Math.abs(n*scaled.size[k])).toBeCloseTo([2.2,2.4,2.6][k])));
 const single=vertexEdit(s,'a',2,[.2,0,0],false,[true,true,true],false)[0];
 expect(cornerVertices(single).filter((v,i)=>JSON.stringify(v)!==JSON.stringify(cornerVertices(s.construction.primitives[0])[i]))).toHaveLength(1);
});
test('snap is opt-in, maps rotated neighbors, keeps fittings fixed, and one undo restores both blocks',()=>{
 const s=source(),before=structuredClone(s);
 const independent=vertexEdit(s,'a',2,[.2,.2,0],true,[true,false,false],false);
 expect(independent.map(p=>p.id)).toEqual(['a']);
 const edits=vertexEdit(s,'a',2,[.2,.2,0],true,[true,false,false],true);
 expect(edits.map(p=>p.id)).toEqual(['a','b']);
 const history=editConstruction(createConstructionHistory(s),'Shape hull',draft=>replaceVertexPrimitives(draft,edits));
 expect(history.past).toHaveLength(1);expect(history.source.construction.equipment).toEqual(s.construction.equipment);
 const a=edits[0],b=edits[1],anchor=worldVertex(a,cornerVertices(a)[2]);
 expect(cornerVertices(b).some(v=>Math.hypot(...worldVertex(b,v).map((n,k)=>n-anchor[k]))<1e-8)).toBe(true);
 expect(undoConstruction(history).source).toEqual(before);expect(s).toEqual(before);
});
test('split interpolates rotated warped solids, shares exact seams, inherits only exterior assignments and round-trips source',()=>{
 const s=source();s.construction.primitives=s.construction.primitives.slice(0,1);
 const p=s.construction.primitives[0];p.kind='vertex';p.rotationDeg=90;p.vertices=cornerVertices(p);p.vertices[2][0]+=.2;p.vertices[6][1]-=.1;
 s.construction.surfaces=[{primitiveId:'a',face:'bow',thicknessMm:100,material:'armor-steel',paint:'red-oxide',open:true},{primitiveId:'a',face:'top',thicknessMm:25,material:'steel',paint:'deck-gray'}];
 const original=structuredClone(p),ids=splitVertexPrimitive(s,'a',2,4);
 expect(ids).toHaveLength(4);expect(new Set(ids).size).toBe(4);
 for(let i=0;i<4;i++)for(const u of [[0,0,0],[1,1,1],[.3,.6,.7]] as Vec3[]) {
   const expected=worldVertex(original,sampleVertex(cornerVertices(original),[u[0],u[1],(i+u[2])/4]));
   worldVertex(s.construction.primitives[i],sampleVertex(cornerVertices(s.construction.primitives[i]),u)).forEach((n,k)=>expect(n).toBeCloseTo(expected[k],8));
 }
 expect(s.construction.surfaces.filter(s=>s.face==='bow').map(s=>s.primitiveId)).toEqual([ids[0]]);
 expect(s.construction.surfaces.filter(s=>s.face==='top')).toHaveLength(4);
 expect(decodeConstructionSource(JSON.parse(JSON.stringify(s)))).toEqual(s);
 const bad=structuredClone(s);bad.construction.primitives[0].vertices!.pop();expect(()=>decodeConstructionSource(bad)).toThrow('eight');
});
test('whole-block mirror preserves asymmetric corners and winding at every quarter turn',()=>{
 for(const angle of [0,90,180,270]){
 const p=source().construction.primitives[0];p.kind='vertex';p.vertices=cornerVertices(p);p.vertices[2]=[.7,.4,-.3];p.rotationDeg=angle;p.position=[4,1,-2];
 const reflected=mirroredPrimitive(p),world=cornerVertices(p).map(v=>worldVertex(p,v));
 for(const v of cornerVertices(reflected)) {const point=worldVertex(reflected,v);expect(world.some(w=>Math.hypot(point[0]+w[0],point[1]-w[1],point[2]-w[2])<1e-8)).toBe(true);}
 expect(mirroredPrimitive(reflected)).toEqual(p);
 }
});
