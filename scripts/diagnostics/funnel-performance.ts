import * as THREE from 'three/webgpu';
import { ShipFunnelSmoke } from '../../src/game/ShipFunnelSmoke';
import { shipPreset } from '../../src/ships/presets';
import { CombatSimulation } from '../../src/simulation/combat';
import { motionVelocity } from '../../src/simulation/ship';

const stats = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return { median: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.floor(sorted.length * .95)] };
};

/** Same ships, poses, emission clocks and wind, alternating A/B order. GPU
 * timestamps exclude browser scheduling. Retain raw samples and baseline SHA. */
export async function compareFunnels(review: any, Baseline: typeof ShipFunnelSmoke, samples = 60) {
  const renderer: THREE.WebGPURenderer = review.game.renderer;
  if (!renderer.hasFeature('timestamp-query')) throw new Error('WebGPU timestamps are required.');
  const backend = renderer.backend as typeof renderer.backend & { trackTimestamp: boolean };
  const tracking = backend.trackTimestamp, previous = renderer.getRenderTarget();
  const clear = renderer.getClearColor(new THREE.Color()), alpha = renderer.getClearAlpha();
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const target = new THREE.RenderTarget(size.x, size.y, { samples: renderer.samples });
  const effects = [new Baseline(), new ShipFunnelSmoke()];
  const scenes = effects.map(effect => { const scene = new THREE.Scene(); scene.add(effect.root); effect.setWind(12, .7); return scene; });
  const results = [];
  try {
    backend.trackTimestamp = true; renderer.setRenderTarget(target); renderer.setClearColor(0, 0);
    for (const fixture of [
      { name:'underway', preset:'bismarck', ships:1, spacing:0, load:1, position:[200,95,155], aim:[0,32,20], fov:52 },
      { name:'close funnel', preset:'bismarck', ships:1, spacing:0, load:1, position:[78,46,60], aim:[0,40,20], fov:52 },
      { name:'idle', preset:'bismarck', ships:1, spacing:0, load:0, position:[78,46,60], aim:[0,40,20], fov:52 },
      { name:'binocular', preset:'bismarck', ships:1, spacing:0, load:1, position:[5000,28,0], aim:[0,32,20], fov:4.33 },
      { name:'60 ship fleet', preset:'fletcher', ships:60, spacing:120, load:1, position:[900,850,1300], aim:[0,25,0], fov:52 },
      { name:'16 overlapping plumes', preset:'bismarck', ships:16, spacing:8, load:1, position:[100,60,105], aim:[0,38,20], fov:52 },
    ]) {
      const definition = shipPreset(fixture.preset);
      const ships = Array.from({ length: fixture.ships }, (_, index) => {
        const sim = new CombatSimulation(definition), motion = sim.player.motion;
        Object.assign(motion, {id:`ship-${index}`,speed:fixture.load * definition.handling.forwardSpeed,
          x:((index % 8) - (Math.min(8,fixture.ships) - 1) / 2) * fixture.spacing,
          z:(Math.floor(index / 8) - Math.floor((fixture.ships - 1) / 8) / 2) * fixture.spacing});
        const velocity = motionVelocity(motion);
        motion.x -= velocity[0] * 13; motion.z -= velocity[2] * 13;
        return {definition,actor:sim.player,motion};
      });
      const camera = new THREE.PerspectiveCamera(fixture.fov, size.x / size.y, .1, 30000);
      camera.position.fromArray(fixture.position); camera.lookAt(new THREE.Vector3().fromArray(fixture.aim)); camera.updateMatrixWorld();
      effects.forEach(effect => effect.reset());
      for (let frame = 0; frame < 13 * 60; frame++) {
        for (const ship of ships) {
          const velocity = motionVelocity(ship.motion);
          ship.motion.x += velocity[0] / 60; ship.motion.z += velocity[2] / 60;
        }
        effects.forEach(effect => effect.update(ships, 1 / 60, camera));
      }
      const gpu: number[][] = [[], []], update: number[][] = [[], []];
      for (let frame = -8; frame < samples; frame++) for (const index of frame % 2 === 0 ? [0,1] : [1,0]) {
        const start = performance.now(); effects[index].update(ships, 0, camera);
        const cpu = performance.now() - start;
        renderer.render(scenes[index], camera);
        const time = await renderer.resolveTimestampsAsync('render');
        if (time === undefined) throw new Error('Missing GPU timestamp result.');
        if (frame >= 0) { gpu[index].push(time); update[index].push(cpu); }
      }
      results.push({...fixture,particles:effects.map(effect => effect.diagnostics().particles),
        gpuMs:{before:stats(gpu[0]),after:stats(gpu[1])},updateMs:{before:stats(update[0]),after:stats(update[1])},rawGpuMs:gpu,rawUpdateMs:update});
      (window as any).funnelBenchmarkProgress = fixture.name;
    }
    return {canvas:size.toArray(),samples,antialiasSamples:renderer.samples,drawCalls:[1,1],results};
  } finally {
    renderer.setRenderTarget(previous); renderer.setClearColor(clear, alpha); backend.trackTimestamp = tracking;
    effects.forEach(effect => effect.dispose()); target.dispose();
  }
}

/** Full actual Game frame: identical paused ocean/ship/sky/postprocessing, with
 * only the old/new funnel batch changed. Includes the scene pass on every sample. */
export async function compareFunnelGameFrames(review: any, Baseline: typeof ShipFunnelSmoke, samples = 80) {
  await review.baseline(Baseline); review.variant('after'); await review.still('close', 12);
  const game = review.game, renderer: THREE.WebGPURenderer = game.renderer;
  const backend = renderer.backend as typeof renderer.backend & { trackTimestamp: boolean };
  const tracking = backend.trackTimestamp, autoReset = renderer.info.autoReset;
  const gpu: number[][] = [[], []], draws = [0,0];
  review.variant('before'); await review.render(); review.variant('after'); await review.render();
  try {
    backend.trackTimestamp = true; renderer.info.autoReset = false;
    for (let frame = -8; frame < samples; frame++) for (const index of frame % 2 === 0 ? [0,1] : [1,0]) {
      review.variant(index === 0 ? 'before' : 'after');
      renderer.info.reset(); game.renderer._nodes.nodeFrame.update(); game.renderFrame();
      const time = await renderer.resolveTimestampsAsync('render');
      if (time === undefined) throw new Error('Missing GPU timestamp result.');
      if (frame >= 0) { gpu[index].push(time); draws[index] = renderer.info.render.drawCalls; }
    }
    return {canvas:[renderer.domElement.width,renderer.domElement.height],samples,drawCalls:draws,
      gpuMs:{before:stats(gpu[0]),after:stats(gpu[1])},rawGpuMs:gpu};
  } finally {
    backend.trackTimestamp = tracking; renderer.info.autoReset = autoReset;
    review.variant('after'); await review.render();
  }
}
