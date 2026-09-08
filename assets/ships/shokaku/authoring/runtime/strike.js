(async()=>{
const h=window.shokakuGameplay,g=h.g,start=h.events.length,payloads=[],original=g.simulation.emit;
g.returnToShip();
g.simulation.emit=event=>{
 if(event.shipId==='player'&&event.kind==='bomb-release'){
  const shell=g.simulation.shells.find(s=>s.id===event.shell.id);
  payloads.push({kind:'bomb',tick:g.simulation.tick,label:shell?.weaponLabel,he:shell?.he});
 }
 if(event.shipId==='player'&&event.kind==='torpedo-launch'){
  const torpedo=g.simulation.torpedoes.find(t=>t.id===event.torpedo.id);
  if(torpedo?.tubeId==='aircraft.payload')payloads.push({kind:'torpedo',tick:g.simulation.tick,weapon:torpedo.weapon,velocity:torpedo.velocity});
 }
 original(event);
};
g.launchAircraft('shokaku-dive');g.launchAircraft('shokaku-torpedo');
for(let i=0;i<20;i++){
 await h.advance(30);h.state('strike-'+(i+1)*30);
 if(payloads.some(p=>p.kind==='bomb')&&payloads.some(p=>p.kind==='torpedo'))break;
}
g.simulation.emit=original;
if(!payloads.some(p=>p.label==='Type 99 No. 25 250 kg bomb'&&p.he?.explosiveKg===60))throw new Error('No Japanese bomb release');
if(!payloads.some(p=>p.weapon?.id==='type91-mod2-game'&&Math.abs(Math.hypot(...p.velocity)-42*1852/3600)<1e-6))throw new Error('No correct Type 91 release');
g.setAirOperationsOpen(true);await new Promise(resolve=>setTimeout(resolve,250));
return {contentHash:g.definition.contentHash,payloads,events:h.events.slice(start),state:h.state('Japanese-strike-released'),ui:document.body.innerText.slice(-15000)};
})()
