(async()=>{
const g=window.shokakuReview.game;g.setInPort(true);g.setInPort(false);
const sim=g.simulation,victim=sim.player,{localToWorld,rotate}=await import('/src/simulation/geometry.ts');
const {aircraftTorpedo}=await import('/src/simulation/aircraftWeapons.ts');
const events=[],emit=sim.emit;sim.emit=e=>{events.push({...structuredClone(e),tick:sim.tick});emit(e);};
const before=victim.damage.integrity,weapon=aircraftTorpedo('b5n2-kate');
sim.torpedoes.push({id:900010,ownerId:sim.target.motion.id,tubeId:'review-armed-torpedo',position:localToWorld([30,-3.7,-15],victim.motion),velocity:rotate([-weapon.speed,0,0],victim.motion),distance:400,age:0,weapon:{...weapon,runningDepthM:3.7}});
const shellIds=[];
for(let i=0;i<3;i++){
 const id=900000+i;shellIds.push(id);
 sim.shells.push({id,ownerId:sim.target.motion.id,weaponLabel:'203 mm AP review shot',position:localToWorld([35,6.5+i*.3,-14+i],victim.motion),velocity:rotate([-850,0,0],victim.motion),age:0,penetrationMm:1000,damage:85,caliberM:.2032,visited:[],ammunition:'ap'});
}
g.previewAdvance(2);await new Promise(resolve=>setTimeout(resolve,150));
g.previewAdvance(30);await new Promise(resolve=>setTimeout(resolve,150));
await window.shokakuReview.camera(1.12,.27,270);
const after=victim.damage.integrity,water=victim.damage.compartments.reduce((n,c)=>n+c.waterM3,0),modules=victim.damage.modules.filter(m=>m.hp<g.definition.modules.find(d=>d.id===m.id).hp);
const result={contentHash:g.definition.contentHash,fixture:'One armed Type 91 review torpedo seeded 30 m off the centerline at 3.7 m depth through the boiler region, plus three above-water swept 203 mm AP projectiles. Torpedo depth is a fixture override. No HP, breach or flooding state assigned directly.',before,after,waterM3:water,modules,compartments:victim.damage.compartments.filter(c=>c.breachAreaM2>0||c.waterM3>0),events,shellIds,muzzleErrorM:g.diagnostics().maxMuzzleErrorM,effects:g.diagnostics().effects,result:after<before&&water>0&&modules.length>0?'pass':'fail'};
window.shokakuDamageResult=result;return result;
})()
