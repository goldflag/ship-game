import * as THREE from 'three/webgpu';
import { WakeFoam } from '/src/game/WakeFoam.ts';
import { WakeFoamGpu, WakeStampCollector } from '/src/game/WakeFoamGpu.ts';
import { FleetWakeFoam } from '/src/game/FleetWakeFoam.ts';
const renderer=new THREE.WebGPURenderer(); await renderer.init();
document.body.append(renderer.domElement);
const resolution=256,tiles=2,raster=new WakeFoamGpu(renderer,resolution,tiles);
const collectors=Array.from({length:4},()=>new WakeStampCollector());
const cpu=collectors.map(()=>new WakeFoam(resolution));
const retained=collectors.map(c=>new WakeFoam(resolution,undefined,c));
const states=collectors.map((_,i)=>({x:i*2100,z:0,heading:i*.7,speed:12}));
const checks=[];
try {
  for(let tick=0;tick<1200;tick++) {
    for(let i=0;i<4;i++) {
      const state=states[i];state.heading=Math.sin(tick*.007+i)*1.5;
      state.x+=Math.sin(state.heading)*state.speed*.05;state.z-=Math.cos(state.heading)*state.speed*.05;
      if(tick%41===0)for(const foam of [cpu[i],retained[i]])foam.splash(state.x+Math.sin(tick)*30,state.z+Math.cos(tick)*50,.38);
      cpu[i].update(state,.05);retained[i].update(state,.05);
    }
    if(![0,1,100,500,1199].includes(tick))continue;
    raster.update(collectors);
    const pixels=await renderer.readRenderTargetPixelsAsync(raster.target,0,0,resolution*tiles,resolution*tiles);
    let max=0,changed=0,overOne=0;
    for(let i=0;i<4;i++)for(let y=0;y<resolution;y++)for(let x=0;x<resolution;x++) {
      const actual=pixels[(resolution*tiles-1-(Math.floor(i/tiles)*resolution+y))*resolution*tiles+(i%tiles)*resolution+x];
      const expected=cpu[i].texture.image.data[y*resolution+x],difference=Math.abs(actual-expected);
      max=Math.max(max,difference);changed+=difference>0;overOne+=difference>1;
    }
    checks.push({tick,max,changed,overOne,stamps:collectors.reduce((n,c)=>n+c.count,0)});
  }
  const fleet=await checkFleet(renderer);
  window.result={passed:checks.every(c=>c.overOne===0)&&fleet.every(c=>c.overOne===0),checks,fleet};
}catch(error){window.result={error:String(error),checks};throw error;}
finally{raster.dispose();cpu.forEach(f=>f.dispose());retained.forEach(f=>f.dispose());renderer.dispose();}

async function checkFleet(renderer) {
  const cpu=new FleetWakeFoam(256),gpu=new FleetWakeFoam(256,renderer),camera=new THREE.PerspectiveCamera(52,1,.5,60000);
  const ships=Array.from({length:30},(_,i)=>({root:new THREE.Group(),motion:{x:i*2000,y:0,z:0,heading:0,speed:i===0?0:12},
    definition:{hull:{length:250,beam:36},handling:{forwardSpeed:18,reverseSpeed:6}}}));
  const checks=[];camera.position.set(0,1000,6000);
  const inspect=async(label,active=ships)=>{
    const target=gpu.gpu.target,size=target.width,res=256;
    const pixels=await renderer.readRenderTargetPixelsAsync(target,0,0,size,size);
    let max=0,overOne=0,ink=0;
    for(let slot=0;slot<active.length;slot++)for(let y=0;y<res;y++)for(let x=0;x<res;x++){
      const row=Math.floor(slot/8)*res+y,col=slot%8*res+x;
      const actual=pixels[(size-1-row)*size+col],expected=cpu.texture.image.data[row*size+col];
      const delta=Math.abs(actual-expected);max=Math.max(max,delta);overOne+=delta>1;ink+=actual>0;
    }
    checks.push({label,max,overOne,ink});
  };
  const step=(dt,active=ships,events=[])=>{cpu.update(active,dt,events,camera);gpu.update(active,dt,events,camera);};
  try {
    for(let tick=0;tick<240;tick++) {
      for(const ship of ships) {ship.motion.heading+=.003;ship.motion.x+=Math.sin(ship.motion.heading)*ship.motion.speed/60;ship.motion.z-=Math.cos(ship.motion.heading)*ship.motion.speed/60;}
      step(1/60,ships,tick===50?[{kind:'splash',position:[20,0,-30],shell:{caliberM:.38}}]:[]);
    }
    await inspect('distant cadence');
    camera.zoom=12;camera.updateProjectionMatrix();step(.21);await inspect('zoom');
    step(0);await inspect('pause');
    ships[1].motion.x+=2000;step(.1);await inspect('teleport');
    const reordered=[ships[3],ships[0]];step(.1,reordered);await inspect('removed and reordered',reordered);
    cpu.reset();gpu.reset();step(.1,ships);await inspect('reset');
    return checks;
  }finally {cpu.dispose();gpu.dispose();}
}
