import { expect, test } from 'bun:test';
import blueprint from '../../assets/ships/cleveland/blueprint.json';
import yamato from '../../assets/ships/yamato/blueprint.json';
// Yamato is authored with box obstructions; her retired closed-body profile is
// kept as a fixture so the encoding stays covered on real authored geometry.
import sweptClearance from './fixtures/yamato-swept-clearance.json';
import catalog from '../../assets/parts/guns.json';
import { compileShip, type ShipBlueprint } from '../ships/blueprint';
import { mountPoseClear, moveMountWithClearance } from './mountClearance';
import { createMountState, updateMount } from './weapons';
import { clamp, radians } from './geometry';
const fixture=()=>{
  const definition=compileShip(structuredClone(blueprint) as unknown as ShipBlueprint,catalog);
  return {definition,states:definition.mounts.map(createMountState)};
};
test('closed-body and installation profiles compile independently and reject incomplete or mixed encodings',()=>{
  expect('mountClearance' in yamato).toBe(false);
  const swept={...structuredClone(yamato),mountClearance:sweptClearance} as unknown as ShipBlueprint;
  const d=compileShip(swept,catalog),states=d.mounts.map(createMountState);
  expect(d.mountClearance!.mountIds).toHaveLength(d.mounts.length);
  // The TypeScript migration reference only resolves installation envelopes;
  // closed-body motion is owned by the native/WASM resolver.
  expect(mountPoseClear(d,0,states[0],states)).toBe(true);
  const c=structuredClone(blueprint) as unknown as ShipBlueprint;
  const profile=c.mountClearance!;
  for (const incomplete of [
    {version:1,marginM:.02,basis:'test'},
    {version:1,marginM:.02,basis:'test',bodies:[]},
    {version:1,marginM:.02,basis:'test',mountIds:['main-1']},
    {...profile,mounts:undefined},
    {...profile,structures:undefined},
    {...profile,neighbors:undefined},
    {...profile,mountIds:['main-1'],bodies:[]},
  ]) {
    c.mountClearance=incomplete as ShipBlueprint['mountClearance'];
    expect(()=>compileShip(c,catalog)).toThrow('mountClearance');
  }
});
test('installation interlocks validate references and positive envelope dimensions',()=>{
  const b=structuredClone(blueprint) as unknown as ShipBlueprint;
  b.mountClearance!.neighbors![0]=['main-1','missing'];
  expect(()=>compileShip(b,catalog)).toThrow('selected mount pairs');
  b.mountClearance!.neighbors![0]=['main-1','main-2'];
  b.mountClearance!.mounts![0].body!.size[1]=0;
  expect(()=>compileShip(b,catalog)).toThrow('clearance body dimension');
});
test('neutral installed poses have clearance throughout the enclosed recoil stroke',()=>{
  const {definition:d,states}=fixture();
  for (let i=0;i<states.length;i++) expect(mountPoseClear(d,i,states[i],states)).toBe(true);
});
test('wing guns stop below an overhead platform and can traverse away before elevating',()=>{
  const {definition:d,states}=fixture(),i=d.mounts.findIndex(m=>m.id==='secondary-2'),s=states[i];
  expect(moveMountWithClearance(d,i,s,{train:0,elevation:radians(85)},states)).toBe(false);
  expect(s.elevation).toBeLessThan(radians(70));
  expect(s.elevation).toBeGreaterThan(radians(35));
  expect(mountPoseClear(d,i,s,states)).toBe(true);
  expect(moveMountWithClearance(d,i,s,{train:radians(-90),elevation:s.elevation},states)).toBe(true);
  expect(moveMountWithClearance(d,i,s,{train:s.train,elevation:radians(85)},states)).toBe(true);
  expect(moveMountWithClearance(d,i,s,{train:0,elevation:s.elevation},states)).toBe(false);
  expect(mountPoseClear(d,i,s,states)).toBe(true);
  expect(moveMountWithClearance(d,i,s,{train:s.train,elevation:radians(1)},states)).toBe(true);
  expect(moveMountWithClearance(d,i,s,{train:0,elevation:s.elevation},states)).toBe(true);
});
test('independently held main guns prevent crossing barrels and gunhouses',()=>{
  const {definition:d,states}=fixture();
  states[1].elevation=radians(-2);
  const target={train:radians(-155),elevation:radians(29)};
  expect(mountPoseClear(d,0,target,states)).toBe(false);
  expect(moveMountWithClearance(d,0,states[0],target,states)).toBe(false);
  expect(mountPoseClear(d,0,states[0],states)).toBe(true);
  states[0]=createMountState(d.mounts[0]);states[1].train=radians(90);
  expect(mountPoseClear(d,0,target,states)).toBe(true);
});
test('half-degree preview steps can lower away after stopping beside an overhead platform',()=>{
  const {definition:d,states}=fixture(),i=d.mounts.findIndex(m=>m.id==='secondary-2'),s=states[i];
  const move=(train:number,elevation:number)=>{
    for(let pass=0;pass<1440;pass++) {
      const before={train:s.train,elevation:s.elevation};
      const next={train:s.train+clamp(train-s.train,-radians(.5),radians(.5)),elevation:s.elevation+clamp(elevation-s.elevation,-radians(.5),radians(.5))};
      if(!moveMountWithClearance(d,i,s,next,states)) {
        moveMountWithClearance(d,i,s,{train:next.train,elevation:s.elevation},states);
        moveMountWithClearance(d,i,s,{train:s.train,elevation:next.elevation},states);
      }
      expect(mountPoseClear(d,i,s,states)).toBe(true);
      if(Math.abs(s.train-before.train)+Math.abs(s.elevation-before.elevation)<1e-9) break;
    }
  };
  move(0,radians(85));
  expect(s.elevation).toBeLessThan(radians(70));
  move(radians(-90),s.elevation);
  move(s.train,radians(85));
  move(0,radians(85));
  expect(s.train).toBeLessThan(0);
  move(s.train,radians(1));
  expect(s.elevation).toBeCloseTo(radians(1),10);
  move(0,radians(1));
  expect(s.train).toBeCloseTo(0,10);
});
test('combat tracking uses the motion interlock and remains able to lower and turn away',()=>{
  const {definition:d,states}=fixture(),i=d.mounts.findIndex(m=>m.id==='secondary-2'),s=states[i],m=d.mounts[i];
  const pose={x:0,y:0,z:0,heading:0,roll:0,pitch:0};
  for (let tick=0;tick<400;tick++) {
    updateMount(m,s,d,pose,[m.position[0],1200,m.position[2]-400],1/60,[0,0,0],1,states);
    expect(mountPoseClear(d,i,s,states)).toBe(true);
  }
  expect(s.status).toBe('blocked');
  for (let tick=0;tick<700;tick++) updateMount(m,s,d,pose,[-2000,5,m.position[2]],1/60,[0,0,0],1,states);
  expect(s.train).toBeLessThan(radians(-80));
  expect(s.elevation).toBeLessThan(radians(15));
  expect(mountPoseClear(d,i,s,states)).toBe(true);
});
test('definitions without installed interlocks preserve existing actuator behavior',()=>{
  const {definition:d,states}=fixture();delete d.mountClearance;
  const target={train:radians(150),elevation:radians(60)};
  expect(moveMountWithClearance(d,0,states[0],target,states)).toBe(true);
  expect(states[0].train).toBe(target.train);expect(states[0].elevation).toBe(target.elevation);
});
