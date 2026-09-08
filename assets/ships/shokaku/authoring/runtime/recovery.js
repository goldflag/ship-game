(async()=>{
const h=window.shokakuGameplay,g=h.g;
const precedingSortie=h.state('preceding-sortie');
for(const a of g.simulation.actors)if(a!==g.simulation.player){a.controller='bot';a.bot.aiLevel='static';}
g.setInPort(true);g.setInPort(false);h.events.length=0;h.rows.length=0;
g.input.setOrder(1);g.input.setRudder(0);
h.state('passive-target-reset');
for(const pool of g.definition.airWing.squadrons){const f=h.squadronFlights(g.simulation.player).find(f=>f.squadronId===pool.id);if(!g.commandSquadron(f.id,{kind:'patrol',point:[1000,0,-1800]}))throw new Error('Launch rejected');}
await h.advance(40);const launched=h.state('passive-three-roles-airborne');
if(launched.phases.outbound!==18)throw new Error('Expected 18 aircraft');
g.recallAircraft();
for(let i=0;i<16;i++){
 await h.advance(60);h.state('passive-recovery-'+(i+1)*60);
 if(g.simulation.player.airWing.planes.every(p=>p.phase==='ready'))break;
}
const recovered=h.events.filter(e=>e.kind==='aircraft-recovered'&&e.shipId==='player');
const final=h.state('passive-recovered-and-serviced');
if(recovered.length!==18||final.phases.ready!==72)throw new Error('Incomplete recovery: '+JSON.stringify({recovered:recovered.length,phases:final.phases,result:g.simulation.result}));
return {contentHash:g.definition.contentHash,fixture:'Normal custom battle with Shokaku, Enterprise and Bismarck; reset and set both bots to existing Static target behavior for uninterrupted recovery.',precedingSortie,launched,recovered:recovered.length,final,rows:h.rows};
})()
