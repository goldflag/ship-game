import type { AuthoredSurface, ShipDefinition, Vec3 } from '../ships/blueprint';
import { contains, segmentBox, sub } from './geometry';
import { segmentPlate } from './armorPlates';

// Reconstructed exterior belt envelopes can sit about 1.1 m inside the faired
// hull. Treat that skin and its belt as one exterior layer in combat and review.
export const EXTERIOR_PLATING_REPLACEMENT_M = 1.5;

export interface StructuralSurface extends AuthoredSurface {
  id: string; name: string; thicknessMm: number; hull: boolean; center: Vec3; size: Vec3;
  chunks: { center: Vec3; size: Vec3; first: number; end: number }[];
}
const cache=new WeakMap<ShipDefinition,StructuralSurface[]>();
const bounds=(vertices:Vec3[])=>{
  const low=[0,1,2].map(i=>Math.min(...vertices.map(v=>v[i]))), high=[0,1,2].map(i=>Math.max(...vertices.map(v=>v[i])));
  return {center:low.map((v,i)=>(v+high[i])/2) as Vec3,size:low.map((v,i)=>Math.max(.00001,high[i]-v)) as Vec3};
};

/** Ear clipping preserves concave deckhouse footprints, including bridge wings. */
function cap(points:[number,number][]):[number,number,number][] {
  const cross=(a:number,b:number,c:number)=>(points[b][0]-points[a][0])*(points[c][1]-points[a][1])-(points[b][1]-points[a][1])*(points[c][0]-points[a][0]);
  const area=points.reduce((a,p,i)=>a+p[0]*points[(i+1)%points.length][1]-p[1]*points[(i+1)%points.length][0],0);
  const ids=points.map((_,i)=>i);if(area<0)ids.reverse();
  const result:[number,number,number][]=[];
  while(ids.length>2) {
    let found=false;
    for(let i=0;i<ids.length;i++) {
      const a=ids[(i+ids.length-1)%ids.length],b=ids[i],c=ids[(i+1)%ids.length];
      if(Math.abs(cross(a,b,c))<1e-9){ids.splice(i,1);found=true;break;}
      if(cross(a,b,c)<0 || ids.some(p=>p!==a&&p!==b&&p!==c&&cross(a,b,p)>=-1e-9&&cross(b,c,p)>=-1e-9&&cross(c,a,p)>=-1e-9))continue;
      result.push([a,b,c]);ids.splice(i,1);found=true;break;
    }
    if(!found)throw new Error('Structural footprint cannot be triangulated');
  }
  return result;
}

/** Generated once from original blueprint surfaces, never from the render mesh. */
export function structuralSurfaces(def:ShipDefinition):StructuralSurface[] {
  const cached=cache.get(def);if(cached)return cached;
  const plating=def.structuralPlating;if(!plating)return [];
  const result:StructuralSurface[]=[];
  function body(id:string,name:string,surface:AuthoredSurface,thicknessMm:number,hull=false) {
    const triangles=surface.triangles.filter(ids=>{
      const [a,b,c]=ids.map(i=>surface.vertices[i]),u=sub(b,a),v=sub(c,a);
      return Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])>1e-9;
    });
    const chunks:StructuralSurface['chunks']=[];
    for(let first=0;first<triangles.length;first+=96){const end=Math.min(first+96,triangles.length);chunks.push({...bounds(triangles.slice(first,end).flatMap(t=>t.map(i=>surface.vertices[i]))),first,end});}
    result.push({id,name,...surface,triangles,thicknessMm,hull,...bounds(surface.vertices),chunks});
  }
  const sections=def.hull.sections!, n=sections[0].points.length*2-1;
  const vertices=sections.flatMap(s=>[...s.points,...s.points.slice(1).reverse().map(([w,y])=>[-w,y])].map(([w,y])=>[-w,y,def.hull.length/2-s.station] as Vec3));
  const triangles:[number,number,number][]=[];
  for(let s=0;s<sections.length-1;s++)for(let j=0;j<n;j++){
    const a=s*n+j,b=s*n+(j+1)%n,c=(s+1)*n+(j+1)%n,d=(s+1)*n+j;
    // A recurved stem can have a zero-breadth interval above its bulb.
    // Opposite coincident faces there are air, not a centerline steel sheet.
    const halves=j>=sections[0].points.length?[[a,b,d],[b,c,d]]:[[a,b,c],[a,c,d]];
    for(const ids of halves as [number,number,number][])
      if(ids.some(i=>Math.abs(vertices[i][0])>1e-7))triangles.push(ids);
  }
  // A broad transom is an exterior face too. Pointed ends naturally reduce to
  // zero-area caps; ear clipping drops their collapsed/collinear vertices.
  for(const section of [0,sections.length-1]) {
    const offset=section*n,points=vertices.slice(offset,offset+n).map(v=>[v[0],v[1]] as [number,number]);
    for(const [a,b,c] of cap(points))triangles.push(section===0?[offset+a,offset+b,offset+c]:[offset+c,offset+b,offset+a]);
  }
  body('hull','Hull shell · bow to stern',{vertices,triangles},plating.hullMm,true);
  for(const s of def.structures??[]) {
    if(s.surface){body(s.id,s.name,s.surface,plating.superstructureMm);continue;}
    const n=s.footprint.length,vertices=[s.baseY,s.baseY+s.height].flatMap(y=>s.footprint.map(([x,z])=>[x,y,z] as Vec3));
    const triangles:[number,number,number][]=[];
    for(let i=0;i<n;i++){const j=(i+1)%n;triangles.push([i,j,n+j],[i,n+j,n+i]);}
    for(const [a,b,c] of cap(s.footprint))triangles.push([a,b,c],[n+a,n+c,n+b]);
    body(s.id,s.name,{vertices,triangles},plating.superstructureMm);
  }
  cache.set(def,result);return result;
}

export function structuralHits(from:Vec3,to:Vec3,def:ShipDefinition) {
  return structuralSurfaces(def).flatMap(surface=>{
    if(!segmentBox(from,to,surface))return [];
    const hits=[];
    for(const chunk of surface.chunks){
      if(!segmentBox(from,to,chunk))continue;
      for(let i=chunk.first;i<chunk.end;i++){
        const hit=segmentPlate(from,to,surface.triangles[i].map(j=>surface.vertices[j]));
        if(hit)hits.push({...hit,surface,triangle:i});
      }
    }
    return hits;
  }).sort((a,b)=>a.t-b.t || a.surface.id.localeCompare(b.surface.id) || a.triangle-b.triangle);
}

/** Each triangle's corners and `segmentPlate` unit normal, in that order, twelve numbers a triangle. */
const planes=new WeakMap<StructuralSurface,Float64Array>();
function trianglePlanes(surface:StructuralSurface):Float64Array {
  let data=planes.get(surface);if(data)return data;
  data=new Float64Array(surface.triangles.length*12);
  surface.triangles.forEach((ids,i)=>{
    const [a,b,c]=ids.map(j=>surface.vertices[j]),o=i*12;
    const u0=b[0]-a[0],u1=b[1]-a[1],u2=b[2]-a[2],v0=c[0]-a[0],v1=c[1]-a[1],v2=c[2]-a[2];
    const n0=u1*v2-u2*v1,n1=u2*v0-u0*v2,n2=u0*v1-u1*v0,s=1/(Math.hypot(n0,n1,n2)||1);
    data!.set([...a,...b,...c,n0*s,n1*s,n2*s],o);
  });
  planes.set(surface,data);return data;
}

/** `structuralHits(from,to,def)[0]`, the only hit the sight reads, without building the others: the same
 * box tests and `segmentPlate` arithmetic in the same order, with each triangle's normal computed once. */
export function firstStructuralHit(from:Vec3,to:Vec3,def:ShipDefinition):{t:number;point:Vec3;surface:StructuralSurface;triangle:number}|undefined {
  const f0=from[0],f1=from[1],f2=from[2],d0=to[0]-f0,d1=to[1]-f1,d2=to[2]-f2;
  let best:{t:number;point:Vec3;surface:StructuralSurface;triangle:number}|undefined;
  for(const surface of structuralSurfaces(def)){
    if(!segmentBox(from,to,surface))continue;
    const p=trianglePlanes(surface);
    for(const chunk of surface.chunks){
      if(!segmentBox(from,to,chunk))continue;
      for(let i=chunk.first;i<chunk.end;i++){
        const o=i*12,n0=p[o+9],n1=p[o+10],n2=p[o+11];
        const denominator=0+n0*d0+n1*d1+n2*d2;
        if(Math.abs(denominator)<1e-10)continue;
        const t=(0+n0*(p[o]-f0)+n1*(p[o+1]-f1)+n2*(p[o+2]-f2))/denominator;
        if(t< -1e-9||t>1+1e-9)continue;
        const clamped=Math.max(0,Math.min(1,t)),x=f0+d0*clamped,y=f1+d1*clamped,z=f2+d2*clamped;
        let inside=true;
        for(let k=0;k<3;k++){
          const v=o+k*3,w=o+(k+1)%3*3,e0=p[w]-p[v],e1=p[w+1]-p[v+1],e2=p[w+2]-p[v+2],w0=x-p[v],w1=y-p[v+1],w2=z-p[v+2];
          if(0+(e1*w2-e2*w1)*n0+(e2*w0-e0*w2)*n1+(e0*w1-e1*w0)*n2< -1e-7){inside=false;break;}
        }
        if(!inside)continue;
        // The sort's comparator; a stable sort keeps the earliest of equals first.
        if(best&&!((clamped-best.t||surface.id.localeCompare(best.surface.id)||i-best.triangle)<0))continue;
        best={t:clamped,point:[x,y,z],surface,triangle:i};
      }
    }
  }
  return best;
}

/** The sea cannot occupy the intact hull interior, regardless of its armor layout. */
export function insideHull(point:Vec3,def:ShipDefinition):boolean {
  if(!def.structuralPlating)return def.armor.some(a=>!a.plate&&contains(a,point));
  const station=def.hull.length/2-point[2],sections=def.hull.sections!;
  const index=sections.findIndex((s,i)=>i<sections.length-1&&station>=s.station&&station<=sections[i+1].station);
  if(index<0)return false;
  const a=sections[index],b=sections[index+1],t=(station-a.station)/(b.station-a.station);
  const points=a.points.map(([w,y],i)=>[w+(b.points[i][0]-w)*t,y+(b.points[i][1]-y)*t]);
  if(point[1]<points[0][1]-1e-6||point[1]>points.at(-1)![1]+1e-6)return false;
  let width=-1;
  for(let i=0;i<points.length-1;i++){
    const [wa,ya]=points[i],[wb,yb]=points[i+1];
    if(point[1]>=ya-1e-6&&point[1]<=yb+1e-6)width=Math.max(width,Math.abs(yb-ya)<1e-8?Math.max(wa,wb):wa+(wb-wa)*(point[1]-ya)/(yb-ya));
  }
  return width>1e-7&&Math.abs(point[0])<=width+1e-6;
}
