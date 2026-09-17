import type { ConstructionFreeformShape, ConstructionPrimitive, Vec3 } from './blueprint';
import { CORNER_SIGNS, VERTEX_EDGES, VERTEX_FACES, cornerVertices, sampleVertex, type MirrorAxes } from './constructionVertex';

export const emptyShaping = (): ConstructionFreeformShape => ({ version: 1, edges: [], radius: 0, style: 'round' });
export const shapeOf = (p: ConstructionPrimitive) => structuredClone(p.shaping ?? emptyShaping());
export const radiusLimit = (p: ConstructionPrimitive) => Math.min(...p.size) * .45;
export const add = (a: Vec3,b: Vec3): Vec3 => a.map((n,k)=>n+b[k]) as Vec3;
export const sub = (a: Vec3,b: Vec3): Vec3 => a.map((n,k)=>n-b[k]) as Vec3;
export const mul = (a: Vec3,s: number): Vec3 => a.map(n=>n*s) as Vec3;
export const dot = (a: Vec3,b: Vec3) => a.reduce((s,n,k)=>s+n*b[k],0);
export const cross = (a: Vec3,b: Vec3): Vec3 => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const length = (a: Vec3) => Math.hypot(...a);
export interface ShapeFace { name: string; points: Vec3[] }
function clean(points: Vec3[]): Vec3[] {
  const out=points.filter((p,i)=>length(sub(p,points[(i+points.length-1)%points.length]))>1e-8);
  let i=0;
  while(out.length>=3 && i<out.length) {
    if(length(cross(sub(out[i],out[(i+out.length-1)%out.length]),sub(out[(i+1)%out.length],out[i])))<1e-16) {out.splice(i,1);i=0;} else i++;
  }
  return out;
}
function clip(points: Vec3[],n: Vec3,d: number): Vec3[] {
  const out: Vec3[]=[];
  points.forEach((a,i)=>{const b=points[(i+1)%points.length],da=dot(n,a)-d,db=dot(n,b)-d;
    if(da<=1e-8)out.push(a);
    if((da < -1e-8 && db>1e-8)||(da>1e-8 && db < -1e-8))out.push(add(a,mul(sub(b,a),da/(da-db))));
  });return clean(out);
}
/** Clipping planes are also generated independently in Rust, which owns validity. */
export function shapingPlanes(p: ConstructionPrimitive): {n:Vec3;d:number}[] {
  const s=shapeOf(p),r=Math.min(s.radius,radiusLimit(p)),planes:{n:Vec3;d:number}[]=[];
  if(!r || !s.edges.length)return planes;
  for(const edge of s.edges) {
    const [a,b]=VERTEX_EDGES[edge],axes=[0,1,2].filter(k=>CORNER_SIGNS[a][k]===CORNER_SIGNS[b][k]);
    for(let i=1;i<(s.style==='round'?6:2);i++) {
      const angle=i*Math.PI/(s.style==='round'?12:4),n:Vec3=[0,0,0];
      n[axes[0]]=Math.cos(angle)*CORNER_SIGNS[a][axes[0]];n[axes[1]]=Math.sin(angle)*CORNER_SIGNS[a][axes[1]];
      const d=n.reduce((sum,v,k)=>sum+Math.abs(v)*(p.size[k]/2-r),0)+(s.style==='round'?r:r/Math.sqrt(2));
      planes.push({n,d});
    }
  }
  // Spherical trihedral patches where three treated edges meet. With two edges,
  // their intersecting fillets form a closed shared seam automatically.
  if(s.style==='round')CORNER_SIGNS.forEach((sign,corner)=>{
    if(VERTEX_EDGES.filter(e=>e.includes(corner)).some(e=>!s.edges.includes(VERTEX_EDGES.indexOf(e))))return;
    for(let a=1;a<3;a++)for(let b=1;b<3;b++) {
      const u=a*Math.PI/6,v=b*Math.PI/6,n:Vec3=[Math.cos(u)*Math.cos(v)*sign[0],Math.sin(u)*Math.cos(v)*sign[1],Math.sin(v)*sign[2]];
      planes.push({n,d:n.reduce((sum,x,k)=>sum+Math.abs(x)*(p.size[k]/2-r),0)+r});
    }
  });
  return planes;
}
export function shapeSample(p:ConstructionPrimitive,q:Vec3):Vec3 {
  const uvw=q.map((n,k)=>n/p.size[k]+.5) as Vec3;
  return sampleVertex(cornerVertices(p),uvw).map((n,k)=>n*p.size[k]) as Vec3;
}
export function shapedFaces(p:ConstructionPrimitive):ShapeFace[] {
  let faces:ShapeFace[]=VERTEX_FACES.map(f=>({name:f.name,points:f.corners.map(i=>CORNER_SIGNS[i].map((n,k)=>n*p.size[k]/2) as Vec3)}));
  for(const {n,d} of shapingPlanes(p)) {
    const cap:Vec3[]=[];const next:ShapeFace[]=[];
    for(const f of faces) {const points=clip(f.points,n,d);if(points.length>=3)next.push({...f,points});for(const q of points)if(Math.abs(dot(n,q)-d)<1e-7&&!cap.some(v=>length(sub(v,q))<1e-7))cap.push(q);}
    if(cap.length>=3) {
      const center=mul(cap.reduce(add,[0,0,0]),1/cap.length),u=mul(sub(cap[0],center),1/length(sub(cap[0],center))),v=cross(n,u);
      cap.sort((a,b)=>Math.atan2(dot(sub(a,center),v),dot(sub(a,center),u))-Math.atan2(dot(sub(b,center),v),dot(sub(b,center),u)));
      next.push({name:'slope',points:cap});
    }faces=next;
  }
  return faces.flatMap(f=>{
    const center=mul(f.points.reduce(add,[0,0,0]),1/f.points.length),c=shapeSample(p,center);
    return f.points.map((q,i)=>({name:f.name,points:[shapeSample(p,q),shapeSample(p,f.points[(i+1)%f.points.length]),c]})).filter(f=>length(cross(sub(f.points[1],f.points[0]),sub(f.points[2],f.points[0])))>1e-10);
  });
}
export function mirroredIndices(mode:'edge'|'face',indices:number[],axes:MirrorAxes):number[] {
  const groups=mode==='edge'?VERTEX_EDGES:VERTEX_FACES.map(f=>f.corners),out=new Set(indices);
  for(let k=0;k<3;k++)if(axes[k])for(const i of [...out]) {
    const reflected=groups[i].map(c=>CORNER_SIGNS.findIndex(v=>v.every((n,a)=>n===(a===k?-CORNER_SIGNS[c][a]:CORNER_SIGNS[c][a]))));
    out.add(groups.findIndex(g=>g.length===reflected.length&&g.every(i=>reflected.includes(i))));
  }return [...out].sort((a,b)=>a-b);
}
/** Source bounds follow the treated, deformed surface. */
export function envelopeVertices(p:ConstructionPrimitive):Vec3[] {
  return p.shaping ? shapedFaces(p).flatMap(f=>f.points.map(v=>v.map((n,k)=>n/p.size[k]) as Vec3)) : cornerVertices(p);
}
