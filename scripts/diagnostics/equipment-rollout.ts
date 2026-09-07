/** Definition rollout comparison in the same runtime; no historical balance claim.
 * Run: bun scripts/diagnostics/equipment-rollout.ts <baseline-commit> */
import { readFile } from 'node:fs/promises';
import { compileShip, type ShipDefinition } from '../../src/ships/blueprint';
import { shipPresets } from '../../src/ships/presets';
import { CombatSimulation } from '../../src/simulation/combat';
import { updateAntiAircraft } from '../../src/simulation/antiAircraft';
import type { AirContext } from '../../src/simulation/aircraft';
import { equipmentCondition } from '../../src/simulation/machinery';
const baseline=process.argv[2];
if(!baseline || !/^[a-f0-9]{7,40}$/.test(baseline)) throw new Error('Supply the baseline commit hash.');
const catalog=JSON.parse(await readFile('assets/parts/guns.json','utf8'));
const before=new Map<string,ShipDefinition>(),after=new Map<string,ShipDefinition>();
for(const id of Object.keys(shipPresets)) {
  const child=Bun.spawn(['git','show',`${baseline}:public/models/${id}.json`],{stdout:'pipe',stderr:'pipe'});
  const data=await new Response(child.stdout).text();if(await child.exited)throw new Error(await new Response(child.stderr).text());
  before.set(id,JSON.parse(data));after.set(id,compileShip(JSON.parse(await readFile(`assets/ships/${id}/blueprint.json`,'utf8')),catalog));
}
function aa(def:ShipDefinition,carrier:ShipDefinition,seed:number) {
  let shots=0,losses=0,damage=0;const timings:number[]=[];
  for(const bearing of [0,Math.PI/2,Math.PI,-Math.PI/2]) {
    const sim=new CombatSimulation(def,{friendlyBots:[],enemies:[carrier],seed}),actor=sim.player,plane=sim.target.airWing!.planes[0];
    Object.assign(actor.motion,{x:0,y:0,z:0,heading:0,pitch:0,roll:0});
    Object.assign(plane,{phase:'outbound',hp:100,position:[700*Math.sin(bearing),250,-700*Math.cos(bearing)],velocity:[0,0,0]});
    let id=0;const ctx:AirContext={seed,actors:sim.actors,planes:[plane],shells:[],torpedoes:[],releases:[],nextId:()=>++id,emit:()=>shots++};
    for(let tick=0;tick<600;tick++) {
      const hp=plane.hp,start=performance.now();
      def.mounts.forEach((m,i)=>updateAntiAircraft(actor,m,actor.mounts[i],ctx,1/60));
      timings.push(performance.now()-start);damage+=hp-Math.max(0,plane.hp);
      if(plane.hp<=0){losses++;plane.hp=100;}
    }
  }
  timings.sort((a,b)=>a-b);
  return {shots,damage,stationaryTargetLosses:losses,medianGunLoopMs:timings[Math.floor(timings.length*.5)],p95GunLoopMs:timings[Math.floor(timings.length*.95)]};
}
function duel(attacker:ShipDefinition,target:ShipDefinition,seed:number) {
  const sim=new CombatSimulation(attacker,{friendlyBots:[],enemies:[target],spawnDistance:5000,seed});
  sim.target.controller='idle';Object.assign(sim.player.motion,{x:0,z:0,heading:0});Object.assign(sim.target.motion,{x:5000,z:0,heading:0});
  let tick=0,shots=0,sequence=0;const equipmentHits:Record<string,{hits:number;damage:number;firstSecond:number}>={};
  for(;tick<36000;tick++) {
    const m=target.mounts.find((m,i)=>sim.target.mounts[i].hp>0&&(!m.magazineId||equipmentCondition(sim.target,target,m.magazineId).availability>0));
    sim.step({throttle:0,rudder:0},{aim:sim.aimAt(m?`mount:${m.id}`:undefined),fire:true,battery:'main'});
    for(const e of sim.events)if(e.sequence>sequence){sequence=e.sequence;if(e.kind==='shot'&&e.shipId==='player')shots++;if(e.shipId===sim.target.motion.id&&e.impact?.kind==='module'&&e.impact.targetId.startsWith('equipment-')){const entry=equipmentHits[e.impact.targetId]??={hits:0,damage:0,firstSecond:tick/60};entry.hits++;entry.damage+=e.impact.damage??0;}}
    if(sim.target.damage.sunk||sim.target.damage.stability.combatLost)break;
  }
  return {equipmentHits,seconds:Math.min(600,(tick+1)/60),shots,defeatCause:sim.target.damage.defeatCause??null,hullFraction:sim.target.damage.integrity/sim.target.damage.maxIntegrity,disabledGuns:sim.target.mounts.filter(m=>m.hp<=0).length};
}
console.log(JSON.stringify({fixture:'Same runtime, old/new definitions; AA has one stationary replacement target per kill in each of four sectors for ten seconds. CPU timings exclude render/flooding. Duel is normal turret-aim gunnery at 5 km with idle target, capped at 600 seconds.',baseline,seed:93,acceptance:'No loss of healthy registered AA firing. Local-control penalty <=1.5 mrad. Investigate >25% gun-loop or >20% duel-duration change; do not tune hull HP.'}));
for(const id of ['bismarck','yamato','king-george-v','baltimore','enterprise-cv6','fletcher'])console.log(JSON.stringify({kind:'AA',ship:id,before:aa(before.get(id)!,before.get('enterprise-cv6')!,93),after:aa(after.get(id)!,after.get('enterprise-cv6')!,93)}));
for(const id of ['bismarck','baltimore','yamato'])console.log(JSON.stringify({kind:'duel',target:id,before:duel(before.get('bismarck')!,before.get(id)!,93),after:duel(after.get('bismarck')!,after.get(id)!,93)}));
