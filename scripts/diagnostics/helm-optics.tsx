// Development-only review of the real HUD, camera and GPU ocean. No production controls.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { Vector2 } from 'three/webgpu';
import { Game } from '../../src/game/Game';
import { FleetHud } from '../../src/ui/FleetHud';
import { ShipContext } from '../../src/ui/ShipContext';
import { shipPreset } from '../../src/ships/presets';
import { defaultKeybindings } from '../../src/game/keybindings';
import '../../src/ui/styles.css';
import '../../src/ui/ShipLabels.css';
import '@fontsource/barlow/latin-400.css';
import '@fontsource/barlow/latin-500.css';
import '@fontsource/barlow-condensed/latin-500.css';
import '@fontsource/barlow-condensed/latin-600.css';

const host = document.createElement('div'); host.className = 'ocean-viewport'; document.body.appendChild(host);
const hud = document.createElement('div'); document.body.appendChild(hud);
const root = createRoot(hud), noop = () => {};
const definition = shipPreset('type-viic');
const game: any = new Game(host, {quality:'high',sea:'Atlantic',resolution:1}, { progress:noop,ready:noop,pause:noop,hud:noop,telemetry:noop,error:message=>{window.reviewError=message;} }, definition);
game.scheduleFrame=noop; game.setInPort(true); game.start();
await game.initialization;
await game.prepareBattle({playerShipId:'type-viic',friendlyBots:[],enemies:['bismarck'],spawnDistance:5000});
game.setInPort(false); game.setPaused(true); game.water.deterministic=true; game.manualAim=false; game.aimModule='';
game.simulation.actors.forEach(a=>{if(a.controller==='bot')a.controller='idle';});
window.reviewGame=game;
const drawHud = () => {
  const sim=game.simulation;
  const data={ship:{...sim.ship},order:game.input.order,rudderOrder:game.input.rudderOrder,camera:game.rig.mode,binoculars:game.rig.binoculars,magnification:game.rig.magnification,pointerLocked:true,viewBearing:game.rig.bearing,fps:60,backend:game.water.backend,trail:[],combat:sim.telemetry(game.battery,game.currentAim),mapId:sim.mapId};
  root.render(<ShipContext.Provider value={game.definition}><FleetHud data={data} game={game} visible bindings={defaultKeybindings()}/></ShipContext.Provider>);
};
window.reviewView=async({depth=0,range=5000,scope=false,elevation=.7,distance=130,hit=false,width=1600,height=900}={})=>{
  host.style.cssText=`position:relative;width:${width}px;height:${height}px`;
  hud.style.cssText=`position:absolute;inset:0;width:${width}px;height:${height}px`;
  document.body.style.cssText=`width:${width}px;height:${height}px;overflow:hidden`;
  game.resize();
  const sim=game.simulation;
  Object.assign(sim.ship,{x:0,y:-depth,z:0,heading:0,pitch:0,roll:0});
  Object.assign(sim.target.motion,{x:0,y:0,z:-range,heading:Math.PI/2,pitch:0,roll:0});
  sim.actors.forEach(a=>{if(a.controller==='bot')a.controller='idle';});
  game.fleetViews.forEach(v=>{v.snap();v.update(1);});
  game.rig.setSubmarine(game.definition.submarine);
  game.rig.binoculars=scope;game.rig.scopeMagnification=12;game.rig.mode='Chase';game.rig.azimuth=0;game.rig.elevation=elevation;game.rig.distance=distance;
  game.rig.opticsTransition=undefined;
  game.currentAim=[0,8,-range];
  game.rig.update(game.playerView.motion,-depth,0,true);
  if(scope)game.rig.aimAt(game.currentAim,game.playerView.motion);
  if(hit){
    game.battery='main';game.simulation.requestFire();
    // Run the real CPU damage fixture, then show its evidence at the target.
    game.simulation.shells.push({id:90000,ownerId:sim.ship.id,position:[0,8,-range+90],velocity:[0,0,-820],age:0,penetrationMm:900,damage:70,caliberM:.38,visited:[]});
    for(let i=0;i<24;i++)sim.step({throttle:0,rudder:0},{aim:game.currentAim,fire:false,battery:'main'});
    game.fleetViews.forEach(v=>{v.snap();v.update(1);});
  }else game.battery='torpedo';
  game.water.syncToTick(3600);
  await game.water.update(1/60);
  for(let i=0;i<8;i++)await game.frame(performance.now());
  drawHud();
  return {camera:game.diagnostics().camera,error:window.reviewError,events:sim.events.filter(e=>e.impact).map(e=>({part:e.impact.targetName,hp:e.impact.hullDamage,outcome:e.impact.outcome}))};
};
window.reviewWaves=async()=>{
  const water=game.water,positions=Array.from({length:128},(_,i)=>new Vector2((i%16)*8-64,Math.floor(i/16)*8-32)),result=[];
  for(const [label,amplitude,wavelength,chop]of [['previous',.45,28,.8],['updated',.18,20,.55]]){
    water.waves.amplitude.value=amplitude;water.waves.peakWavelength.value=wavelength;water.waves.choppiness.value=chop;water.waves.dirty=true;
    const samples=[];
    for(const tick of [1200,2400,3600,4800]){water.syncToTick(tick);await water.update(1/60);water.sampler.setPositions(positions);await water.sampler.update();samples.push(...water.sampler.getSamples().map(s=>s.height));}
    result.push({label,min:Math.min(...samples),max:Math.max(...samples),rms:Math.sqrt(samples.reduce((n,v)=>n+v*v,0)/samples.length)});
  }
  return result;
};
await window.reviewView();window.reviewReady=true;
