import type { ConstructionFreeformMesh, ConstructionFreeformFace, ConstructionPrimitive, Vec3 } from './blueprint';
import { CONSTRUCTION_SHAPES, CONSTRUCTION_SHAPE_NAMES } from './constructionShapes';

export const EDITABLE_SHAPES = new Set<ConstructionPrimitive['kind']>(['prism','wedge','corner','inverse-corner','pyramid','cylinder','half-cylinder','quarter-cylinder','cone','hemisphere','half-hemisphere','quarter-hemisphere','sphere-octant']);
// Editor revisions are immutable. Reuse connectivity while projecting every handle
// each frame; moving a vertex produces a new mesh and naturally retires this entry.
const edgeCache=new WeakMap<ConstructionFreeformMesh,[number,number][]>();
export function meshEdges(mesh: ConstructionFreeformMesh): [number,number][] {
  const cached=edgeCache.get(mesh);if(cached)return cached;
  const edges = new Map<string,[number,number]>();
  for (const f of mesh.faces) f.corners.forEach((a,i) => { const b=f.corners[(i+1)%f.corners.length], key=[a,b].sort((a,b)=>a-b).join(':'); if(!edges.has(key)) edges.set(key,[a,b]); });
  const result=[...edges.values()];edgeCache.set(mesh,result);return result;
}
const sub=(a:Vec3,b:Vec3)=>a.map((n,k)=>n-b[k]) as Vec3;
const cross=(a:Vec3,b:Vec3):Vec3=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
function faceName(points:Vec3[]): ConstructionFreeformFace['name'] {
  const n=cross(sub(points[1],points[0]),sub(points[2],points[0])), length=Math.hypot(...n), axis=n.findIndex(v=>Math.abs(v)/length>1-1e-7);
  return axis<0?'slope':([['port','starboard'],['bottom','top'],['bow','stern']] as const)[axis][n[axis]>0?1:0];
}
/** Conversion preserves the native recipe's actual surface, including partial curves. */
export function editableMesh(p:ConstructionPrimitive): ConstructionPrimitive {
  if(p.mesh || !EDITABLE_SHAPES.has(p.kind)) return structuredClone(p);
  const vertices:Vec3[]=[], index=(v:Vec3)=>{let i=vertices.findIndex(q=>Math.hypot(...sub(v,q))<1e-8);if(i<0){i=vertices.length;vertices.push(v.map(n=>n===0?0:n) as Vec3);}return i;};
  const faces=CONSTRUCTION_SHAPES[p.kind].map((points,i)=>({id:`face-${i}`,name:faceName(points),corners:points.map(index)}));
  // Native exterior patches may meet a longer cap edge at a T junction.
  // Retain each shared point on both faces before allowing vertex movement.
  for(const f of faces)f.corners=f.corners.flatMap((a,i)=>{
    const b=f.corners[(i+1)%f.corners.length],d=sub(vertices[b],vertices[a]),length2=d.reduce((s,n)=>s+n*n,0);
    return vertices.map((v,j)=>({j,t:sub(v,vertices[a]).reduce((s,n,k)=>s+n*d[k],0)/length2}))
      .filter(({j,t})=>t>=-1e-8&&t<1-1e-8&&Math.hypot(...vertices[j].map((n,k)=>n-vertices[a][k]-t*d[k]))<1e-8)
      .sort((a,b)=>a.t-b.t).map(v=>v.j);
  });
  const family=p.kind==='prism'?'prism':['wedge','corner','inverse-corner','pyramid'].includes(p.kind)?'polyhedron':'rings';
  const heights=[...new Set(vertices.map(v=>Math.round(v[1]*1e8)/1e8))].sort((a,b)=>a-b);
  const rings=family==='polyhedron'?[]:heights.map(y=>vertices.map((_,i)=>i).filter(i=>Math.abs(vertices[i][1]-y)<1e-7).sort((a,b)=>Math.atan2(vertices[a][2],vertices[a][0])-Math.atan2(vertices[b][2],vertices[b][0])));
  return {...structuredClone(p),kind:'vertex',mesh:{version:1,label:CONSTRUCTION_SHAPE_NAMES[p.kind].replace(/^Freeform /,''),family,vertices,reference:structuredClone(vertices),faces,rings}};
}
/** Polygon centers give the same bounded face fan used by Rust for warped faces. */
export function meshFaces(mesh:ConstructionFreeformMesh,size:Vec3): {name:string;points:Vec3[]}[] {
  return mesh.faces.flatMap(f=>{
    const q=f.corners.map(i=>mesh.vertices[i].map((n,k)=>n*size[k]) as Vec3),center=q.reduce((a,v)=>a.map((n,k)=>n+v[k]/q.length) as Vec3,[0,0,0] as Vec3);
    return q.map((v,i)=>({name:f.name,points:[v,q[(i+1)%q.length],center]})).filter(f=>Math.hypot(...cross(sub(f.points[1],f.points[0]),sub(f.points[2],f.points[0])))>1e-10);
  });
}
export function scaleMeshRing(p:ConstructionPrimitive,ring:number,axis:0|2,factor:number):ConstructionPrimitive {
  const out=structuredClone(p),m=out.mesh!,indices=m.rings[ring];
  if(!indices?.length || !Number.isFinite(factor)||factor<=0) return out;
  const center=indices.reduce((s,i)=>s+m.vertices[i][axis],0)/indices.length;
  indices.forEach(i=>m.vertices[i][axis]=center+(m.vertices[i][axis]-center)*factor);return out;
}
/** Insert an interpolated cross-section without resampling or losing existing edits. */
export function insertMeshRing(p:ConstructionPrimitive,ring:number):ConstructionPrimitive {
  const out=structuredClone(p),m=out.mesh!;
  if(m.rings.length>=24||ring<0||ring>=m.rings.length-1) return out;
  const y=(m.reference[m.rings[ring][0]][1]+m.reference[m.rings[ring+1][0]][1])/2;
  const intersections=new Map<string,number>(),newRing:number[]=[];
  const at=(a:number,b:number)=>{
    const key=[a,b].sort((a,b)=>a-b).join(':');if(intersections.has(key))return intersections.get(key)!;
    const t=(y-m.reference[a][1])/(m.reference[b][1]-m.reference[a][1]);
    const id=m.vertices.length;
    m.vertices.push(m.vertices[a].map((n,k)=>n+(m.vertices[b][k]-n)*t) as Vec3);
    m.reference.push(m.reference[a].map((n,k)=>n+(m.reference[b][k]-n)*t) as Vec3);
    intersections.set(key,id);newRing.push(id);return id;
  };
  const original=[...m.faces],ids=new Set(original.map(f=>f.id));let next=0;
  const faceId=()=>{while(ids.has(`face-${next}`))next++;const id=`face-${next++}`;ids.add(id);return id;};
  m.faces=[];
  for(const f of original){
    const lo:number[]=[],hi:number[]=[];
    f.corners.forEach((a,i)=>{const b=f.corners[(i+1)%f.corners.length],da=m.reference[a][1]-y,db=m.reference[b][1]-y;
      if(da<=0)lo.push(a);if(da>=0)hi.push(a);if(da*db<0){const v=at(a,b);lo.push(v);hi.push(v);}
    });
    if(lo.length>=3)m.faces.push({...f,corners:lo});
    if(hi.length>=3)m.faces.push({...f,id:lo.length>=3?faceId():f.id,corners:hi});
  }
  if(m.vertices.length>256||m.faces.length>256)return structuredClone(p);
  m.rings.splice(ring+1,0,newRing);return out;
}
/** Collapse one interior control ring and join the adjacent strips. End caps stay fixed. */
export function removeMeshRing(p:ConstructionPrimitive,ring:number):ConstructionPrimitive {
  const out=structuredClone(p),m=out.mesh!;if(ring<=0||ring>=m.rings.length-1)return out;
  const removed=new Set(m.rings[ring]),groups=m.faces.map((_,i)=>i);
  const root=(i:number):number=>groups[i]===i?i:root(groups[i]);
  const shared=new Map<string,number>();
  m.faces.forEach((f,i)=>f.corners.forEach((a,k)=>{const b=f.corners[(k+1)%f.corners.length];if(!removed.has(a)||!removed.has(b))return;const key=[a,b].sort((a,b)=>a-b).join(':');if(shared.has(key))groups[root(i)]=root(shared.get(key)!);else shared.set(key,i);}));
  const faces:ConstructionFreeformFace[]=[];
  for(const group of new Set(groups.map((_,i)=>root(i)))){
    const members=m.faces.filter((_,i)=>root(i)===group),edges=new Map<string,[number,number]>();
    members.forEach(f=>f.corners.forEach((a,i)=>{const b=f.corners[(i+1)%f.corners.length],reverse=`${b}:${a}`;if(edges.has(reverse))edges.delete(reverse);else edges.set(`${a}:${b}`,[a,b]);}));
    const start=edges.values().next().value?.[0];if(start===undefined)continue;
    const loop:number[]=[];let v=start;
    do{loop.push(v);const next=[...edges.values()].find(e=>e[0]===v);if(!next)return structuredClone(p);v=next[1];}while(v!==start&&loop.length<=edges.size);
    const corners=loop.filter(i=>!removed.has(i));if(corners.length>=3)faces.push({...members[0],corners});
  }
  m.faces=faces;m.rings.splice(ring,1);compact(m);return out;
}
function compact(m:ConstructionFreeformMesh){
  const used=new Set(m.faces.flatMap(f=>f.corners)),map=new Map<number,number>();
  m.vertices=m.vertices.filter((_,i)=>{if(!used.has(i))return false;map.set(i,map.size);return true;});
  m.reference=m.reference.filter((_,i)=>used.has(i));m.faces.forEach(f=>f.corners=f.corners.map(i=>map.get(i)!));m.rings=m.rings.map(r=>r.filter(i=>used.has(i)).map(i=>map.get(i)!));
}
/** Add/remove corresponding outline corners on both prism caps. */
export function editPrismOutline(p:ConstructionPrimitive,point:number,remove:boolean):ConstructionPrimitive {
  const out=structuredClone(p),m=out.mesh!;if(m.family!=='prism'||m.rings.length!==2)return out;
  const count=m.rings[0].length;if(point<0||point>=count||(remove?count<=3:count>=32))return out;
  if(remove){const removed=new Set(m.rings.map(r=>r[point]));m.rings.forEach(r=>r.splice(point,1));m.faces.forEach(f=>f.corners=f.corners.filter(i=>!removed.has(i)));}
  else for(const r of m.rings){const a=r[point],b=r[(point+1)%count],id=m.vertices.length;
    m.vertices.push(m.vertices[a].map((n,k)=>(n+m.vertices[b][k])/2) as Vec3);m.reference.push(m.reference[a].map((n,k)=>(n+m.reference[b][k])/2) as Vec3);r.splice(point+1,0,id);
  }
  // Rings are sorted counterclockwise in X/Z: the lower cap faces down.
  const [low,high]=m.rings;
  m.faces=[{id:'bottom',name:'bottom',corners:[...low]},{id:'top',name:'top',corners:[...high].reverse()},...low.map((a,i)=>({id:`side-${a}`,name:'slope' as const,corners:[a,high[i],high[(i+1)%low.length],low[(i+1)%low.length]]}))];
  compact(m);return out;
}
