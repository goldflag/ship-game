import { CombatEffects } from '../../src/game/CombatEffects';
import { Color, RenderTarget, Scene } from 'three/webgpu';

const stats = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return { median: sorted[Math.floor(sorted.length / 2)], p90: sorted[Math.floor(sorted.length * .9)] };
};

/** Development-only, paired measurements in the actual ocean/sky/game pass.
 * Pass a retained baseline constructor, e.g. from an ignored .build snapshot.
 * GPU timestamps exclude browser scheduling and readback wait time. */
export async function compareWater(review: any, Baseline: typeof CombatEffects, samples = 30, isolated = false) {
  const game = review.game, renderer = game.renderer;
  if (!renderer.hasFeature('timestamp-query')) throw new Error('WebGPU timestamp queries are required.');
  await review.still('splash', 2.4);
  const event = game.simulation.events.find((event: any) => event.kind === 'splash');
  if (!event) throw new Error('The fixture must first produce a CPU shell impact.');
  const current: any = new CombatEffects(), baseline: any = new Baseline();
  const variants = { baseline, current };
  const original = game.effects.root.visible;
  const tracking = renderer.backend.trackTimestamp, autoReset = renderer.info.autoReset;
  renderer.backend.trackTimestamp = true; renderer.info.autoReset = false;
  game.effects.root.visible = false;
  const stage = isolated ? new Scene() : game.scene;
  const target = isolated ? new RenderTarget(renderer.domElement.width, renderer.domElement.height, { samples: renderer.samples }) : null;
  const oldTarget = renderer.getRenderTarget(), clearColor = renderer.getClearColor(new Color()), clearAlpha = renderer.getClearAlpha();
  if (isolated) {
    stage.fogNode = game.scene.fogNode;
    const names = ['Ballistic water sheets', 'Ballistic water body', 'Water droplets and mist', 'Wind-carried water mist'];
    for (const effects of Object.values(variants)) {
      for (const child of effects.root.children) child.visible = names.includes(child.name);
    }
    renderer.setRenderTarget(target); renderer.setClearColor('#19364a', 1);
  }
  stage.add(baseline.root, current.root);
  const sim = Object.create(game.simulation); sim.events = [];
  const rows = [];
  try {
    for (const scenario of [
      { name: '8 impacts close', impacts: 8, age: 1.8, range: 220 },
      { name: '32 impacts close', impacts: 32, age: 1.8, range: 220 },
      { name: '32 impacts falling', impacts: 32, age: 4.2, range: 220 },
      { name: '32 impacts distant', impacts: 32, age: 1.8, range: 5000 },
      { name: '32 impacts binoculars', impacts: 32, age: 1.8, range: 5000, zoom: true },
      { name: '32 impacts offscreen', impacts: 32, age: 1.8, range: 220, away: true },
    ]) {
      game.camera.fov = scenario.zoom ? 4.33 : 52;
      game.camera.position.set(330 + scenario.range * .7, 64, -35 + scenario.range * .7);
      game.camera.lookAt(scenario.away ? 3000 : 330, 20, scenario.away ? 3000 : -35);
      game.camera.updateProjectionMatrix(); game.camera.updateMatrixWorld();
      for (const effects of Object.values(variants)) {
        effects.reset(); effects.setWind(9, .7); effects.setSun(game.sky.sun.direction.value);
        for (let i = 0; i < scenario.impacts; i++) {
          effects.emit({ ...event, sequence: i + 1,
            position: [310 + (i % 4) * 14, event.position[1], -65 + Math.floor(i / 4) * 14] });
        }
        effects.update(sim, scenario.age, game.camera);
      }
      const timings: Record<string, { gpu: number[]; submit: number[]; update: number[]; draws: number; triangles: number }> = {};
      for (let frame = -8; frame < samples; frame++) {
        for (const name of frame % 2 === 0 ? ['hidden', 'baseline', 'current'] : ['current', 'baseline', 'hidden']) {
          baseline.root.visible = name === 'baseline'; current.root.visible = name === 'current';
          const effects = name === 'baseline' ? baseline : current;
          const startUpdate = performance.now();
          // Batch to resolve sub-millisecond publication costs on coarse clocks.
          for (let i = 0; i < 10; i++) effects.update(sim, 0, game.camera);
          const update = (performance.now() - startUpdate) / 10;
          renderer._nodes.nodeFrame.update(); renderer.info.reset();
          const start = performance.now();
          if (isolated) renderer.render(stage, game.camera); else game.renderFrame();
          const submit = performance.now() - start;
          const gpu = await renderer.resolveTimestampsAsync('render');
          if (frame < 0) continue;
          const row = timings[name] ??= { gpu: [], submit: [], update: [], draws: 0, triangles: 0 };
          row.gpu.push(gpu); row.submit.push(submit); row.update.push(update);
          row.draws = renderer.info.render.drawCalls; row.triangles = renderer.info.render.triangles;
        }
      }
      rows.push({ ...scenario, pairedGpuDeltaMs: stats(timings.current.gpu.map((ms, i) => ms - timings.baseline.gpu[i])),
        results: Object.fromEntries(Object.entries(timings).map(([name, row]) => [name, {
        gpuMs: stats(row.gpu), submitMs: stats(row.submit), effectUpdateMs: stats(row.update),
        drawCalls: row.draws, triangles: row.triangles,
      }])), effects: { baseline: baseline.diagnostics(), current: current.diagnostics() } });
      (window as any).waterBenchmarkProgress = rows.length / 6;
    }
    return { canvas: [renderer.domElement.width, renderer.domElement.height], samples, isolated,
      adapter: renderer.backend.device?.adapterInfo ?? null, rows };
  } finally {
    stage.remove(baseline.root, current.root); baseline.dispose(); current.dispose();
    renderer.setRenderTarget(oldTarget); renderer.setClearColor(clearColor, clearAlpha); target?.dispose();
    game.effects.root.visible = original;
    renderer.backend.trackTimestamp = tracking; renderer.info.autoReset = autoReset;
    await review.still('splash', 2.4);
  }
}
