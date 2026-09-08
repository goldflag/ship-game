import { writeFile } from 'node:fs/promises';
import { shipPresets, shipPreset } from '../../src/ships/presets';
import { createShipState } from '../../src/simulation/ship';
import { createDamage, shipContacts, type Combatant, type Shell } from '../../src/simulation/damage';
import { createMountState } from '../../src/simulation/weapons';
import { localToWorld } from '../../src/simulation/geometry';
import { plateResponse } from '../../src/simulation/protection';
const cases=Object.keys(shipPresets).map(id=>{const def=shipPreset(id);const actor:Combatant={motion:createShipState(id),mounts:def.mounts.map(createMountState),damage:createDamage(def)};Object.assign(actor.motion,{x:21,z:-30,y:-.3,heading:.71,roll:.13,pitch:-.02});actor.mounts.forEach((m,i)=>m.train=.13*(i%3));const shell:Shell={id:1,ownerId:'other',position:[0,0,0],velocity:[800,0,0],age:0,penetrationMm:800,damage:120,caliberM:.38,visited:[]};
// Offset general migration probes from exact triangulation seams. Dedicated seam tests use exact local geometry.
const rays=Array.from({length:9},(_,i)=>({from:[-def.hull.beam*2,-def.hull.draft*.6+(i%3)*def.hull.depth*.45,(Math.floor(i/3)-1)*def.hull.length*.3+.137] as [number,number,number],to:[def.hull.beam*2,-def.hull.draft*.6+(i%3)*def.hull.depth*.45,(Math.floor(i/3)-1)*def.hull.length*.3+.137] as [number,number,number]}));rays.push({from:[.123,def.hull.depth*3,.157],to:[.123,-def.hull.draft*3,.157]});
return{id,motion:actor.motion,trains:actor.mounts.map(m=>m.train),rays:rays.map(r=>{const from=localToWorld(r.from,actor.motion),to=localToWorld(r.to,actor.motion);return{from,to,hits:shipContacts(shell,from,to,actor,def).map(({t,key,kind,index,point,normal,onEdge,seamKeys})=>({t,key,kind,index,point,normal,onEdge:!!onEdge,seamKeys:seamKeys??[]}))};})};});
const responses=[0,3,20,100,400].flatMap(thickness=>['steel','KC','Ww','teak'].flatMap(material=>[0,.01,.1,.5,1].map(cosine=>({thickness,material,cosine,result:plateResponse(thickness,material,cosine,.38)}))));
await writeFile('assets/gameplay/migration/contacts.v1.json',JSON.stringify({version:1,cases,responses})+'\n');
