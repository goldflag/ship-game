(async()=>{
const h=window.shokakuGameplay,g=h.g;
g.setAirOperationsOpen(false);g.returnToShip();g.setInPort(true);g.setInPort(false);h.events.length=0;
// A deliberate broadside deployment keeps target range and weapon dimensions.
Object.assign(g.simulation.player.motion,{heading:Math.PI/2,speed:0});g.fleetViews.forEach(v=>v.snap());
g.battery='main';g.selectAmmunition('he',true);g.selectAim('');
g.currentAim=g.simulation.aimAt('',g.battery,g.weaponGroupId);
const before=g.simulation.player.mounts.reduce((n,m)=>n+m.ammo,0),start=h.events.length;
for(let i=0;i<12&&!g.diagnostics().combat.ready;i++)await h.advance(5);
g.fire();await h.advance(1);
const shots=h.events.slice(start).filter(e=>e.kind==='shot'&&e.shipId==='player');
if(!shots.length)throw new Error('No 127 mm surface shot: '+JSON.stringify({result:g.simulation.result,ready:g.diagnostics().combat.ready}));
await h.advance(12);
return {contentHash:g.definition.contentHash,fixture:'Player at broadside to static Bismarck; HE selected through Game command, normal fire queue and projectile simulation.',before,after:g.simulation.player.mounts.reduce((n,m)=>n+m.ammo,0),shots,events:h.events.slice(start),state:h.state('surface-fire'),muzzleErrorM:g.diagnostics().maxMuzzleErrorM};
})()
