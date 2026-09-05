import * as THREE from 'three/webgpu';
import { effectVolumeMaterial } from '../../src/game/EffectVolume';

// Development-only probe for combat-effects.html. Freeze the real CPU-fired
// scene and alternate smoke on/off; GPU timestamps exclude RAF/background-tab
// throttling. Absolute timings still depend on concurrent GPU use.
export async function measureSmoke(review: any, samples = 20) {
  const game = review.game, renderer = game.renderer;
  if (!renderer.hasFeature('timestamp-query')) throw new Error('This probe requires WebGPU timestamp queries.');
  const schedule = game.scheduleFrame;
  game.scheduleFrame = () => {};
  cancelAnimationFrame(game.raf);
  await game.frameTask;
  cancelAnimationFrame(game.raf);
  const smoke = game.effects.root.getObjectByName('Propellant and impact volumes');
  const visible = smoke.visible, tracking = renderer.backend.trackTimestamp;
  const autoReset = renderer.info.autoReset;
  renderer.backend.trackTimestamp = true;
  renderer.info.autoReset = false;
  const results: Record<string, { gpu: number[]; cpu: number[]; draws: number; triangles: number }> = {};
  try {
    for (let frame = -6; frame < samples; frame++) {
      for (const enabled of frame % 2 === 0 ? [false, true] : [true, false]) {
        // PassNode caches its result per renderer frame. Give it a fresh frame
        // so a quick second sample cannot measure only cached postprocessing.
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        const key = enabled ? 'smoke' : 'hidden';
        smoke.visible = enabled;
        renderer.info.reset();
        const start = performance.now();
        game.renderFrame();
        const cpu = performance.now() - start;
        const gpu = await renderer.resolveTimestampsAsync('render');
        if (frame < 0) continue;
        const result = results[key] ??= { gpu: [], cpu: [], draws: 0, triangles: 0 };
        result.gpu.push(gpu); result.cpu.push(cpu);
        result.draws = renderer.info.render.drawCalls;
        result.triangles = renderer.info.render.triangles;
      }
    }
    const stats = (values: number[]) => {
      const sorted = [...values].sort((a, b) => a - b);
      return { median: sorted[Math.floor(sorted.length / 2)], p90: sorted[Math.floor(sorted.length * .9)] };
    };
    return {
      canvas: [renderer.domElement.width, renderer.domElement.height],
      effects: game.effects.diagnostics(),
      samples,
      results: Object.fromEntries(Object.entries(results).map(([key, value]) => [key,
        { gpuMs: stats(value.gpu), submitMs: stats(value.cpu), drawCalls: value.draws, triangles: value.triangles }])),
    };
  } finally {
    smoke.visible = visible;
    renderer.backend.trackTimestamp = tracking;
    renderer.info.autoReset = autoReset;
    game.scheduleFrame = schedule;
    game.lastTime = performance.now();
    game.scheduleFrame();
  }
}

/** Compare shader revisions on identical live particle buffers, in alternating
 * order on the same GPU. Pass a retained baseline factory from a local .build
 * copy; that file is intentionally not a production dependency. */
export async function compareSmokeMaterials(review: any, baseline: typeof effectVolumeMaterial, samples = 30) {
  const game = review.game, renderer: THREE.WebGPURenderer = game.renderer;
  // r185 exposes this switch at runtime but omits it from the base Backend type.
  const backend = renderer.backend as typeof renderer.backend & { trackTimestamp: boolean };
  const schedule = game.scheduleFrame;
  game.scheduleFrame = () => {};
  cancelAnimationFrame(game.raf);
  await game.frameTask;
  cancelAnimationFrame(game.raf);
  const effects = game.effects;
  const mesh = effects.root.getObjectByName('Propellant and impact volumes').clone() as THREE.InstancedMesh;
  const scene = new THREE.Scene();
  scene.add(mesh);
  const materials = [baseline, effectVolumeMaterial].map(factory => factory(effects.volumeMap, effects.sun, effects.volumeDepth, 12, true));
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const target = new THREE.RenderTarget(size.x, size.y, { samples: renderer.samples });
  const oldTarget = renderer.getRenderTarget(), alpha = renderer.getClearAlpha(), color = renderer.getClearColor(new THREE.Color());
  const tracking = backend.trackTimestamp;
  const timings: number[][] = [[], []];
  try {
    if (!renderer.hasFeature('timestamp-query')) throw new Error('This probe requires WebGPU timestamp queries.');
    backend.trackTimestamp = true;
    renderer.setRenderTarget(target);
    renderer.setClearColor(0, 0);
    for (let frame = -6; frame < samples; frame++) {
      for (const index of frame % 2 === 0 ? [0, 1] : [1, 0]) {
        mesh.material = materials[index];
        renderer.render(scene, game.camera);
        const ms = await renderer.resolveTimestampsAsync('render');
        if (frame >= 0) timings[index].push(ms);
      }
    }
    const pixels = [];
    for (const material of materials) {
      mesh.material = material;
      renderer.render(scene, game.camera);
      pixels.push(await renderer.readRenderTargetPixelsAsync(target, 0, 0, size.x, size.y));
    }
    let sum = 0, max = 0, changed = 0, covered = 0;
    for (let i = 0; i < pixels[0].length; i += 4) {
      if (pixels[0][i + 3] > 0) covered++;
      let delta = 0;
      for (let c = 0; c < 4; c++) {
        const d = Math.abs(pixels[0][i + c] - pixels[1][i + c]);
        sum += d; max = Math.max(max, d); delta = Math.max(delta, d);
      }
      if (delta > 2) changed++;
    }
    const stats = (values: number[]) => {
      values.sort((a, b) => a - b);
      return { median: values[Math.floor(values.length / 2)], p90: values[Math.floor(values.length * .9)] };
    };
    return { canvas: size.toArray(), antialiasSamples: renderer.samples, effects: effects.diagnostics(), samples,
      gpuMs: { before: stats(timings[0]), after: stats(timings[1]) },
      pixels: { covered, changedByMoreThanTwo: changed, maxChannelDelta: max, meanChannelDelta: sum / pixels[0].length } };
  } finally {
    renderer.setRenderTarget(oldTarget);
    renderer.setClearColor(color, alpha);
    backend.trackTimestamp = tracking;
    for (const material of materials) material.dispose();
    mesh.dispose(); target.dispose();
    game.scheduleFrame = schedule;
    game.lastTime = performance.now();
    game.scheduleFrame();
  }
}
