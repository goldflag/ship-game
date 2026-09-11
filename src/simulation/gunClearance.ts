import { barrelHeightOffset, barrelOffset, type Mount, type GunPart, type Vec3, type TravelClearance } from '../ships/blueprint';
import { add, sub, scale, dot, clamp } from './geometry';
import { segmentPlate } from './protection';

const cross = (a: Vec3, b: Vec3): Vec3 => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const squared = (p: Vec3) => dot(p, p);
function pointSegment(p: Vec3, a: Vec3, b: Vec3): number {
  const ab = sub(b, a), t = clamp(dot(sub(p, a), ab) / Math.max(1e-20, squared(ab)), 0, 1);
  return squared(sub(p, add(a, scale(ab, t))));
}
function pointTriangle(p: Vec3, a: Vec3, b: Vec3, c: Vec3): number {
  const n = cross(sub(b, a), sub(c, a)), nn = squared(n);
  const distance = dot(sub(p, a), n), q = sub(p, scale(n, distance / nn));
  if ([[a,b],[b,c],[c,a]].every(([u,v]) => dot(cross(sub(v,u),sub(q,u)),n) >= -1e-12)) return distance*distance/nn;
  return Math.min(pointSegment(p,a,b), pointSegment(p,b,c), pointSegment(p,c,a));
}
function segmentDistance(p: Vec3, q: Vec3, a: Vec3, b: Vec3): number {
  const u=sub(q,p), v=sub(b,a), w=sub(p,a), aa=dot(u,u), bb=dot(u,v), cc=dot(v,v), dd=dot(u,w), ee=dot(v,w);
  const det=aa*cc-bb*bb;
  let s=det>1e-20 ? clamp((bb*ee-cc*dd)/det,0,1) : 0;
  let t=(bb*s+ee)/Math.max(cc,1e-20);
  if(t<0){t=0;s=clamp(-dd/Math.max(aa,1e-20),0,1);}
  else if(t>1){t=1;s=clamp((bb-dd)/Math.max(aa,1e-20),0,1);}
  return squared(sub(add(p,scale(u,s)),add(a,scale(v,t))));
}
export function segmentTriangleDistance(p: Vec3, q: Vec3, a: Vec3, b: Vec3, c: Vec3): number {
  if(segmentPlate(p,q,[a,b,c])) return 0;
  return Math.sqrt(Math.max(0,Math.min(pointTriangle(p,a,b,c),pointTriangle(q,a,b,c),segmentDistance(p,q,a,b),segmentDistance(p,q,b,c),segmentDistance(p,q,c,a))));
}
type InstalledGun = Mount & { weapon: GunPart };
const surfaces=new WeakMap<TravelClearance,{a:Vec3;b:Vec3;c:Vec3;lo:Vec3;hi:Vec3}[]>();
/** Distance to the original installation, reserving the entire recoil stroke.
 * The base-local frame makes carried guns independent of their parent's train. */
export function gunClearance(m: InstalledGun, train: number, elevation: number): number {
  const c=m.travelClearance;if(!c)return Infinity;
  let triangles=surfaces.get(c);
  if(!triangles){triangles=c.surface.triangles.map(ids=>{
    const [a,b,d]=ids.map(i=>c.surface.vertices[i]);
    return {a,b,c:d,lo:a.map((v,i)=>Math.min(v,b[i],d[i])) as Vec3,hi:a.map((v,i)=>Math.max(v,b[i],d[i])) as Vec3};
  });surfaces.set(c,triangles);}
  const w=m.weapon, ct=Math.cos(train),st=Math.sin(train),ce=Math.cos(elevation),se=Math.sin(elevation);
  let distance=Infinity;
  for(let barrel=0;barrel<(w.barrelCount??2);barrel++)for(const capsule of c.barrels){
    const x=barrelOffset(w,barrel), up=barrelHeightOffset(w,barrel)+capsule.heightM;
    const point=(along:number):Vec3=>{
      const forward=w.trunnionForward+along*ce-up*se;
      return [ct*x+st*forward,w.pivotHeight+along*se+up*ce,st*x-ct*forward];
    };
    const from=point(capsule.fromM-(capsule.recoils?w.recoilM:0)),to=point(capsule.toM);
    const lo=from.map((v,i)=>Math.min(v,to[i])),hi=from.map((v,i)=>Math.max(v,to[i]));
    for(const triangle of triangles){
      const threshold=distance+capsule.radiusM;let gap=0;
      for(let i=0;i<3;i++)gap+=Math.max(0,triangle.lo[i]-hi[i],lo[i]-triangle.hi[i])**2;
      if(threshold<=0||gap>threshold*threshold)continue;
      distance=Math.min(distance,segmentTriangleDistance(from,to,triangle.a,triangle.b,triangle.c)-capsule.radiusM);
    }
  }
  return distance;
}
/** Conservative advancement bounds the whole curved move, including thin
 * obstacles between endpoints. It never jumps to the far side of a plate. */
export function clearGunMotion(m: InstalledGun, train: number, elevation: number, nextTrain: number, nextElevation: number, separationM = .001): number {
  const c=m.travelClearance;if(!c)return 1;
  const dt=nextTrain-train,de=nextElevation-elevation,w=m.weapon;
  if(dt===0&&de===0)return 1;
  let reach=0;
  for(const p of c.barrels)reach=Math.max(reach,Math.hypot(Math.max(Math.abs(p.fromM-(p.recoils?w.recoilM:0)),Math.abs(p.toM)),Math.abs(p.heightM)+(w.barrelVerticalSpacing??0)/2));
  const lateral=Math.abs(barrelOffset(w,0));
  const speed=Math.abs(dt)*(Math.abs(w.trunnionForward)+reach+lateral)+Math.abs(de)*reach;
  let t=0;
  for(let i=0;i<80&&t<1;i++){
    const distance=gunClearance(m,train+t*dt,elevation+t*de);
    if(distance<=0)return t;
    // Keep a 1 mm separation so reversing away from a stop remains numerically
    // stable. Near that skin, permit a provably safe step only away/tangent.
    const near=separationM>0&&distance<=separationM+.000001;
    const step=Math.min(1-t,(near?.5*distance:.8*(distance-separationM))/speed);
    if(step<1e-12)return t;
    if(near&&gunClearance(m,train+(t+step)*dt,elevation+(t+step)*de)<distance-1e-10)return t;
    t+=step;
  }
  return t;
}

/** Choose one straight, swept-safe joint move per tick. An obstructed diagonal
 * may still have a free axis; retaining that movement avoids trapping a gun
 * against a shield when it can traverse around it. */
export function advanceGunMotion(m: InstalledGun, train: number, elevation: number, nextTrain: number, nextElevation: number) {
  const fraction=clearGunMotion(m,train,elevation,nextTrain,nextElevation);
  const dt=nextTrain-train,de=nextElevation-elevation;
  let x=dt*fraction,y=de*fraction;
  if(fraction<1-1e-9&&dt!==0&&de!==0){
    for(const [a,b] of [[dt,0],[0,de]]){
      const f=clearGunMotion(m,train,elevation,train+a,elevation+b);
      if(Math.hypot(a*f,b*f)>Math.hypot(x,y)){x=a*f;y=b*f;}
    }
  }
  return {train:train+x,elevation:elevation+y,blocked:Math.abs(x-dt)>1e-9||Math.abs(y-de)>1e-9};
}

export type GunPose = { train: number; elevation: number };
/** Snapshots can span several axis choices. Reconstruct a clear interpolation
 * path from their endpoints, keeping authoritative state entirely unchanged. */
export function gunPosePath(m: InstalledGun, from: GunPose, to: GunPose): GunPose[] {
  // Endpoint snapshots already retain the motion skin; test physical clearance
  // here so the interpolated pose can actually arrive at a recorded stop.
  const clear=(a:GunPose,b:GunPose)=>clearGunMotion(m,a.train,a.elevation,b.train,b.elevation,0)>=1-1e-9;
  if(!m.travelClearance||clear(from,to))return [from,to];
  // Forced development poses deliberately bypass normal installation stops.
  if(gunClearance(m,from.train,from.elevation)<0||gunClearance(m,to.train,to.elevation)<0)return [from,to];
  for(const corner of [{train:from.train,elevation:to.elevation},{train:to.train,elevation:from.elevation}])
    if(clear(from,corner)&&clear(corner,to))return [from,corner,to];
  // With no recoverable path, hold the earlier safe pose until the next sample.
  // Never invent a straight shortcut through an obstacle after a packet gap.
  return [from];
}
export function interpolateGunPath(m: InstalledGun, path: GunPose[], to: GunPose, alpha: number): GunPose {
  if(alpha>=1)return to;
  const costs=path.slice(1).map((p,i)=>Math.max(Math.abs(p.train-path[i].train)/m.weapon.traverseRateDeg,Math.abs(p.elevation-path[i].elevation)/m.weapon.elevationRateDeg));
  let remaining=alpha*costs.reduce((a,b)=>a+b,0);
  for(let i=0;i<costs.length;i++){
    if(remaining<=costs[i]&&costs[i]>0){const f=remaining/costs[i];return {train:path[i].train+(path[i+1].train-path[i].train)*f,elevation:path[i].elevation+(path[i+1].elevation-path[i].elevation)*f};}
    remaining-=costs[i];
  }
  return path.at(-1)!;
}
