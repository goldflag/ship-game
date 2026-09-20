import { orientVector, unorientVector } from './constructionOrientation';
import { EDITABLE_SHAPES, editableMesh, meshEdges } from './constructionMesh';
import type { ConstructionPrimitive, ConstructionSource, Vec3 } from './blueprint';
import { newConstructionId } from './constructionIds';
import { customHullPoints } from './customHullModel';

export const VERTEX_UNITS = [.05, .1, .2, .5, 1, 2] as const;
export const VERTEX_SNAP_DISTANCE = .025;
export const CORNER_SIGNS: Vec3[] = [[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]];
export const VERTEX_FACES = [
  { name: 'bow', corners: [0,3,2,1] }, { name: 'stern', corners: [4,5,6,7] },
  { name: 'port', corners: [0,4,7,3] }, { name: 'starboard', corners: [1,2,6,5] },
  { name: 'bottom', corners: [0,1,5,4] }, { name: 'top', corners: [3,7,6,2] },
] as const;
export type MirrorAxes = [boolean, boolean, boolean];
export type HullSelectionMode = 'vertex' | 'edge' | 'face' | 'ring';
export interface HullSelection { mode: HullSelectionMode; index: number }
export const VERTEX_EDGES: readonly (readonly [number, number])[] = [
  [0,1], [1,2], [2,3], [3,0], [4,5], [5,6], [6,7], [7,4],
  [0,4], [1,5], [2,6], [3,7],
];
export function topology(p?: ConstructionPrimitive): { faces: {name:string;corners:readonly number[]}[]; edges: readonly (readonly [number,number])[]; vertices: Vec3[]; rings: number[][] } {
  return p?.mesh ? {faces:p.mesh.faces,edges:meshEdges(p.mesh),vertices:p.mesh.vertices,rings:p.mesh.rings} : {faces:[...VERTEX_FACES],edges:VERTEX_EDGES,vertices:CORNER_SIGNS,rings:[]};
}
export function selectionCorners(selection: HullSelection, p?: ConstructionPrimitive): readonly number[] {
  const t=topology(p);
  if(selection.mode==='ring')return t.rings[selection.index]??[];
  if(selection.mode==='edge')return t.edges[selection.index]??[];
  if(selection.mode==='face')return t.faces[selection.index]?.corners??[];
  return t.vertices[selection.index]?[selection.index]:[];
}
export function selectionLabel(selection: HullSelection,p?:ConstructionPrimitive): string {
  if(selection.mode==='face'){
    const name=topology(p).faces[selection.index]?.name??'Unknown';
    return `${name[0].toUpperCase()}${name.slice(1)} face${p?.mesh ? ` ${selection.index+1}`:''}`;
  }
  return `${selection.mode[0].toUpperCase()}${selection.mode.slice(1)} ${selection.index+1}`;
}
export function selectionCenter(p: ConstructionPrimitive, selection: HullSelection): Vec3 {
  const corners=selectionCorners(selection,p),points=cornerVertices(p);
  return [0,1,2].map(k=>corners.reduce((sum,i)=>sum+points[i][k]*p.size[k],0)/(corners.length||1)) as Vec3;
}
const reference=(p?:ConstructionPrimitive)=>p?.mesh?.reference??CORNER_SIGNS;
export function selectionLocks(selection: HullSelection, axes: MirrorAxes,p?:ConstructionPrimitive): MirrorAxes {
  const corners=selectionCorners(selection,p),ref=reference(p);
  return axes.map((on,k)=>on && (corners.some(i=>ref[i][k]<-1e-8)&&corners.some(i=>ref[i][k]>1e-8)||corners.length>0&&corners.every(i=>Math.abs(ref[i][k])<1e-8))) as MirrorAxes;
}
function mirrorTransforms(axes: MirrorAxes): Vec3[] {
  return axes.reduce<Vec3[]>((transforms,on,k)=>on?transforms.flatMap(t=>[t,t.map((n,j)=>j===k?-n:n) as Vec3]):transforms,[[1,1,1]]);
}
function reflectedCorner(i:number,transform:Vec3,p?:ConstructionPrimitive):number {
  const ref=reference(p);return ref.findIndex(v=>v.every((n,k)=>Math.abs(n-ref[i][k]*transform[k])<1e-7));
}
export function affectedCorners(selection:HullSelection,axes:MirrorAxes,p?:ConstructionPrimitive):number[]{
  return [...new Set(mirrorTransforms(axes).flatMap(t=>selectionCorners(selection,p).map(i=>reflectedCorner(i,t,p))))].filter(i=>i>=0);
}
export const cornerVertices = (p: ConstructionPrimitive): Vec3[] => p.mesh ? p.mesh.vertices.map(v=>[...v]) : p.kind === 'custom-hull' && p.customHull ? customHullPoints(p).map(v => v.map((n, k) => n / p.size[k]) as Vec3) : p.vertices?.map(v => [...v]) ?? CORNER_SIGNS.map(v => v.map(n => n / 2) as Vec3);
export const canEditVertices = (p: ConstructionPrimitive) => p.kind === 'box' || p.kind === 'vertex' || EDITABLE_SHAPES.has(p.kind);
export function rotateVertex(v: Vec3, degrees: number): Vec3 {
  const a = degrees * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return [c*v[0]+s*v[2], v[1], -s*v[0]+c*v[2]];
}
export function worldVertex(p: ConstructionPrimitive, v: Vec3): Vec3 {
  return orientVector(p, v.map((n,k) => n*p.size[k]) as Vec3).map((n,k) => n+p.position[k]) as Vec3;
}
export function sampleVertex(vertices: Vec3[], uvw: Vec3): Vec3 {
  const out: Vec3 = [0,0,0];
  CORNER_SIGNS.forEach((sign,i) => {
    const weight = sign.reduce((w,s,k) => w * (s > 0 ? uvw[k] : 1-uvw[k]), 1);
    for (let k=0;k<3;k++) out[k] += vertices[i][k]*weight;
  });
  return out;
}
/** Resolve the entire selection against one source snapshot, then propagate nearby
 * corners. No corner accumulates duplicate motion and neighbors never recurse. */
export function freeformEdit(source: ConstructionSource, id: string, selection: HullSelection, delta: Vec3, axes: MirrorAxes, snap: boolean): ConstructionPrimitive[] {
  const original = source.construction.primitives.find(p => p.id === id);
  const seed = original && editableMesh(original);
  if (!seed || !canEditVertices(seed)) return [];
  const corners = selectionCorners(selection,seed), locks = selectionLocks(selection, axes,seed);
  const movement = delta.map((n,k) => locks[k] ? 0 : n) as Vec3;
  if (!corners.length || movement.every(n => Math.abs(n) < 1e-9)) return [];
  const points = cornerVertices(seed), edits = new Map<string, Map<number, Vec3>>();
  const put = (id: string, i: number, d: Vec3) => {
    if(i<0)return;
    if (!edits.has(id)) edits.set(id, new Map());
    if (!edits.get(id)!.has(i)) edits.get(id)!.set(i,d);
  };
  for (const transform of mirrorTransforms(axes)) {
    const local = movement.map((d,k) => d * transform[k]) as Vec3;
    for (const corner of corners) put(id, reflectedCorner(corner, transform,seed), local);
  }
  for (const [i,local] of edits.get(id)!) {
    if (!snap) continue;
    const anchor = worldVertex(seed,points[i]), worldDelta = orientVector(seed,local);
    for (const other of source.construction.primitives) if (other.id !== id && (other.kind==='box'||other.kind==='vertex')) {
      cornerVertices(other).forEach((v,j) => {
        if (Math.hypot(...worldVertex(other,v).map((n,k) => n-anchor[k])) <= VERTEX_SNAP_DISTANCE) put(other.id,j,unorientVector(other,worldDelta));
      });
    }
  }
  return source.construction.primitives.filter(p => edits.has(p.id)).map(original => {
    const p=editableMesh(original);
    const vertices = cornerVertices(p);
    for (const [i,d] of edits.get(p.id)!) vertices[i] = vertices[i].map((v,k) => v+d[k]/p.size[k]) as Vec3;
    return p.mesh ? {...structuredClone(p),mesh:{...structuredClone(p.mesh),vertices}} : {...structuredClone(p),kind:'vertex',vertices};
  });
}
export function replaceVertexPrimitives(source: ConstructionSource, replacements: ConstructionPrimitive[]) {
  const map = new Map(replacements.map(p => [p.id,p]));
  source.construction.primitives = source.construction.primitives.map(p => structuredClone(map.get(p.id) ?? p));
}
export function splitVertexPrimitive(source: ConstructionSource, id: string, axis: number, count: number): string[] {
  const p = source.construction.primitives.find(p => p.id === id);
  if (!p || !canEditVertices(p)) throw new Error('Select one cube or freeform hull to split.');
  if (p.mesh) throw new Error('Use the outline or ring controls for this shape.');
  if (p.shaping) throw new Error('Remove edge treatment before splitting this block.');
  if (![0,1,2].includes(axis) || !Number.isInteger(count) || count < 2 || count > 16) throw new Error('Split count must be 2–16.');
  if (source.construction.primitives.length+count-1 > 512) throw new Error('Splitting would exceed the 512 hull piece limit.');
  const vertices = cornerVertices(p), negative = ['port','bottom','bow'][axis], positive = ['starboard','top','stern'][axis];
  const children = Array.from({length:count},(_,i): ConstructionPrimitive => {
    const start=i/count,end=(i+1)/count, center: Vec3=[.5,.5,.5]; center[axis]=(start+end)/2;
    const localCenter=sampleVertex(vertices,center), size: Vec3=[...p.size]; size[axis]/=count;
    return {...structuredClone(p),id:newConstructionId('hull'),kind:'vertex',position:worldVertex(p,localCenter),size,
      vertices:CORNER_SIGNS.map(sign => {
        const uvw=sign.map(s => (s+1)/2) as Vec3; uvw[axis]=sign[axis]<0?start:end;
        return sampleVertex(vertices,uvw).map((n,k)=>(n-localCenter[k])*p.size[k]/size[k]) as Vec3;
      })};
  });
  const assignments=source.construction.surfaces.filter(s=>s.primitiveId===id);
  source.construction.surfaces=source.construction.surfaces.filter(s=>s.primitiveId!==id);
  children.forEach((child,i)=> assignments.forEach(s=> {
    if ((s.face===negative && i!==0) || (s.face===positive && i!==count-1)) return;
    source.construction.surfaces.push({...s,primitiveId:child.id});
  }));
  source.construction.primitives.splice(source.construction.primitives.indexOf(p),1,...children);
  return children.map(c=>c.id);
}
