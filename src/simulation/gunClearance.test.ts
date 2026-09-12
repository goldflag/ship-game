import { expect, test } from 'bun:test';
import blueprint from '../../assets/ships/kongo/blueprint.json';
import catalog from '../../assets/parts/guns.json';
import { compileShip, type TravelClearance, type Vec3 } from '../ships/blueprint';
import { structuralSurfaces } from './structure';
import { advanceGunMotion, clearGunMotion, gunClearance, gunPosePath, interpolateGunPath, segmentTriangleDistance } from './gunClearance';
import { createMountState, updateMount } from './weapons';
const def=compileShip(blueprint,catalog);
const mounts=def.mounts.filter(m=>m.parentMountId && m.travelClearance);
const rad=(degrees:number)=>degrees*Math.PI/180;

test('pruned Kongō clearance preserves contacts across catalog travel against every authored structure',()=>{
  const surfaces=structuralSurfaces(def);
  for(const m of def.mounts.filter(m=>m.id.startsWith('main-')||m.id.startsWith('casemate-'))){
    const vertices:Vec3[]=[],triangles:[number,number,number][]=[];
    const angle=rad(m.bearingDeg),c=Math.cos(angle),s=Math.sin(angle);
    for(const surface of surfaces){
      const offset=vertices.length;
      vertices.push(...surface.vertices.map(p=>{
        const x=p[0]-m.position[0],z=p[2]-m.position[2];
        return [c*x+s*z,p[1]-m.position[1],-s*x+c*z] as Vec3;
      }));
      triangles.push(...surface.triangles.map(t=>t.map(i=>i+offset) as [number,number,number]));
    }
    // No. 4 needs no retained surface; use the identical No. 1 barrel recipe
    // to independently check that omission against the unfiltered geometry.
    const barrels=m.travelClearance?.barrels ?? def.mounts.find(m=>m.id==='main-1')!.travelClearance!.barrels;
    const full={...m,travelClearance:{version:1 as const,barrels,surface:{vertices,triangles}}};
    for(let yaw=-8;yaw<=8;yaw++)for(let pitch=0;pitch<=4;pitch++){
      const train=rad(m.weapon.traverseDeg*yaw/8);
      const elevation=rad(m.weapon.elevationMinDeg+(m.weapon.elevationMaxDeg-m.weapon.elevationMinDeg)*pitch/4);
      expect(Math.min(.001,gunClearance(m,train,elevation))).toBeCloseTo(Math.min(.001,gunClearance(full,train,elevation)),7);
    }
  }
},120000);

test('capsule distance includes triangle interiors, edges, parallel and crossing paths',()=>{
  const a:[number,number,number]=[-2,0,-2],b:[number,number,number]=[2,0,-2],c:[number,number,number]=[0,0,2];
  expect(segmentTriangleDistance([0,-1,0],[0,1,0],a,b,c)).toBe(0);
  expect(segmentTriangleDistance([-.1,2,0],[.1,2,0],a,b,c)).toBeCloseTo(2);
  expect(segmentTriangleDistance([-3,0,-2],[3,0,-2],a,b,c)).toBe(0);
  expect(segmentTriangleDistance([3,0,-2],[4,0,-2],a,b,c)).toBeCloseTo(1);
});

test('installed AA barrels stop before shields through depression and combined train',()=>{
  expect(mounts).toHaveLength(4);
  for(const m of mounts){
    expect(gunClearance(m,0,rad(1))).toBeGreaterThan(0);
    for(const train of [-90,-70,-45,0,45,70,90]){
      const target=[rad(train),rad(-10)];
      const f=clearGunMotion(m,0,rad(1),...target as [number,number]);
      expect(f).toBeGreaterThan(0);
      expect(f).toBeLessThanOrEqual(1);
      for(let i=0;i<=8;i++) expect(gunClearance(m,target[0]*f*i/8,rad(1)+(target[1]-rad(1))*f*i/8)).toBeGreaterThanOrEqual(-1e-8);
    }
  }
},30000);

test('continuous motion cannot tunnel through a thin obstacle with clear endpoints, and can reverse away',()=>{
  const m=structuredClone(mounts[0]);
  m.weapon.barrelCount=1;m.weapon.barrelSpacing=0;m.weapon.pivotHeight=0;m.weapon.trunnionForward=0;m.weapon.recoilM=0;
  m.travelClearance={version:1,barrels:[{fromM:0,toM:2,heightM:0,radiusM:.05,recoils:true}],surface:{vertices:[[-.01,-1,-2],[.01,-1,-2],[0,1,-2]],triangles:[[0,1,2]]}};
  expect(gunClearance(m,-.5,0)).toBeGreaterThan(0);
  expect(gunClearance(m,.5,0)).toBeGreaterThan(0);
  const f=clearGunMotion(m,-.5,0,.5,0);
  expect(f).toBeLessThan(.5);
  const stopped=-.5+f;
  expect(gunClearance(m,stopped,0)).toBeGreaterThanOrEqual(0);
  expect(clearGunMotion(m,stopped,0,-.5,0)).toBeGreaterThan(.99);
  const from={train:-.5,elevation:0},to={train:.5,elevation:.3};
  expect(gunClearance(m,0,.15)).toBeLessThan(0);
  const path=gunPosePath(m,from,to);expect(path).toHaveLength(3);
  for(let i=0;i<=20;i++){
    const p=interpolateGunPath(m,path,to,i/20);
    expect(gunClearance(m,p.train,p.elevation)).toBeGreaterThanOrEqual(0);
  }
  expect(interpolateGunPath(m,path,to,1)).toEqual(to);
});

test('CPU aiming holds a blocked installation and can elevate away without spending ammunition',()=>{
  const m=mounts[0],s=createMountState(m),pose={x:0,y:0,z:0,heading:0,pitch:0,roll:0};
  s.loaded='he';
  const ammo=s.ammo;
  for(let i=0;i<80;i++) updateMount(m,s,def,pose,[m.position[0],0,m.position[2]-100],.1);
  expect(s.status).toBe('blocked');expect(gunClearance(m,s.train,s.elevation)).toBeGreaterThanOrEqual(-1e-8);
  const low=s.elevation;
  for(let i=0;i<20;i++) updateMount(m,s,def,pose,[m.position[0],100,m.position[2]-100],.1);
  expect(s.elevation).toBeGreaterThan(low+.1);expect(s.ammo).toBe(ammo);
},30000);

test('an obstructed diagonal retains a free axis to reach a clear low-angle target',()=>{
  const m=mounts.find(m=>m.id==='aa25-02')!;let train=0,elevation=rad(1);
  for(let i=0;i<160;i++){
    const p=advanceGunMotion(m,train,elevation,Math.min(rad(90),train+.02),Math.max(rad(-10),elevation-.014));
    expect(gunClearance(m,(train+p.train)/2,(elevation+p.elevation)/2)).toBeGreaterThanOrEqual(-1e-8);
    train=p.train;elevation=p.elevation;
  }
  expect(train).toBeCloseTo(rad(90),8);expect(elevation).toBeCloseTo(rad(-10),8);
},30000);

test('invalid travel clearance fails compilation before motion consumes it',()=>{
  expect(()=>compileShip({...blueprint,mountClearance:{version:1,marginM:.01,basis:'conflicting encodings fixture',mounts:[{mountId:'main-1',barrelRadiusM:.5}],structures:[],neighbors:[]}},catalog)).toThrow(/either travelClearance or mountClearance/);
  for(const change of [
    (c:TravelClearance)=>c.version=2 as 1,
    (c:TravelClearance)=>c.surface.triangles[0][0]=999999,
    (c:TravelClearance)=>c.surface.triangles[0]=[0,0,0],
    (c:TravelClearance)=>c.surface.vertices[0][0]=NaN,
    (c:TravelClearance)=>c.barrels[0].radiusM=-1,
    (c:TravelClearance)=>c.barrels[0].toM=c.barrels[0].fromM,
  ]){
    const b=structuredClone(blueprint);change(b.mounts.find(m=>'travelClearance'in m)!.travelClearance! as TravelClearance);
    expect(()=>compileShip(b,catalog)).toThrow();
  }
});


test('main and casemate barrels stop before authored galleries and deck edges, then reverse clear',()=>{
  const cases:[string,number,number][]=[['main-1',-18.125,-5],['main-1',18.125,-5],['main-1',-36.25,-5],['main-2',-145,43],['main-3',-145,43]];
  for(const side of ['port','starboard'])for(let i=1;i<=3;i++)cases.push([`casemate-${side}-${i}`,side==='port'?-75:75,-5]);
  cases.push(['casemate-port-2',-62.428845355,16.815735405],['casemate-starboard-2',56.25,20]);
  cases.push(['casemate-port-4',-56.25,20],['casemate-starboard-4',56.25,20]);
  for(const [id,degrees,pitch] of cases){
    const m=def.mounts.find(m=>m.id===id)!,train=rad(degrees),elevation=rad(pitch),start=rad(1);
    expect(gunClearance(m,train,elevation)).toBeLessThan(0);
    const fraction=clearGunMotion(m,0,start,train,elevation);
    expect(fraction).toBeGreaterThan(0);expect(fraction).toBeLessThan(1);
    for(let i=0;i<=24;i++)expect(gunClearance(m,train*fraction*i/24,start+(elevation-start)*fraction*i/24)).toBeGreaterThanOrEqual(0);
    const stopped={train:train*fraction,elevation:start+(elevation-start)*fraction};
    expect(clearGunMotion(m,stopped.train,stopped.elevation,0,start)).toBeGreaterThan(.999);
  }
},30000);
