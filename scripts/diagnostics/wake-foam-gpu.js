import * as THREE from 'three/webgpu';
import { positionLocal, uniform, uv, vec4 } from 'three/tsl';
import { WakeFoam } from '/src/game/WakeFoam.ts';
import { WakeFoamGpu, WakeStampCollector, gpuWakeFoamPainter } from '/src/game/WakeFoamGpu.ts';
import { FleetWakeFoam } from '/src/game/FleetWakeFoam.ts';
// The game paints trail foam only on the GPU; the CPU painter is the reference raster.
import { cpuWakeFoamPainter } from '/src/game/testing/wakeFoam.ts';
const renderer=new THREE.WebGPURenderer(); await renderer.init();
document.body.append(renderer.domElement);
const resolution=256,tiles=2;
const checks=[];
try {
  // The trail first tuned to match the replaced library paints one channel; the realistic trail adds its slick.
  for(const realistic of [false,true]) checks.push(...await checkRaster(realistic));
  const fleet=[...await checkFleet(renderer,false),...await checkFleet(renderer,true)];
  window.result={passed:checks.every(c=>c.overOne===0)&&fleet.every(c=>c.overOne===0),checks,fleet};
}catch(error){window.result={error:String(error),checks};throw error;}
finally{renderer.dispose();}

/** Four trails through turns and splashes: the GPU atlas against each trail's CPU reference raster (red, and the
 * slick in green when realistic). */
async function checkRaster(realistic) {
  const channels=realistic ? 2 : 1, raster=new WakeFoamGpu(renderer,resolution,tiles,channels);
  const collectors=Array.from({length:4},()=>new WakeStampCollector());
  const cpu=collectors.map(()=>new WakeFoam(resolution));
  const retained=collectors.map(c=>new WakeFoam(resolution,undefined,c));
  for(const foam of [...cpu,...retained]) foam.realistic=realistic;
  const states=collectors.map((_,i)=>({x:i*2100,z:0,heading:i*.7,speed:12}));
  const results=[];
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
      for(let i=0;i<4;i++)for(let y=0;y<resolution;y++)for(let x=0;x<resolution;x++)for(let c=0;c<channels;c++) {
        const actual=pixels[((Math.floor(i/tiles)*resolution+y)*resolution*tiles+(i%tiles)*resolution+x)*channels+c];
        const expected=(c ? cpu[i].slickPixels : cpu[i].texture.image.data)[y*resolution+x],difference=Math.abs(actual-expected);
        max=Math.max(max,difference);changed+=difference>0;overOne+=difference>1;
      }
      results.push({realistic,tick,max,changed,overOne,stamps:collectors.reduce((n,c)=>n+c.count,0)});
    }
    return results;
  } finally {raster.dispose();cpu.forEach(f=>f.dispose());retained.forEach(f=>f.dispose());}
}

async function checkFleet(renderer,realistic) {
  const cpu=new FleetWakeFoam(256,cpuWakeFoamPainter),gpu=new FleetWakeFoam(256,gpuWakeFoamPainter(renderer)),camera=new THREE.PerspectiveCamera(52,1,.5,60000);
  cpu.realistic=gpu.realistic=realistic;
  // Read through the same world-space sampler used by the water material. Raw
  // atlas readback alone can hide a vertically inverted render target.
  const center=uniform(new THREE.Vector2());
  const sampleTarget=new THREE.RenderTarget(128,128,{depthBuffer:false});
  const sampleCamera=new THREE.OrthographicCamera(-1,1,1,-1,0,1);
  const sampleScenes=[cpu,gpu].map(foam=>{
    const world=uv().sub(.5).mul(400).add(center);
    const material=new THREE.MeshBasicNodeMaterial({depthTest:false,depthWrite:false});
    material.toneMapped=false;
    material.vertexNode=vec4(positionLocal.xy,0,1);
    const read=realistic ? foam.read(world.x,world.y) : undefined;
    material.fragmentNode=realistic ? vec4(read.x,read.y,read.z,1) : vec4(foam.sample(world.x,world.y),0,0,1);
    const scene=new THREE.Scene();scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),material));return scene;
  });
  const ships=Array.from({length:30},(_,i)=>({root:new THREE.Group(),motion:{x:i*2000,y:0,z:0,heading:0,speed:i===0?0:12},
    definition:{hull:{length:250,beam:36},handling:{forwardSpeed:18,reverseSpeed:6}}}));
  const checks=[];camera.position.set(0,1000,6000);
  const inspect=async(label,active=ships)=>{
    const target=gpu.painter.target,size=target.width,res=256;
    const pixels=await renderer.readRenderTargetPixelsAsync(target,0,0,size,size),channels=pixels.length/(size*size);
    let max=0,overOne=0,ink=0,slick=0;
    for(let slot=0;slot<active.length;slot++)for(let y=0;y<res;y++)for(let x=0;x<res;x++)for(let c=0;c<channels;c++){
      const row=Math.floor(slot/8)*res+y,col=slot%8*res+x,index=(row*size+col)*channels+c;
      const actual=pixels[index],expected=cpu.texture.image.data[index];
      const delta=Math.abs(actual-expected);max=Math.max(max,delta);overOne+=delta>1;if(c)slick+=actual>0;else ink+=actual>0;
    }
    checks.push({realistic,label,max,overOne,ink,slick});
    for(const ship of [active[1],active.at(-1)].filter(Boolean)) {
      center.value.set(ship.motion.x,ship.motion.z);
      const images=[];
      for(const scene of sampleScenes) {
        renderer.setRenderTarget(sampleTarget);renderer.render(scene,sampleCamera);renderer.setRenderTarget(null);
        images.push(await renderer.readRenderTargetPixelsAsync(sampleTarget,0,0,128,128));
      }
      let max=0,overOne=0,ink=0;
      for(let i=0;i<images[0].length;i++) {
        const delta=Math.abs(images[0][i]-images[1][i]);max=Math.max(max,delta);overOne+=delta>1;ink+=images[0][i]>0;
      }
      checks.push({realistic,label:`${label} world sampler`,max,overOne,ink});
    }
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
  }finally {
    sampleTarget.dispose();sampleScenes.forEach(scene=>scene.traverse(mesh=>{mesh.geometry?.dispose();mesh.material?.dispose();}));
    cpu.dispose();gpu.dispose();
  }
}
