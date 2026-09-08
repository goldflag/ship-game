(async()=>{
 const g=window.shokakuReview.game;
 g.setPaused(true);await new Promise(resolve=>setTimeout(resolve,150));
 const p=g.simulation.player,before={integrity:p.damage.integrity,waterM3:p.damage.compartments.reduce((n,c)=>n+c.waterM3,0),ammo:p.mounts.reduce((n,m)=>n+m.ammo,0)};
 const button=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Return to port'));
 if(!button)throw new Error('Use the normal Custom battle UI before the fixture so Return to port is available');
 button.click();await new Promise(resolve=>setTimeout(resolve,1500));
 const reset=g.simulation.player;
 const result={contentHash:g.definition.contentHash,fixture:'Normal pause menu Return to port button',before,inPort:g.inPort,paused:g.paused,integrity:reset.damage.integrity,maxIntegrity:reset.damage.maxIntegrity,waterM3:reset.damage.compartments.reduce((n,c)=>n+c.waterM3,0),ammo:reset.mounts.reduce((n,m)=>n+m.ammo,0),modulesRestored:reset.damage.modules.every((m,i)=>m.hp===g.definition.modules[i].hp),aircraft:reset.airWing.planes.reduce((n,p)=>({...n,[p.phase]:(n[p.phase]||0)+1}),{}),effects:g.diagnostics().effects};
 if(!result.inPort||result.integrity!==result.maxIntegrity||result.waterM3!==0||!result.modulesRestored||result.aircraft.ready!==72)throw new Error('Port reset incomplete');
 return result;
})()
