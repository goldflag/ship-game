import { barrelOffset, barrelHeightOffset, type ShipDefinition, type Vec3 } from '../ships/blueprint';
import { add, sub, scale, dot, clamp, radians, segmentBox, localToWorld, worldToLocal } from './geometry';
import type { MountDefinition, MountState } from './weapons';

type Pose = Pick<MountState, 'train' | 'elevation'>;
type Capsule = { a: Vec3; b: Vec3; radius: number };
type Entry = NonNullable<ShipDefinition['mountClearance']>['mounts'][number];
type Triangle = [Vec3, Vec3, Vec3];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const norm2 = (a: Vec3) => dot(a,a);

/** Squared distance between finite segments, including parallel and point cases. */
function segments(a: Vec3, b: Vec3, c: Vec3, d: Vec3): number {
  const u=sub(b,a), v=sub(d,c), w=sub(a,c), aa=dot(u,u), bb=dot(u,v), cc=dot(v,v), dd=dot(u,w), ee=dot(v,w);
  let s=aa>1e-12 ? clamp(-dd/aa,0,1) : 0, t=0;
  if (cc>1e-12) {
    const denominator=aa*cc-bb*bb;
    if (denominator>1e-12) s=clamp((bb*ee-cc*dd)/denominator,0,1);
    t=(bb*s+ee)/cc;
    if (t<0) { t=0; s=aa>1e-12 ? clamp(-dd/aa,0,1) : 0; }
    else if (t>1) { t=1; s=aa>1e-12 ? clamp((bb-dd)/aa,0,1) : 0; }
  }
  return norm2(sub(add(a,scale(u,s)),add(c,scale(v,t))));
}
function inTriangle(p: Vec3, a: Vec3, b: Vec3, c: Vec3): boolean {
  const u=sub(b,a),v=sub(c,a),w=sub(p,a),uu=dot(u,u),uv=dot(u,v),vv=dot(v,v),wu=dot(w,u),wv=dot(w,v),den=uu*vv-uv*uv;
  if (den<1e-15) return false;
  const s=(vv*wu-uv*wv)/den,t=(uu*wv-uv*wu)/den;
  return s>=-1e-10 && t>=-1e-10 && s+t<=1+1e-10;
}
function pointTriangle(p: Vec3, a: Vec3, b: Vec3, c: Vec3): number {
  const n=cross(sub(b,a),sub(c,a)),nn=norm2(n),h=dot(sub(p,a),n);
  if (nn>1e-15 && inTriangle(sub(p,scale(n,h/nn)),a,b,c)) return h*h/nn;
  return Math.min(segments(p,p,a,b),segments(p,p,b,c),segments(p,p,c,a));
}
function capsuleTriangle(capsule: Capsule, [a,b,c]: Triangle): boolean {
  const n=cross(sub(b,a),sub(c,a)),delta=sub(capsule.b,capsule.a),den=dot(n,delta);
  if (Math.abs(den)>1e-12) {
    const t=dot(n,sub(a,capsule.a))/den;
    if (t>=0 && t<=1 && inTriangle(add(capsule.a,scale(delta,t)),a,b,c)) return true;
  }
  const distance=Math.min(pointTriangle(capsule.a,a,b,c),pointTriangle(capsule.b,a,b,c),segments(capsule.a,capsule.b,a,b),segments(capsule.a,capsule.b,b,c),segments(capsule.a,capsule.b,c,a));
  return distance<=capsule.radius*capsule.radius;
}
function inside(x: number,z: number,poly: [number,number][]): boolean {
  let yes=false;
  for (let i=0,j=poly.length-1;i<poly.length;j=i++) {
    const a=poly[i],b=poly[j];
    if ((a[1]>z)!==(b[1]>z) && x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0]) yes=!yes;
  }
  return yes;
}
type Prism = { footprint: [number,number][]; low: number; high: number; sides: Triangle[]; bounds: { center: Vec3; size: Vec3 } };
const prismCache=new WeakMap<ShipDefinition,Prism[]>();
function prisms(def: ShipDefinition): Prism[] {
  let cached=prismCache.get(def); if (cached) return cached;
  cached=(def.mountClearance?.structures??[]).map(entry=>{
    const s=def.structures!.find(s=>s.id===entry.structureId)!,low=s.baseY,high=low+s.height+entry.topExtensionM,sides: Triangle[]=[];
    for (let i=0;i<s.footprint.length;i++) {
      const [x,z]=s.footprint[i],[xx,zz]=s.footprint[(i+1)%s.footprint.length];
      const a:Vec3=[x,low,z],b:Vec3=[xx,low,zz],c:Vec3=[xx,high,zz],d:Vec3=[x,high,z];sides.push([a,b,c],[a,c,d]);
    }
    const xs=s.footprint.map(p=>p[0]),zs=s.footprint.map(p=>p[1]),minX=Math.min(...xs),maxX=Math.max(...xs),minZ=Math.min(...zs),maxZ=Math.max(...zs);
    return { footprint:s.footprint,low,high,sides,bounds:{center:[(minX+maxX)/2,(low+high)/2,(minZ+maxZ)/2] as Vec3,size:[maxX-minX,high-low,maxZ-minZ] as Vec3} };
  });
  prismCache.set(def,cached);return cached;
}
function capsulePrism(c: Capsule,p: Prism): boolean {
  if (!segmentBox(c.a,c.b,{center:p.bounds.center,size:p.bounds.size.map(s=>s+2*c.radius) as Vec3})) return false;
  for (const point of [c.a,c.b]) if (inside(point[0],point[2],p.footprint) && point[1]>=p.low-c.radius && point[1]<=p.high+c.radius) return true;
  for (const y of [p.low,p.high]) {
    const t=(y-c.a[1])/(c.b[1]-c.a[1]);
    if (t>=0 && t<=1 && inside(c.a[0]+t*(c.b[0]-c.a[0]),c.a[2]+t*(c.b[2]-c.a[2]),p.footprint)) return true;
  }
  return p.sides.some(t=>capsuleTriangle(c,t));
}
function frame(m: MountDefinition,p: Pose) { return {x:m.position[0],y:m.position[1],z:m.position[2],heading:radians(m.bearingDeg)+p.train,pitch:0,roll:0}; }
function barrels(m: MountDefinition,p: Pose,e: Entry,margin: number): Capsule[] {
  const w=m.weapon,f=frame(m,p),cs=Math.cos(p.elevation),sn=Math.sin(p.elevation);
  const point=(forward: number,barrel: number):Vec3=>{
    const row=barrelHeightOffset(w,barrel),travel=forward-w.trunnionForward;
    return localToWorld([barrelOffset(w,barrel),w.pivotHeight+travel*sn+row*cs,-w.trunnionForward-travel*cs+row*sn],f);
  };
  // Enclose both recoil endpoints at every pose; firing cannot introduce a new contact.
  return Array.from({length:w.barrelCount??2},(_,i)=>({a:point(w.trunnionForward-.65-w.recoilM,i),b:point(w.muzzleForward+.05,i),radius:e.barrelRadiusM+margin}));
}
function capsuleBody(c: Capsule,m: MountDefinition,p: Pose,e: Entry,margin: number): boolean {
  if (!e.body) return false;
  const f=frame(m,p);return !!segmentBox(worldToLocal(c.a,f),worldToLocal(c.b,f),{center:e.body.center,size:e.body.size.map(s=>s+2*(c.radius+margin)) as Vec3});
}
function bodies(a: MountDefinition,ap: Pose,ae: Entry,b: MountDefinition,bp: Pose,be: Entry,margin: number): boolean {
  if (!ae.body || !be.body) return false;
  const af=frame(a,ap),bf=frame(b,bp),ac=localToWorld(ae.body.center,af),bc=localToWorld(be.body.center,bf);
  if (Math.abs(ac[1]-bc[1])>(ae.body.size[1]+be.body.size[1])/2+margin) return false;
  const axis=(heading:number)=>[[Math.cos(heading),Math.sin(heading)],[-Math.sin(heading),Math.cos(heading)]];
  const aa=axis(af.heading),bb=axis(bf.heading),delta=[bc[0]-ac[0],bc[2]-ac[2]];
  return [...aa,...bb].every(n=>{
    const projection=(axes:number[][],size:Vec3)=>Math.abs(n[0]*axes[0][0]+n[1]*axes[0][1])*size[0]/2+Math.abs(n[0]*axes[1][0]+n[1]*axes[1][1])*size[2]/2;
    return Math.abs(n[0]*delta[0]+n[1]*delta[1])<=projection(aa,ae.body!.size)+projection(bb,be.body!.size)+margin;
  });
}
/** CPU-only installation check. No GPU samples or render meshes enter the simulation. */
export function mountPoseClear(def: ShipDefinition,index: number,pose: Pose,states?: readonly Pose[],extraMargin=0): boolean {
  const profile=def.mountClearance,m=def.mounts[index],entry=profile?.mounts.find(e=>e.mountId===m.id);
  if (!profile || !entry) return true;
  const margin=profile.marginM+extraMargin,own=barrels(m,pose,entry,margin);
  if (own.some(c=>prisms(def).some(p=>capsulePrism(c,p)))) return false;
  for (const pair of profile.neighbors) {
    const otherId=pair[0]===m.id?pair[1]:pair[1]===m.id?pair[0]:undefined;if (!otherId) continue;
    const j=def.mounts.findIndex(m=>m.id===otherId),other=def.mounts[j],otherPose=states?.[j]??{train:0,elevation:radians(1)},otherEntry=profile.mounts.find(e=>e.mountId===otherId)!;
    const their=barrels(other,otherPose,otherEntry,margin);
    if (own.some(a=>their.some(b=>segments(a.a,a.b,b.a,b.b)<=(a.radius+b.radius)**2) || capsuleBody(a,other,otherPose,otherEntry,margin)) || their.some(c=>capsuleBody(c,m,pose,entry,margin)) || bodies(m,pose,entry,other,otherPose,otherEntry,margin)) return false;
  }
  return true;
}
/** Move along a checked path. Small angular subdivisions plus an arc-length margin
 * cover interpolation between samples, including large development-preview jumps. */
export function moveMountWithClearance(def: ShipDefinition,index: number,state: Pose,target: Pose,states?: readonly Pose[]): boolean {
  if (!def.mountClearance?.mounts.some(e=>e.mountId===def.mounts[index].id)) { Object.assign(state,target);return true; }
  const w=def.mounts[index].weapon,train=target.train-state.train,elevation=target.elevation-state.elevation;
  const steps=Math.max(1,Math.ceil(Math.max(Math.abs(train),Math.abs(elevation))/radians(.25))),start={...state};
  // A sum of rotational arc lengths bounds every barrel and body point between samples.
  const reach=Math.max(Math.abs(w.muzzleForward)+w.recoilM+1,...w.gunhouseSize),margin=reach*(Math.abs(train)+Math.abs(elevation))/steps;
  for (let i=1;i<=steps;i++) {
    const next={train:start.train+train*i/steps,elevation:start.elevation+elevation*i/steps};
    if (!mountPoseClear(def,index,next,states,margin)) return false;
    Object.assign(state,next);
  }
  return true;
}
