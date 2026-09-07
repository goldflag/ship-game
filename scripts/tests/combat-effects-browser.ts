import * as THREE from 'three/webgpu';
import { CombatEffects } from '../../src/game/CombatEffects';
import { EffectParticlePool, effectTexture } from '../../src/game/EffectParticles';
import { effectVolumeMaterial, effectVolumeTexture } from '../../src/game/EffectVolume';
import { configureRenderOrder } from '../../src/game/renderOrder';
import { uniform, viewportDepthTexture } from 'three/tsl';
import type { CombatSimulation } from '../../src/simulation/combat';
import type { rtt } from 'three/tsl';

/** Render the real muzzle recipe over its whole life, including overlapping
 * barrels. Alpha readback catches dense late smoke and visible expiry jumps. */
export async function checkCombatSmokeDissipation(verify = true) {
  const renderer = new THREE.WebGPURenderer();
  await renderer.init();
  renderer.setSize(256, 256);
  renderer.setClearColor(0, 0);
  const target = new THREE.RenderTarget(256, 256);
  target.depthTexture = new THREE.DepthTexture(256, 256);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(52, 1, .5, 1000);
  camera.position.set(65, 55, 150); camera.lookAt(30, 30, 0); camera.updateMatrixWorld();
  const effects = new CombatEffects();
  const smoke = effects.root.getObjectByName('Propellant and impact volumes') as THREE.InstancedMesh;
  // Keep the actual material/particle path; exclude flash light and ocean from
  // the opacity measurement, so lighting cannot disguise a disappearing plume.
  scene.add(smoke);
  const sim = { shells: [], torpedoes: [], depthCharges: [], aircraft: [], actors: [], events: [], tick: 0 } as unknown as CombatSimulation;
  const cases: { caliber: number; barrels: number; frames: { time: number; alpha: number; densePixels: number; particles: number }[] }[] = [];
  try {
    renderer.setRenderTarget(target);
    await renderer.compileAsync(scene, camera);
    for (const [caliber, barrels] of [[.127, 1], [.38, 8], [.46, 9]]) {
      effects.reset();
      sim.events.splice(0, sim.events.length, ...Array.from({ length: barrels }, (_, i) => ({ sequence: i + 1, tick: 0, kind: 'shot' as const,
        position: [0, 25, (i - (barrels - 1) / 2) * 2] as [number, number, number], message: 'Smoke fade regression', shipId: 'player',
        shell: { id: i + 1, caliberM: caliber, velocity: [820, 0, 0] as [number, number, number] } })));
      effects.update(sim, 0, camera);
      const frames: typeof cases[number]['frames'] = [];
      for (let frame = 0; frame <= 60; frame++) {
        if (frame > 0) for (let step = 0; step < 6; step++) effects.update(sim, 1 / 60, camera);
        renderer.render(scene, camera);
        const pixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, 256, 256);
        let alpha = 0, densePixels = 0;
        for (let i = 3; i < pixels.length; i += 4) {
          alpha += pixels[i] / 255;
          if (pixels[i] > 191) densePixels++;
        }
        frames.push({ time: frame / 10, alpha, densePixels, particles: effects.diagnostics().smoke });
      }
      cases.push({ caliber, barrels, frames });
    }
    if (verify) for (const sample of cases) {
      const peak = Math.max(...sample.frames.map(frame => frame.alpha));
      const at = (time: number) => sample.frames[Math.round(time * 10)];
      const largestDrop = Math.max(...sample.frames.slice(11).map((frame, i) => sample.frames[i + 10].alpha - frame.alpha));
      if (peak < 50 || at(2.5).alpha > peak * .3 || at(3.5).alpha > peak * .03
        || largestDrop > peak * .12 || at(5).alpha !== 0 || at(5).particles !== 0) {
        throw new Error(`Muzzle smoke holds too long or ends abruptly: ${JSON.stringify({ ...sample, peak, largestDrop })}`);
      }
    }
    return { backend: 'webgpu', cases };
  } finally { target.dispose(); effects.dispose(); renderer.dispose(); }
}

/** GPU regression: one submission per volume batch, visible from outside and
 * inside, with real scene-depth clipping and no residual pixels after reset. */
export async function checkCombatVolumeRendering(forceWebGL = false, reversedDepthBuffer = false, turbulent = true) {
  const renderer = new THREE.WebGPURenderer({ forceWebGL, reversedDepthBuffer });
  await renderer.init();
  configureRenderOrder(renderer);
  renderer.setSize(256, 256);
  renderer.info.autoReset = false;
  const target = new THREE.RenderTarget(256, 256);
  target.depthTexture = new THREE.DepthTexture(256, 256);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(52, 1, .5, 1000);
  const map = effectTexture('smoke'), volume = effectVolumeTexture();
  const material = effectVolumeMaterial(volume, uniform(new THREE.Vector3(-.55, .74, -.39).normalize()), viewportDepthTexture().r, turbulent ? 12 : 10, turbulent);
  const pool = new EffectParticlePool(8, map, false, material);
  const blocker = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), new THREE.MeshBasicMaterial({ color: 0 }));
  blocker.position.set(0, 10, 20);
  // Like Water Pro, the surface is transparent, writes depth and has an
  // explicit early priority. It must never erase gas in front of the horizon.
  const horizon = new THREE.Mesh(new THREE.PlaneGeometry(200, 100),
    new THREE.MeshBasicMaterial({ color: 0, transparent: true, depthWrite: true }));
  horizon.position.set(0, -40, -40); horizon.renderOrder = -30;
  const wind = new THREE.Vector3();
  scene.add(pool.mesh);
  const particle = pool.emit(new THREE.Vector3(0, 10, 0));
  particle.size = 28; particle.life = 12; particle.opacity = .9; particle.density = 4;
  const frames: { view: string; visiblePixels: number; draws: number; width: number; height: number }[] = [];
  const render = async (view: string, visible: boolean, draws: number) => {
    camera.updateMatrixWorld(); pool.update(0, camera, wind);
    renderer.info.reset(); renderer.render(scene, camera);
    const pixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, 256, 256);
    let visiblePixels = 0, left = 256, right = -1, top = 256, bottom = -1;
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 2) {
      visiblePixels++;
      const x = i / 4 % 256, y = Math.floor(i / 4 / 256);
      left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
    const calls = renderer.info.render.drawCalls;
    frames.push({ view, visiblePixels, draws: calls, width: Math.max(0, right - left + 1), height: Math.max(0, bottom - top + 1) });
    if ((visible ? visiblePixels < 100 : visiblePixels !== 0) || calls !== draws) {
      throw new Error(`Volume visibility/draw budget failed: ${JSON.stringify(frames)}`);
    }
  };
  try {
    camera.position.set(0, 10, 50); camera.lookAt(0, 10, 0);
    renderer.setRenderTarget(target);
    await renderer.compileAsync(scene, camera);
    await render('outside', true, 1);
    const outsidePixels = frames.at(-1)!.visiblePixels;
    scene.add(horizon);
    await render('in front of horizon', true, 2);
    if (frames.at(-1)!.visiblePixels < outsidePixels * .98) {
      throw new Error(`Distant transparent water erased nearby gas: ${JSON.stringify(frames)}`);
    }
    scene.remove(horizon);
    scene.add(blocker);
    await render('behind opaque surface', false, 2);
    scene.remove(blocker);
    camera.position.set(40, 25, -25); camera.lookAt(0, 10, 0);
    await render('reverse oblique', true, 1);
    camera.position.set(0, 10, 0); camera.lookAt(0, 10, -1);
    await render('inside', true, 1);
    if (turbulent) {
      particle.volumeAspect = 2.2;
      camera.position.set(0, 10, 50); camera.lookAt(0, 10, 0);
      await render('elongated side', true, 1);
      const side = frames.at(-1)!;
      if (side.width < side.height * 1.5) throw new Error(`Muzzle volume lost its launch direction: ${JSON.stringify(side)}`);
      particle.volumeYaw = Math.PI / 2;
      await render('elongated end-on', true, 1);
      particle.volumeYaw = .7; particle.volumeAxisY = .65;
      await render('elevated oblique', true, 1);
      scene.add(blocker);
      await render('elongated behind opaque surface', false, 2);
      scene.remove(blocker);
      camera.position.set(0, 10, 0); camera.lookAt(0, 10, -1);
      await render('inside elongated volume', true, 1);
    }
    pool.reset();
    await render('reset', false, 1);
    // Muzzles share storage with ordinary impact/fire smoke. Reusing their
    // slots must restore a sphere, including after an elevated launch.
    const reused = pool.emit(new THREE.Vector3(0, 10, 0));
    reused.size = 28; reused.life = 12; reused.opacity = .9; reused.density = 4;
    camera.position.set(0, 10, 50); camera.lookAt(0, 10, 0);
    await render('reused spherical slot', true, 1);
    const restored = frames.at(-1)!;
    if (restored.width !== frames[0].width || restored.height !== frames[0].height || restored.visiblePixels !== outsidePixels) {
      throw new Error(`Reused smoke retained its muzzle shape: ${JSON.stringify(restored)}`);
    }
    return { backend: forceWebGL ? 'webgl2' : 'webgpu', reversedDepth: renderer.reversedDepthBuffer, effect: turbulent ? 'smoke' : 'water', frames };
  } finally {
    target.dispose(); pool.dispose(); map.dispose(); volume.dispose();
    blocker.geometry.dispose(); blocker.material.dispose(); renderer.dispose();
    horizon.geometry.dispose(); horizon.material.dispose();
  }
}

/** Use window.review from combat-effects.html: real gunfire, sea, sky and final composition. */
export async function checkCombatSmokeHorizon(review: {
  still(scene: string, time: number, secondary?: boolean, range?: number): Promise<unknown>;
  capture(): Promise<unknown>;
  game: { renderer: THREE.WebGPURenderer; finalFrame: ReturnType<typeof rtt>; effects: CombatEffects };
}, range = 5000, splash = false) {
  await review.still(splash ? 'horizon-splash' : 'horizon', 2.5, false, range);
  const { renderer, finalFrame } = review.game;
  const target = finalFrame.renderTarget;
  if (!target) throw new Error('Horizon review requires a rendered frame');
  const { width, height } = target;
  const pixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, width, height);
  const mesh = review.game.effects.root.getObjectByName(splash ? 'Aerated water volumes' : 'Propellant and impact volumes')!;
  const visible = mesh.visible;
  let background: typeof pixels;
  try {
    mesh.visible = false;
    await review.capture();
    background = await renderer.readRenderTargetPixelsAsync(target, 0, 0, width, height);
  } finally {
    mesh.visible = visible;
    await review.capture();
  }
  const channel = (data: typeof pixels, x: number, y: number, c: number) => {
    const value = data[(y * width + x) * 4 + c];
    return target.texture.type === THREE.HalfFloatType ? THREE.DataUtils.fromHalfFloat(value)
      : target.texture.type === THREE.FloatType ? value : value / 255;
  };
  // The left gun plume (or central splash) spans this fixed binocular band.
  // Subtract the same frozen frame with this effect hidden. Comparing with
  // neighboring sky can let hull details conceal a missing row of smoke.
  const rows = [];
  for (let y = Math.round(height * .495); y <= Math.round(height * .53); y++) {
    let contrast = 0;
    for (let x = Math.round(width * (splash ? .46 : .37)); x <= Math.round(width * (splash ? .54 : .42)); x++) {
      const delta = Math.hypot(...[0, 1, 2].map(c => channel(pixels, x, y, c) - channel(background, x, y, c)));
      contrast = Math.max(contrast, delta);
    }
    rows.push({ y, contrast });
  }
  const erased = rows.filter(row => row.contrast < .02);
  if (erased.length) throw new Error(`${splash ? 'Splash' : 'Smoke'} erased across ${erased.length} horizon rows: ${JSON.stringify(erased)}`);
  return { effect: splash ? 'splash' : 'smoke', range, width, height, checkedRows: rows.length, minimumContrast: Math.min(...rows.map(row => row.contrast)) };
}

/** Run through the dev server in a browser; verifies GPU pixels, not just CPU matrices. */
export async function checkCombatEffects(forceWebGL = false) {
  const renderer = new THREE.WebGPURenderer({ forceWebGL });
  await renderer.init();
  renderer.setSize(512, 512);
  renderer.info.autoReset = false;
  const target = new THREE.RenderTarget(512, 512);
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-32, 32, 32, -32, .1, 100);
  camera.position.z = 20;
  const effects = new CombatEffects();
  scene.add(effects.root);
  const sim = { shells: [], torpedoes: [], depthCharges: [], actors: [], events: [], tick: 0 } as unknown as CombatSimulation;
  const frames: { shells: number; visible: number; draws: number }[] = [];
  try {
    // Match startup: warm the scene before firing, then render an empty pool.
    await renderer.compileAsync(scene, camera);
    renderer.setRenderTarget(target);
    for (const count of [0, 8, 0, 1, 8, 54, 256, 2, 0, 8]) {
      sim.shells.length = 0;
      for (let i = 0; i < count; i++) sim.shells.push({
        id: i, ownerId: 'player', position: [(i % 16) * 4 - 30, Math.floor(i / 16) * 4 - 30, 0],
        velocity: [0, 0, 0], age: 0, penetrationMm: 0, damage: 0, caliberM: .38, visited: [],
      });
      effects.update(sim, 0, camera);
      renderer.info.reset();
      renderer.render(scene, camera);
      const pixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, 512, 512);
      let visible = 0;
      // Count occupied grid cells; row order differs between GPU backends.
      for (let y = 16; y < 512; y += 32) for (let x = 16; x < 512; x += 32) {
        // The target stores linear color; dark steel is only about 18/255 red.
        if (pixels[(y * 512 + x) * 4] > 1) visible++;
      }
      const draws = renderer.info.render.drawCalls;
      frames.push({ shells: count, visible, draws });
      if (visible !== count) throw new Error(`Expected ${count} visible shells, got ${visible}: ${JSON.stringify(frames)}`);
      // Six particle batches, shell bodies, streaks/glows, torpedo/depth-charge
      // bodies and the two-sided wake (two draws). Shell billboards stay single-pass.
      if (draws > 13) throw new Error(`Effect draw budget exceeded: ${JSON.stringify(frames)}`);
    }
    // Check the trail itself, beyond the bright head/body covered by the grid.
    sim.shells.splice(1);
    Object.assign(sim.shells[0], { position: [0, 0, 0], velocity: [120, 0, 0], age: 1 });
    effects.update(sim, 0, camera); renderer.render(scene, camera);
    const flight = await renderer.readRenderTargetPixelsAsync(target, 0, 0, 512, 512);
    let trailPixels = 0;
    for (let y = 254; y <= 257; y++) for (let x = 128; x < 240; x++) {
      if (flight[(y * 512 + x) * 4] > 20) trailPixels++;
    }
    if (trailPixels < 40) throw new Error(`Flight trail disappeared: ${trailPixels} visible pixels`);
    sim.shells[0].velocity = [0, 0, -120];
    effects.update(sim, 0, camera); renderer.render(scene, camera);
    const endOn = await renderer.readRenderTargetPixelsAsync(target, 0, 0, 512, 512);
    // The quieter tip uses the same visible-contrast floor as the flight trail.
    const endOnBrightness = endOn[(256 * 512 + 256) * 4];
    if (endOnBrightness < 20) throw new Error(`End-on shell glow disappeared: ${endOnBrightness}`);
    effects.reset(); renderer.render(scene, camera);
    const reset = await renderer.readRenderTargetPixelsAsync(target, 0, 0, 512, 512);
    for (let i = 0; i < reset.length; i += 4) if (reset[i] > 0) throw new Error('Reset left tracer pixels');
    return { backend: forceWebGL ? 'webgl2' : 'webgpu', frames, trailPixels, endOnBrightness };
  } finally {
    target.dispose();
    effects.dispose();
    renderer.dispose();
  }
}
