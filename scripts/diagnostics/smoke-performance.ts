import * as THREE from 'three/webgpu';
import { effectVolumeMaterial } from '../../src/game/EffectVolume';
import { CombatEffects } from '../../src/game/CombatEffects';
import type { CombatEvent, CombatSimulation } from '../../src/simulation/combat';

/** Full frozen Game frame, including ocean/sky/postprocessing. Reconstruct the
 * baseline from the same CPU shot events and the live cloud's simulation age. */
export async function compareSmokeGameFrames(review: any, Baseline: typeof CombatEffects, samples = 60) {
  await review.still('smoke', 1);
  const game = review.game, renderer: THREE.WebGPURenderer = game.renderer;
  if (!renderer.hasFeature('timestamp-query')) throw new Error('WebGPU timestamps are required.');
  const backend = renderer.backend as typeof renderer.backend & { trackTimestamp: boolean };
  const tracking = backend.trackTimestamp, autoReset = renderer.info.autoReset;
  const baseline = new Baseline(), current = game.effects.root.getObjectByName('Propellant and impact volumes') as THREE.InstancedMesh;
  const old = baseline.root.getObjectByName('Propellant and impact volumes')!;
  const events = game.simulation.events.filter((event: CombatEvent) => event.kind === 'shot');
  const sim = { events, shells: [], torpedoes: [], depthCharges: [], aircraft: [], actors: [], tick: 0 } as unknown as CombatSimulation;
  baseline.setSun(game.effects.sun.value);
  baseline.setWind(game.water.waves.windSpeed.value, game.water.waves.windDirection.value);
  baseline.update(sim, 0, game.camera);
  baseline.update(sim, current.geometry.getAttribute('effectVolume').getX(0), game.camera);
  game.effects.root.add(old);
  const gpu: number[][] = [[], []], cpu: number[][] = [[], []], draws = [0, 0];
  try {
    backend.trackTimestamp = true; renderer.info.autoReset = false;
    for (let frame = -8; frame < samples; frame++) for (const index of frame % 2 === 0 ? [0, 1] : [1, 0]) {
      old.visible = index === 0; current.visible = index === 1;
      // Give the real scene pass a fresh frame, without background RAF delays.
      game.renderer._nodes.nodeFrame.update(); renderer.info.reset();
      const start = performance.now(); game.renderFrame();
      const submit = performance.now() - start;
      const time = await renderer.resolveTimestampsAsync('render');
      if (time === undefined) throw new Error('GPU timestamp query returned no result.');
      if (frame >= 0) { gpu[index].push(time); cpu[index].push(submit); draws[index] = renderer.info.render.drawCalls; }
    }
    const stats = (values: number[]) => {
      const sorted = [...values].sort((a, b) => a - b);
      return { median: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.floor(sorted.length * .95)] };
    };
    return { canvas: [renderer.domElement.width, renderer.domElement.height], samples, drawCalls: draws,
      particles: [baseline.diagnostics().smoke, game.effects.diagnostics().smoke],
      gpuMs: { before: stats(gpu[0]), after: stats(gpu[1]) }, submitMs: { before: stats(cpu[0]), after: stats(cpu[1]) }, rawGpuMs: gpu };
  } finally {
    old.removeFromParent(); current.visible = true; baseline.dispose();
    backend.trackTimestamp = tracking; renderer.info.autoReset = autoReset;
  }
}

/** Compare complete recipes as well as shaders. A retained, import-relocated
 * baseline constructor can be loaded from .build; it never ships with the game.
 * Both revisions receive identical events, clocks, wind, cameras and targets.
 * Alternate order and use GPU timestamps rather than background-tab RAF time. */
export async function compareSmokeRevisions(review: any, Baseline: typeof CombatEffects, samples = 40) {
  const renderer: THREE.WebGPURenderer = review.game.renderer;
  if (!renderer.hasFeature('timestamp-query')) throw new Error('WebGPU timestamps are required.');
  const backend = renderer.backend as typeof renderer.backend & { trackTimestamp: boolean };
  const tracking = backend.trackTimestamp, previous = renderer.getRenderTarget();
  const clearColor = renderer.getClearColor(new THREE.Color()), clearAlpha = renderer.getClearAlpha();
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const target = new THREE.RenderTarget(size.x, size.y, { samples: renderer.samples });
  const effects = [new Baseline(), new CombatEffects()];
  const scenes = effects.map(effect => {
    const scene = new THREE.Scene();
    scene.add(effect.root.getObjectByName('Propellant and impact volumes')!);
    effect.setSun(new THREE.Vector3(.45, .8, .4).normalize()); effect.setWind(12, .5);
    return scene;
  });
  const stats = (values: number[]) => {
    const ordered = [...values].sort((a, b) => a - b);
    return { median: ordered[Math.floor(ordered.length / 2)], p95: ordered[Math.floor(ordered.length * .95)] };
  };
  const results = [];
  try {
    backend.trackTimestamp = true;
    renderer.setRenderTarget(target); renderer.setClearColor(0, 0);
    for (const fixture of [
      { name: 'close broadside', guns: 8, position: [145, 58, -150], aim: [45, 18, -55], fov: 52, age: 1 },
      { name: 'binocular broadside', guns: 8, position: [5000, 18, 0], aim: [0, 18, 0], fov: 4.33, age: 1 },
      { name: 'inside plume', guns: 8, position: [35, 25, -70], aim: [0, 25, 0], fov: 52, age: 1 },
      { name: '64 gun overlap', guns: 64, position: [180, 95, -250], aim: [60, 25, 0], fov: 52, age: 1 },
      { name: 'late wisps', guns: 8, position: [145, 58, -150], aim: [45, 18, -55], fov: 52, age: 2.5 },
    ]) {
      const camera = new THREE.PerspectiveCamera(fixture.fov, size.x / size.y, .1, 30000);
      camera.position.fromArray(fixture.position); camera.lookAt(new THREE.Vector3().fromArray(fixture.aim)); camera.updateMatrixWorld();
      const events: CombatEvent[] = Array.from({ length: fixture.guns }, (_, gun) => ({
        sequence: gun + 1, tick: 0, kind: 'shot', shipId: 'fixture', message: 'GPU comparison',
        position: [Math.floor(gun / 8) * 5, 14 + Math.floor(gun / 8) * 2, [-85, -55, 55, 85][Math.floor(gun % 8 / 2)] + gun % 2 * 3],
        shell: { id: gun + 1, caliberM: .38, velocity: [820, 0, 0] },
      }));
      const sim = { events, shells: [], torpedoes: [], depthCharges: [], aircraft: [], actors: [], tick: 0 } as unknown as CombatSimulation;
      for (const effect of effects) {
        effect.reset(); effect.update(sim, 0, camera);
        for (let frame = 0; frame < Math.round(fixture.age * 60); frame++) effect.update(sim, 1 / 60, camera);
      }
      const gpu: number[][] = [[], []], cpu: number[][] = [[], []];
      for (let frame = -8; frame < samples; frame++) for (const index of frame % 2 === 0 ? [0, 1] : [1, 0]) {
        const start = performance.now(); renderer.render(scenes[index], camera);
        const submit = performance.now() - start;
        const time = await renderer.resolveTimestampsAsync('render');
        if (time === undefined) throw new Error('GPU timestamp query returned no result.');
        if (frame >= 0) { gpu[index].push(time); cpu[index].push(submit); }
      }
      results.push({ ...fixture, gpuMs: { before: stats(gpu[0]), after: stats(gpu[1]) },
        submitMs: { before: stats(cpu[0]), after: stats(cpu[1]) }, particles: effects.map(effect => effect.diagnostics().smoke),
        rawGpuMs: gpu });
    }
    return { canvas: size.toArray(), samples, antialiasSamples: renderer.samples, results };
  } finally {
    renderer.setRenderTarget(previous); renderer.setClearColor(clearColor, clearAlpha); backend.trackTimestamp = tracking;
    effects.forEach(effect => effect.dispose()); target.dispose();
  }
}

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
        if (ms === undefined) throw new Error('GPU timestamp query returned no result.');
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
