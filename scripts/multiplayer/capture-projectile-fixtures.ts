import { writeFile } from 'node:fs/promises';
import { shipPresets, shipPreset } from '../../src/ships/presets';
import { createShipState } from '../../src/simulation/ship';
import { createDamage, type Shell } from '../../src/simulation/damage';
import { createMountState } from '../../src/simulation/weapons';
import { advanceProjectile } from '../../src/simulation/projectile';
import type { FleetActor } from '../../src/simulation/battle';
import { fixturePatches } from './fixture-patches';
const snapshot=(actor:FleetActor)=>JSON.parse(JSON.stringify({damage:{...actor.damage,stability:undefined},mounts:actor.mounts.map(({hp,ammo,heAmmo})=>({hp,ammo,heAmmo}))}));
const cases=Object.keys(shipPresets).map(id=>{const def=shipPreset(id);const create=()=>({definition:def,motion:createShipState(id),damage:createDamage(def),mounts:def.mounts.map(createMountState)} as FleetActor);const baseline=snapshot(create());return{id,baseline,shots:[0,1,2,3].map(mode=>{
 const actor=create();const shell:Shell={id:mode+1,ownerId:'other',position:mode===2?[-def.hull.beam-15,1.5,.137]:[-def.hull.beam/2-2,mode===3?def.hull.depth*3:1.5,.137],velocity:mode===2?[650,-160,0]:[800,mode===3?-5:0,0],age:0,penetrationMm:mode===1?0:750,damage:200,caliberM:.38,visited:[],ammunition:mode===1?'he':'ap',dragPerSecond:.001,ap:mode!==1?{armingResistanceMm:25,fuzeDelaySeconds:.035,explosiveKg:8,fragmentPenetrationMm:32,basis:'Migration fixture'}:undefined,he:mode===1?{explosiveKg:40,fragmentPenetrationMm:30,damage:280,stockFraction:.5,basis:'Migration fixture'}:undefined};
 const initial=structuredClone(shell),events:unknown[]=[];let end:ReturnType<typeof advanceProjectile>;let ticks=0;while(ticks<360&&!end){ticks++;end=advanceProjectile(shell,[actor],1/60,e=>events.push(e));}return{initial,ticks,end:end??null,shell,events,patches:fixturePatches(baseline,snapshot(actor))};
})};});
await writeFile('assets/gameplay/migration/projectiles.v1.json',JSON.stringify({version:1,cases})+'\n');
