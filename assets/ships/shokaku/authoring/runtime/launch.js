/* Development review fixture; see ../README.md. */
(async()=>{
const r=window.shokakuReview,g=r.game,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const deadline=performance.now()+60000;
while(g.inPort||g.switchingShip){if(performance.now()>deadline)throw new Error('Battle did not load');await sleep(150);}
g.simulation.actors.forEach(a=>{if(a!==g.simulation.player){a.controller='bot';a.bot.aiLevel='static';}a.motion.speed=0;});
g.input.setOrder(1);g.input.setRudder(0);
const events=[],emit=g.simulation.emit;
g.simulation.emit=event=>{if(events.length<20000)events.push({...structuredClone(event),tick:g.simulation.tick});emit(event);};
const {squadronFlights}=await import('/src/simulation/aircraft.ts');
const rows=[];
function state(label){const d=g.diagnostics();const row={label,tick:d.tick,hash:d.contentHash,aircraft:d.renderedAircraft,fleet:d.fleet,phases:Object.fromEntries([...new Set(g.simulation.player.airWing.planes.map(p=>p.phase))].map(k=>[k,g.simulation.player.airWing.planes.filter(p=>p.phase===k).length]))};rows.push(row);return row;}
async function advance(seconds){g.previewAdvance(seconds);await sleep(100);g.renderFrame();}
window.shokakuGameplay={g,events,rows,state,advance,squadronFlights};
state('mixed-fleet-loaded');
if(g.aircraftView.diagnostics().models!==18)throw new Error('Mixed fleet must load six models at three LODs');
for(const pool of g.definition.airWing.squadrons){const f=squadronFlights(g.simulation.player).find(f=>f.squadronId===pool.id);if(!g.commandSquadron(f.id,{kind:'patrol',point:[1000,0,-1800]}))throw new Error('Launch rejected '+pool.id);}
await advance(6);state('deck-launch');await advance(34);state('three-roles-airborne');
const airborne=g.simulation.player.airWing.planes.filter(p=>p.phase==='outbound');
if(airborne.length!==18)throw new Error('Expected 18 outbound, got '+airborne.length);
g.followAircraft(airborne.find(p=>p.modelId==='a6m2-zero').id);await sleep(300);
return {rows,launched:events.filter(e=>e.kind==='aircraft-launch').length};
})()
