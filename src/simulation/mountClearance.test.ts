import { expect, test } from 'bun:test';
import blueprint from '../../assets/ships/cleveland/blueprint.json';
import catalog from '../../assets/parts/guns.json';
import { compileShip, type ShipBlueprint } from '../ships/blueprint';
import { mountPoseClear, moveMountWithClearance } from './mountClearance';
import { createMountState, updateMount } from './weapons';
import { radians } from './geometry';
const fixture=()=>{
  const definition=compileShip(structuredClone(blueprint) as unknown as ShipBlueprint,catalog);
  return {definition,states:definition.mounts.map(createMountState)};
};
test('installation interlocks validate references and positive envelope dimensions',()=>{
  const b=structuredClone(blueprint) as unknown as ShipBlueprint;
  b.mountClearance!.neighbors[0]=['main-1','missing'];
  expect(()=>compileShip(b,catalog)).toThrow('selected mount pairs');
  b.mountClearance!.neighbors[0]=['main-1','main-2'];
  b.mountClearance!.mounts[0].body!.size[1]=0;
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
