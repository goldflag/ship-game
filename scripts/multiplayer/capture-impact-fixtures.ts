import { fixturePatches } from './fixture-patches';
import { writeFile } from 'node:fs/promises';
import { shipPreset } from '../../src/ships/presets';
import { createDamage, hitShip, type Combatant, type Shell, type DamageEvent } from '../../src/simulation/damage';
import { createMountState } from '../../src/simulation/weapons';
import { normalize, scale, sub } from '../../src/simulation/geometry';
const contacts=await Bun.file('assets/gameplay/migration/contacts.v1.json').json();
const cases=contacts.cases.map((c:any)=>{const def=shipPreset(c.id);const baseline=JSON.parse(JSON.stringify({damage:{...createDamage(def),stability:undefined},mounts:def.mounts.map(createMountState).map(({hp,ammo,heAmmo})=>({hp,ammo,heAmmo}))}));return{id:c.id,motion:c.motion,trains:c.trains,baseline,rays:c.rays.flatMap((ray:any,ri:number)=>['ap','he','inert'].map(ammunition=>{
 const actor:Combatant={motion:{...c.motion},damage:createDamage(def),mounts:def.mounts.map(createMountState)};actor.mounts.forEach((m,i)=>m.train=c.trains[i]);
 const shell:Shell={id:ri+1,ownerId:'other',position:ray.from,velocity:scale(normalize(sub(ray.to,ray.from)),800),age:0,penetrationMm:ammunition==='he'?0:ri%2?40:800,damage:200,caliberM:.38,visited:[],ammunition:ammunition==='he'?'he':'ap',ap:ammunition==='ap'?{armingResistanceMm:25,fuzeDelaySeconds:.035,explosiveKg:8,fragmentPenetrationMm:32,basis:'Migration fixture'}:undefined,he:ammunition==='he'?{explosiveKg:40,fragmentPenetrationMm:30,damage:280,stockFraction:.5,basis:'Migration fixture'}:undefined};
 const initial=structuredClone(shell),events:DamageEvent[]=[];const stopped=hitShip(shell,ray.from,ray.to,actor,def,e=>events.push(e));
 const result=JSON.parse(JSON.stringify({damage:{...actor.damage,stability:undefined},mounts:actor.mounts.map(({hp,ammo,heAmmo})=>({hp,ammo,heAmmo}))}));return{from:ray.from,to:ray.to,initial,stopped,shell,events,patches:fixturePatches(baseline,result)};
}))};});
await writeFile('assets/gameplay/migration/impacts.v1.json',JSON.stringify({version:1,cases})+'\n');
