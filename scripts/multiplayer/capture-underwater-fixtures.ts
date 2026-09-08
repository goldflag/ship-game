import { writeFile } from 'node:fs/promises';
import { shipPresets,shipPreset } from '../../src/ships/presets';
import { createShipState } from '../../src/simulation/ship';
import { createDamage } from '../../src/simulation/damage';
import { createMountState } from '../../src/simulation/weapons';
import { createTubeState,trainTorpedoLaunchers,tubeSolution,firstTorpedoHit,damageUnderwaterBlast,damageTorpedoHit,type Torpedo } from '../../src/simulation/torpedoes';
import { createSubmarineState } from '../../src/simulation/submarine';
import { stepDepthCharge,depthChargeReach,type DepthCharge } from '../../src/simulation/depthCharges';
import type { FleetActor } from '../../src/simulation/battle';
import { fixturePatches } from './fixture-patches';
const torpedo=Object.values(shipPresets).flatMap(d=>d.torpedoTubes??[])[0].weapon;
const charge=Object.values(shipPresets).flatMap(d=>d.depthChargeLaunchers??[])[0].weapon;
const snapshot=(actor:FleetActor)=>JSON.parse(JSON.stringify({damage:{...actor.damage,stability:undefined}}));
const cases=Object.keys(shipPresets).map(id=>{const def=shipPreset(id);const actor={definition:def,team:'friendly',controller:'player',motion:createShipState(id),damage:createDamage(def),mounts:def.mounts.map(createMountState),torpedoTubes:def.torpedoTubes?.map(createTubeState),torpedoLaunchers:def.torpedoLaunchers?.map(l=>({id:l.id,train:0})),submarine:def.submarine?createSubmarineState():undefined} as FleetActor;
 const baseline=snapshot(actor);actor.motion.heading=.4;actor.motion.roll=.11;
 const aim:[number,number,number]=[4000,0,-3000];let solutions:unknown[]=[];for(let tick=0;tick<120;tick++){trainTorpedoLaunchers(actor,()=>aim,1/60);solutions=def.torpedoTubes?.map((t,i)=>tubeSolution(actor,t,actor.torpedoTubes![i],aim,1/60))??[];}
 const shots=[-.6,.137,def.hull.length*.3+.137].map(z=>{const from:[number,number,number]=[-def.hull.beam,-def.hull.draft*.65,z],to:[number,number,number]=[def.hull.beam,-def.hull.draft*.65,z];const t:Torpedo={id:1,ownerId:'other',tubeId:'fixture',position:from,velocity:[30,0,0],age:0,distance:0,weapon:torpedo};const hit=firstTorpedoHit(t,from,to,[actor]);return{from,to,hit:hit?{point:hit.point,t:hit.t}:null};});
 const point:[number,number,number]=[def.hull.beam*.4,-def.hull.draft*.6,.137];const message=damageUnderwaterBlast(actor,point,{damage:430,breachAreaM2:.5},'Fixture hit',1);
 const positions:[[number,number,number],[number,number,number]]=[[0,-30,.137],[def.hull.beam,-5,def.hull.length*.7]];
 const torpedoHits = [...(def.underwaterProtection?.zones.map(z => z.center) ?? []), [0,-def.hull.draft*.6,def.hull.length*.4] as [number,number,number]].map(point => {
  const target={...actor,damage:createDamage(def),mounts:def.mounts.map(createMountState)};
  const shot:Torpedo={id:7,ownerId:'other',tubeId:'fixture',position:point,velocity:[30,0,0],age:1,distance:500,weapon:torpedo};
  const message=damageTorpedoHit(shot,target,point);
  return {point,message,patches:fixturePatches(baseline,snapshot(target))};
 });
 return{id,baseline,torpedoHits,motion:actor.motion,aim,solutions,tubes:actor.torpedoTubes??[],trains:actor.torpedoLaunchers??[],shots,point,message,patches:fixturePatches(baseline,snapshot(actor)),reaches:positions.map(position=>({position,result:depthChargeReach(position,actor)}))};});
const charges=[.01,1,10,30].map(dt=>{const c:DepthCharge={id:1,ownerId:'fixture',launcherId:'fixture',position:[0,3,0],velocity:[2,4,-8],age:0,submerged:false,weapon:charge};const initial=structuredClone(c),result=stepDepthCharge(c,dt);return{initial,dt,result,charge:c};});
await writeFile('assets/gameplay/migration/underwater.v1.json',JSON.stringify({version:1,cases,charges,torpedo})+'\n');
