(async()=>{
const g=window.shokakuReview.game;
g.setInPort(true);await g.prepareBattle({playerShipId:'shokaku',friendlyBots:[],enemies:[{shipId:'enterprise-cv6',aiLevel:'static'}],spawnDistance:1000,windSpeed:0});g.setInPort(false);
const sim=g.simulation,events=[],emit=sim.emit;sim.emit=e=>{events.push({...structuredClone(e),tick:sim.tick});emit(e);};
const planes=sim.target.airWing.planes.slice(0,6),before=sim.player.mounts.map(m=>m.ammo);
g.input.setOrder(1);g.input.setRudder(0);
for(let tick=0;tick<1200;tick++){
 g.battery=tick<600?'main':'secondary';
 planes.forEach((p,i)=>Object.assign(p,{phase:'outbound',hp:10000,position:[550+i*15,160+i*7,-50+i*20],previousPosition:[550+i*15,160+i*7,-50+i*20],velocity:[0,0,0],heading:0,pitch:0,bank:0}));
 sim.step({throttle:0,rudder:0},{aim:[0,0,-1000],battery:g.battery,weaponGroupId:g.weaponGroupId,fire:false});
 if(tick%120===0){g.fleetViews.forEach(v=>v.snap());await new Promise(resolve=>setTimeout(resolve,0));}
}
g.fleetViews.forEach(v=>v.snap());await window.shokakuReview.camera(1.15,.40,650);
const spent=sim.player.mounts.map((m,i)=>({id:g.definition.mounts[i].id,caliber:g.definition.mounts[i].weapon.caliberM,spent:before[i]-m.ammo}));
if(!spent.some(m=>m.caliber===.025&&m.spent>0)||!spent.some(m=>m.caliber===.127&&m.spent>0))throw new Error('Both AA groups must fire');
window.shokakuAA={events,spent};
return {contentHash:g.definition.contentHash,fixture:'Actual mixed-carrier battle. Six enemy aircraft held in a documented airborne test volume; 10 seconds with each gun group unselected so both use automatic AA. HP raised only on these test aircraft to retain the target volume.',spent,events:events.filter(e=>e.kind==='aircraft-fire'&&e.shipId==='player'),muzzleErrorM:g.diagnostics().maxMuzzleErrorM,rendered:g.aircraftView.diagnostics()};
})()
