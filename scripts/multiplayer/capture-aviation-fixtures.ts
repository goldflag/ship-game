import { writeFile } from 'node:fs/promises';
import { shipPresets } from '../../src/ships/presets';
import { createShipState } from '../../src/simulation/ship';
import { createDamage } from '../../src/simulation/damage';
import { createMountState } from '../../src/simulation/weapons';
import { createAirWing, launchSquadron, recallAircraft, stepAircraft, type AirContext } from '../../src/simulation/aircraft';
import type { FleetActor } from '../../src/simulation/battle';
import type { CombatEvent } from '../../src/simulation/combat';
import { fixturePatches } from './fixture-patches';
const id=Object.keys(shipPresets).find(id=>shipPresets[id].airWing)!;
const definition=shipPresets[id];
const snapshot=(actors:FleetActor[],ctx:AirContext,events:unknown[])=>JSON.parse(JSON.stringify({wings:actors.map(a=>({ownerId:a.motion.id,state:a.airWing})),shells:ctx.shells,torpedoes:ctx.torpedoes,releases:ctx.releases,events}));
const cases=[];
for(const scenario of ['mixed','fighters','moving-recall','deck-loss']) {
 const actors=['carrier','opponent'].map((name,i)=>({definition,team:i?'enemy':'friendly',controller:'idle',motion:{...createShipState(name),z:i?-5000:0,heading:i?Math.PI:0},damage:createDamage(definition),mounts:definition.mounts.map(createMountState),airWing:createAirWing(definition,name,i?'enemy':'friendly')} as FleetActor));
 let sequence=1000;const events:Omit<CombatEvent,'sequence'|'tick'>[]=[];
 const ctx:AirContext={actors,planes:actors.flatMap(a=>a.airWing!.planes),shells:[],torpedoes:[],releases:[],seed:5739,nextId:()=>++sequence,emit:e=>events.push(e)};
 const initial=actors.map(a=>({motion:structuredClone(a.motion)})); const baseline=snapshot(actors,ctx,events);
 const squadrons=definition.airWing!.squadrons;
 const launched=[];
 for(const s of squadrons.filter(s=>scenario==='mixed'||s.role==='fighter'))launched.push(launchSquadron(actors[0],s.id,actors[1],undefined,actors));
 if(scenario==='fighters')launched.push(launchSquadron(actors[1],squadrons.find(s=>s.role==='fighter')!.id,actors[0],undefined,actors));
 const duration=scenario==='mixed'?750:scenario==='fighters'?240:scenario==='moving-recall'?600:60;
 const checkpoints=[];let time=0;
 for(let tick=1;tick<=duration*60;tick++){
  if(scenario==='moving-recall'){actors[0].motion.x+=.025;actors[0].motion.heading=.25;actors[0].motion.speed=1.5;if(tick===3901)recallAircraft(actors[0]);}
  if(scenario==='deck-loss'&&tick===61)actors[0].damage.sunk=true;
  stepAircraft(ctx,1/60,time);time+=1/60;
  if([1,60,600,3900,9300,14400,27000,36000,45000].includes(tick)||tick===duration*60)checkpoints.push({tick,sequence,patches:fixturePatches(baseline,snapshot(actors,ctx,events))});
 }
 cases.push({scenario,id,initial,baseline,launched,duration,checkpoints});
}
await writeFile('assets/gameplay/migration/aviation.v1.json',JSON.stringify({version:1,cases},(key,value)=>key==='team'?(value==='friendly'?'a':'b'):value)+'\n');
