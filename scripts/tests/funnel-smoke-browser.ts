import * as THREE from 'three/webgpu';
import { ShipFunnelSmoke } from '../../src/game/ShipFunnelSmoke';
import { shipPreset } from '../../src/ships/presets';
import { CombatSimulation } from '../../src/simulation/combat';

/** Exercise the actual animated sprite shader: live sky lighting, stable pause,
 * optics hiding, expiry and reuse after an empty first compilation. */
export async function checkFunnelSmokeRendering() {
  const renderer = new THREE.WebGPURenderer(); await renderer.init();
  renderer.setSize(256,256); renderer.setClearColor(0,0); renderer.info.autoReset = false;
  const target = new THREE.RenderTarget(256,256), scene = new THREE.Scene();
  const smoke = new ShipFunnelSmoke(), definition = shipPreset('bismarck'), sim = new CombatSimulation(definition);
  const ship = {definition,actor:sim.player,motion:sim.player.motion};
  const camera = new THREE.PerspectiveCamera(52,1,.1,1000);
  camera.position.set(0,38,65); camera.lookAt(0,38,0); camera.updateMatrixWorld();
  smoke.setWind(0,0); scene.add(smoke.root);
  const frames: {name:string;alpha:number;light:number;particles:number;draws:number}[] = [];
  const capture = async (name: string) => {
    renderer.info.reset(); renderer.render(scene,camera);
    const pixels = await renderer.readRenderTargetPixelsAsync(target,0,0,256,256);
    let alpha = 0, light = 0;
    for (let i = 0; i < pixels.length; i += 4) { alpha += pixels[i+3] / 255; light += (pixels[i] + pixels[i+1] + pixels[i+2]) / 765; }
    const frame = {name,alpha,light,particles:smoke.diagnostics().particles,draws:renderer.info.render.drawCalls};
    frames.push(frame);
    if (frame.draws !== 1) throw new Error(`Funnel batch split: ${JSON.stringify(frame)}`);
    return frame;
  };
  try {
    renderer.setRenderTarget(target);
    smoke.update([ship],0,camera); await renderer.compileAsync(scene,camera);
    if ((await capture('empty first compile')).alpha !== 0) throw new Error('Empty exhaust is visible.');
    for (let i = 0; i < 720; i++) smoke.update([ship],1/60,camera);
    smoke.setSun(new THREE.Vector3(.3,.5,1)); smoke.setIllumination(new THREE.Color(1,1,1),5.8,1.75);
    const day = await capture('day');
    if (day.alpha < 100) throw new Error('Funnel shader emitted no readable smoke.');
    smoke.update([ship],0,camera); const paused = await capture('paused');
    if (paused.alpha !== day.alpha || paused.light !== day.light) throw new Error('Paused smoke changed.');
    // No particle update between these light changes: paused conditions reach
    // the material in the same frame, including the light's camera transform.
    smoke.setSun(new THREE.Vector3(-.3,-.5,-1)); const reverse = await capture('reverse sunlight');
    if (reverse.light >= day.light * .9 || reverse.alpha !== day.alpha) throw new Error('Billow lighting did not follow the sun.');
    smoke.setSun(new THREE.Vector3(.3,.5,1)); smoke.setIllumination(new THREE.Color(.6,.7,1),.2,.2);
    const night = await capture('night');
    if (night.light > day.light * .35 || night.alpha !== day.alpha) throw new Error('Exhaust glows at night or lighting changed its density.');
    smoke.update([ship],0,camera,ship.motion.id);
    if ((await capture('hidden in own optics')).alpha !== 0) throw new Error('Own smoke remained in optics.');
    smoke.update([ship],0,camera);
    if ((await capture('restored from optics')).alpha !== night.alpha) throw new Error('Optics lost or restarted the trail.');
    for (const module of ship.actor.damage.modules) module.hp = 0;
    for (let i = 0; i < 600; i++) smoke.update([ship],1/60,camera);
    if ((await capture('machinery stopped')).alpha !== 0) throw new Error('Old exhaust did not dissipate.');
    smoke.reset();
    if ((await capture('reset')).alpha !== 0) throw new Error('Reset retained visible exhaust.');
    return {backend:'webgpu',frames};
  } finally { smoke.dispose(); target.dispose(); renderer.dispose(); }
}
