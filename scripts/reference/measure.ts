import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { compileShip, type Vec3 } from '../../src/ships/blueprint';
import { protectionTrace } from '../../src/simulation/protection';
const root=resolve(import.meta.dir,'../..'), ship=process.argv[2] ?? 'bismarck';
if (!/^[a-z][a-z0-9-]{0,63}$/.test(ship)) throw new Error('Invalid ship ID');
const source=resolve(root,'assets/ships',ship);
const spec=JSON.parse(await readFile(resolve(source,'modeling-spec.json'),'utf8'));
const def=compileShip(JSON.parse(await readFile(resolve(source,'blueprint.json'),'utf8')),JSON.parse(await readFile(resolve(root,'assets/parts/guns.json'),'utf8')));
const published=JSON.parse(await readFile(resolve(root,'public/models',ship+'.json'),'utf8'));
const {contentHash: publishedHash, ...publishedDefinition}=published;
if(JSON.stringify(publishedDefinition)!==JSON.stringify(def))throw new Error('Published definition is stale; run ship:build');
const bytes=await readFile(resolve(root,'public/models',ship+'.glb'));
const jsonLength=bytes.readUInt32LE(12),gltf=JSON.parse(bytes.subarray(20,20+jsonLength).toString());
if (gltf.scenes[gltf.scene??0].extras?.definitionHash!==published.contentHash) throw new Error('Mismatched published pair');
const binOffset=20+jsonLength+8;
function accessor(index:number):number[][] {
  const a=gltf.accessors[index],v=gltf.bufferViews[a.bufferView];
  const dims:{[key:string]:number}={SCALAR:1,VEC2:2,VEC3:3,VEC4:4};const n=dims[a.type];
  const sizes:{[key:number]:number}={5126:4,5125:4,5123:2,5121:1};const size=sizes[a.componentType];
  if (!size||!n) throw new Error('Unsupported GLB accessor');
  return Array.from({length:a.count},(_,i)=>Array.from({length:n},(_,j)=>{
    const off=binOffset+(v.byteOffset??0)+(a.byteOffset??0)+i*(v.byteStride??n*size)+j*size;
    return a.componentType===5126?bytes.readFloatLE(off):size===4?bytes.readUInt32LE(off):size===2?bytes.readUInt16LE(off):bytes.readUInt8(off);
  }));
}
const world=new Map<number,Matrix4>();
function walk(i:number,parent:Matrix4) {
  const n=gltf.nodes[i],local=n.matrix?new Matrix4().fromArray(n.matrix):new Matrix4().compose(new Vector3().fromArray(n.translation??[0,0,0]),new Quaternion().fromArray(n.rotation??[0,0,0,1]),new Vector3().fromArray(n.scale??[1,1,1]));
  const matrix=parent.clone().multiply(local);world.set(i,matrix);for(const c of n.children??[])walk(c,matrix);
}
for(const n of gltf.scenes[gltf.scene??0].nodes)walk(n,new Matrix4());
const hi=gltf.nodes.findIndex((n:any)=>n.extras?.nodeId==='hull.surface');
if(hi<0)throw new Error('Missing authored hull');
const triangles:Vector3[][]=[];
for(const p of gltf.meshes[gltf.nodes[hi].mesh].primitives) {
  const vertices=accessor(p.attributes.POSITION).map(v=>new Vector3().fromArray(v).applyMatrix4(world.get(hi)!));
  const indices=p.indices===undefined?vertices.map((_,i)=>i):accessor(p.indices).flat();
  for(let i=0;i<indices.length;i+=3)triangles.push(indices.slice(i,i+3).map(n=>vertices[n]));
}
const all=triangles.flat();const bounds=[new Vector3(Infinity,Infinity,Infinity),new Vector3(-Infinity,-Infinity,-Infinity)];for(const p of all){bounds[0].min(p);bounds[1].max(p);}
function section(axis:'y'|'z',value:number) {
  const points:Vector3[]=[];
  for(const t of triangles)for(let i=0;i<3;i++){
    const a=t[i],b=t[(i+1)%3],da=a[axis]-value,db=b[axis]-value;
    if(Math.abs(da)<1e-6)points.push(a.clone());
    if(da*db<0)points.push(a.clone().lerp(b,da/(da-db)));
  }
  if(!points.length)throw new Error('Empty geometric section');return points;
}
const span=(pts:Vector3[],axis:'x'|'y'|'z')=>Math.max(...pts.map(p=>p[axis]))-Math.min(...pts.map(p=>p[axis]));
const wl=section('y',0),mid=section('z',0);
const metrics:{[key:string]:number}={'hull.length':bounds[1].z-bounds[0].z,'hull.beam':bounds[1].x-bounds[0].x,'hull.draft':-bounds[0].y,'hull.waterlineLength':span(wl,'z'),'hull.waterlineBeam':span(wl,'x'),'hull.midshipDepth':span(mid,'y')};
const dimensions=spec.acceptance.map((p:any)=>({...p,measured:metrics[p.metric],deviation:metrics[p.metric]-p.target,passed:Number.isFinite(metrics[p.metric])&&Math.abs(metrics[p.metric]-p.target)<=p.tolerance}));
const key=(v:Vector3)=>v.toArray().map(n=>Math.round(n*1e5)).join(',');const edges=new Map<string,number>();let degenerate=0;
for(const t of triangles){
  if(!t.every(v=>v.toArray().every(Number.isFinite)))throw new Error('Nonfinite geometry');
  if(new Vector3().subVectors(t[1],t[0]).cross(new Vector3().subVectors(t[2],t[0])).length()<1e-7)degenerate++;
  for(let i=0;i<3;i++){const edge=[key(t[i]),key(t[(i+1)%3])].sort().join('|');edges.set(edge,(edges.get(edge)??0)+1);}
}
const nonManifoldEdges=[...edges.values()].filter(n=>n!==2).length;
function halfWidth(s:number,y:number):number {
  const sections=def.hull.sections!;let index=sections.findIndex((v,i)=>i<sections.length-1&&v.station<=s&&sections[i+1].station>=s);
  if(index<0)return -1;
  const a=sections[index],b=sections[index+1],t=(s-a.station)/(b.station-a.station);
  const points=a.points.map((p,i)=>p.map((n,j)=>n+(b.points[i][j]-n)*t));
  if(y<points[0][1]-.02 || y>points.at(-1)![1]+.02)return -1;
  let width=0;
  for(let i=0;i<points.length-1;i++){
    const [x0,y0]=points[i],[x1,y1]=points[i+1];
    if(y>=y0-.02&&y<=y1+.02)width=Math.max(width,Math.abs(y1-y0)<1e-8?Math.max(x0,x1):x0+(x1-x0)*(y-y0)/(y1-y0));
  }
  return width;
}
const spaces=def.compartments.map(c=>{
  let outside=0,maxExcess=0;
  for(let i=0;i<8;i++){
    const p=c.center.map((v,j)=>v+c.size[j]/2*(i&(1<<j)?1:-1)) as Vec3;
    const w=halfWidth(def.hull.length/2-p[2],p[1]);const excess=w<0?100:Math.abs(p[0])-w;
    if(excess>.25)outside++;maxExcess=Math.max(maxExcess,excess);
  }
  return {id:c.id,passed:outside===0,outsideCorners:outside,maxExcessM:maxExcess};
});
const probes=spec.probes.map((p:{id:string;from:Vec3;to:Vec3})=>({...p,layers:protectionTrace(p.from,p.to,def)}));
const landmarks=spec.landmarks.map((p:any)=>{
  const mount=def.mounts.find(m=>p.id===m.id+'-axis');
  let actual:Vec3|null=null;
  if(mount){const index=gltf.nodes.findIndex((n:any)=>n.extras?.nodeId===mount.id+'.left.elevation');if(index>=0){actual=new Vector3().setFromMatrixPosition(world.get(index)!).toArray();const yaw=gltf.nodes.findIndex((n:any)=>n.extras?.nodeId===mount.id+'.yaw');const pivot=new Vector3().setFromMatrixPosition(world.get(yaw)!);actual[0]=pivot.x;actual[2]=pivot.z;}}
  if (!mount) { const i=gltf.nodes.findIndex((n:any)=>n.extras?.nodeId==='landmark.'+p.id);if(i>=0)actual=new Vector3().setFromMatrixPosition(world.get(i)!).toArray(); }
  // Vertical axes are checked against real joints; source uncertainty remains separate.
  return {...p,measured:actual,deviationM:actual?actual.map((v,i)=>v-p.runtime[i]):null,passed:actual!==null&&actual.every((v,i)=>Math.abs(v-p.runtime[i])<=p.toleranceM),status:actual?'measured exported landmark or yaw centre and axis height':'visual landmark; see matched images'};
});
const report={schemaVersion:1,contentHash:published.contentHash,modelSha256:createHash('sha256').update(bytes).digest('hex'),specRevision:spec.revision,dimensions,geometry:{triangles:triangles.length,degenerate,nonManifoldEdges,watertight:nonManifoldEdges===0},spaces,probes,landmarks,passed:dimensions.every((v:any)=>v.passed)&&!degenerate&&!nonManifoldEdges&&spaces.every(s=>s.passed)&&landmarks.every((l:{passed:boolean})=>l.passed),historicalAccuracy:'Not certified. Tolerances validate authored targets; source uncertainty and discrepancies remain separate.'};
await writeFile(resolve(source,'reports/measurements.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({dimensions,geometry:report.geometry,spaceFailures:spaces.filter(s=>!s.passed),passed:report.passed},null,2));
if(!report.passed)process.exitCode=1;
