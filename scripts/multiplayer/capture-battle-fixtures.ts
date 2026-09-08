import { writeFile } from 'node:fs/promises';
import { shipPresets,shipPreset } from '../../src/ships/presets';
import { CombatSimulation } from '../../src/simulation/combat';
import { weaponGroupId } from '../../src/ships/weaponGroups';
import { fixturePatches } from './fixture-patches';
const snapshot=(s:CombatSimulation)=>JSON.parse(JSON.stringify({tick:s.tick,actors:s.actors.map(a=>({motion:a.motion,mounts:a.mounts,damage:{...a.damage,stability:{...a.damage.stability,water:undefined}},helm:a.helm,targetId:a.targetId,bot:a.bot,submarine:a.submarine,torpedoTubes:a.torpedoTubes,launcherTrains:Object.fromEntries((a.torpedoLaunchers??[]).map(l=>[l.id,l.train])),depthChargeLaunchers:a.depthChargeLaunchers,tubeLaunchCooldown:a.tubeLaunchCooldown,depthChargeCooldown:a.depthChargeCooldown})),wings:s.actors.filter(a=>a.airWing).map(a=>({ownerId:a.motion.id,state:a.airWing})),shells:s.shells,torpedoes:s.torpedoes,depthCharges:s.depthCharges,releases:s.airReleases,outcome:s.outcome,events:s.events,score:{damageDealt:s.telemetry('main',[0,0,0]).playerDamageDealt,frags:s.telemetry('main',[0,0,0]).playerFrags,damageLog:s.telemetry('main',[0,0,0]).damageLog},shellHistory:s.shellHistory}));
const cases=[];
for(const [id,enemy,duration,battery] of [['bismarck','baltimore',60,'main'],['fletcher','type-viic',60,'torpedo'],['enterprise-cv6','enterprise-cv6',180,'main'],['shokaku','enterprise-cv6',180,'main']] as const){
 const sim=new CombatSimulation(shipPreset(id),{friendlyBots:[],enemies:[shipPreset(enemy)],spawnDistance:5000,mapId:'north-atlantic',weather:'clear',seed:5739});
 const setup={ships:sim.actors.map(a=>({id:a.motion.id,presetId:a.definition.id,team:a.team==='friendly'?'a':'b',controller:a.controller,aiLevel:a.bot?.aiLevel??'normal',spawn:{x:a.motion.x,z:a.motion.z,heading:a.motion.heading}})),seed:sim.seed,mapId:sim.mapId,weather:'clear',spawnDistance:5000,windSpeed:undefined};
 const baseline=snapshot(sim),checkpoints=[],aims=[];
 if(sim.definition.airWing)for(const s of sim.definition.airWing!.squadrons)sim.launchAircraft(s.id);
 for(let tick=1;tick<=duration*60;tick++){
  const aim=sim.aimAt(undefined,battery);aims.push(aim);const helm={throttle:.6,rudder:tick<900?.4:0,depthM:undefined};sim.step(helm,{aim,fire:true,battery,ammunition:tick<1200?'ap':'he'});
  if([1,60,600,1200,2400,3600,7200,10800].includes(tick))checkpoints.push({tick,patches:fixturePatches(baseline,snapshot(sim))});
 }
 cases.push({id,setup,baseline,duration,battery,checkpoints,aims});
}
const groups=Object.entries(shipPresets).map(([id,d])=>({id,groups:d.mounts.map(m=>weaponGroupId(m.battery,m.weapon))}));
await writeFile('assets/gameplay/migration/battles.v1.json',JSON.stringify({version:1,cases,groups},(key,value)=>key==='team'?(value==='friendly'?'a':value==='enemy'?'b':value):value)+'\n');
