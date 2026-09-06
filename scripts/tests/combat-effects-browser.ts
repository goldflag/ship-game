import * as THREE from 'three/webgpu';
import { CombatEffects } from '../../src/game/CombatEffects';
import { EffectParticlePool, effectTexture } from '../../src/game/EffectParticles';
import { effectVolumeMaterial, effectVolumeTexture } from '../../src/game/EffectVolume';
import { configureRenderOrder } from '../../src/game/renderOrder';
import { uniform, viewportDepthTexture } from 'three/tsl';
import type { CombatSimulation } from '../../src/simulation/combat';
import type { rtt } from 'three/tsl';

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
  const frames: { view: string; visiblePixels: number; draws: number }[] = [];
  const render = async (view: string, visible: boolean, draws: number) => {
    camera.updateMatrixWorld(); pool.update(0, camera, wind);
    renderer.info.reset(); renderer.render(scene, camera);
    const pixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, 256, 256);
    let visiblePixels = 0;
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 2) visiblePixels++;
    const calls = renderer.info.render.drawCalls;
    frames.push({ view, visiblePixels, draws: calls });
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
    pool.reset();
    await render('reset', false, 1);
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
  const sim = { shells: [], events: [] } as unknown as CombatSimulation;
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
      // Five particle batches, shell bodies and streaks. A billboard must not
      // acquire a second front/back submission as the salvos grow or reset.
      if (draws > 7) throw new Error(`Effect draw budget exceeded: ${JSON.stringify(frames)}`);
    }
    return { backend: forceWebGL ? 'webgl2' : 'webgpu', frames };
  } finally {
    target.dispose();
    effects.dispose();
    renderer.dispose();
  }
}
