/** Deliberately refreshed reference output from the existing renderer-free simulation. */
import { writeFile } from 'node:fs/promises';
import { shipPresets, shipPreset } from '../../src/ships/presets';
import { createShipState } from '../../src/simulation/ship';
import { createDamage, updateFlooding, type Combatant } from '../../src/simulation/damage';
import { createMountState } from '../../src/simulation/weapons';
import { addBreach } from '../../src/simulation/breaches';
import { damageHull } from '../../src/simulation/durability';
import { updateDamageControl } from '../../src/simulation/damageControl';
import { createSubmarineState, stepSubmarine } from '../../src/simulation/submarine';
import { supportPerformance, systemHealth } from '../../src/simulation/machinery';
const snapshot = (actor:Combatant) => ({ motion: actor.motion, submarine: actor.submarine, damage: {...actor.damage, stability:{...actor.damage.stability,water:undefined}}, mounts:actor.mounts.map(({id,hp,ammo,heAmmo})=>({id,hp,ammo,heAmmo})) });
const cases = Object.keys(shipPresets).map(id => {
 const def=shipPreset(id), actor:Combatant={motion:createShipState(id),mounts:def.mounts.map(createMountState),damage:createDamage(def),submarine:def.submarine?createSubmarineState():undefined};
 actor.motion.roll=.13;actor.motion.pitch=-.01;actor.motion.speed=4;
 const room=def.compartments[0];
 if(room){actor.damage.compartments[0].waterM3=room.capacityM3*.17;const position:[number,number,number]=[room.center[0],-def.hull.draft*.7,room.center[2]];addBreach(actor.damage.compartments[0],position,.06,1);addBreach(actor.damage.compartments[0],[position[0],position[1]+.08,position[2]],.08,2);}
 if(actor.damage.control.rooms[1])actor.damage.control.rooms[1].heat=1.2;
 if(actor.damage.control.mounts[0])actor.damage.control.mounts[0].heat=1.1;
 if(actor.damage.modules[0])actor.damage.modules[0].hp*=.7;
 const region=actor.damage.regions[0]?.id;damageHull(actor,1400,region);damageHull(actor,.001,region);
 const checkpoints:unknown[]=[];
 for(let tick=1;tick<=600;tick++){
  if(tick===181){actor.damage.control.priority='flooding';actor.damage.control.focus=room?.id??'';}
  updateDamageControl(actor,def,1/60,()=>{});updateFlooding(actor,def,1/60);stepSubmarine(actor,def,{throttle:0,rudder:0,depthM:tick<301?12:0,emergencyBlow:tick>=301},1/60);
  if([1,60,180,300,600].includes(tick))checkpoints.push(JSON.parse(JSON.stringify({tick,...snapshot(actor),support:supportPerformance(actor,def),engine:systemHealth(actor,def,'engine')})));
 }
 return {id,checkpoints};
});
await writeFile('assets/gameplay/migration/damage.v1.json',JSON.stringify({version:1,cases})+'\n');
