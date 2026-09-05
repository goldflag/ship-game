import * as THREE from 'three/webgpu';
import { CombatEffects } from '../../src/game/CombatEffects';
import type { CombatSimulation } from '../../src/simulation/combat';
import type { rtt } from 'three/tsl';

/** Use window.review from combat-effects.html: real gunfire, sea, sky and final composition. */
export async function checkCombatSmokeHorizon(review: {
  still(scene: string, time: number): Promise<unknown>;
  game: { renderer: THREE.WebGPURenderer; finalFrame: ReturnType<typeof rtt> };
}) {
  await review.still('horizon', 2.5);
  const { renderer, finalFrame } = review.game;
  const target = finalFrame.renderTarget;
  const { width, height } = target;
  const pixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, width, height);
  const channel = (x: number, y: number, c: number) => {
    const value = pixels[(y * width + x) * 4 + c];
    return target.texture.type === THREE.HalfFloatType ? THREE.DataUtils.fromHalfFloat(value)
      : target.texture.type === THREE.FloatType ? value : value / 255;
  };
  // The left gun plume spans this band in the fixed 5 km binocular view.
  // Compare every row with clear sky/sea alongside it: the old post-fog pass
  // erased whole rows where the distant ocean reached its far-fade distance.
  const rows = [];
  for (let y = Math.round(height * .495); y <= Math.round(height * .53); y++) {
    let contrast = 0;
    for (let x = Math.round(width * .37); x <= Math.round(width * .42); x++) {
      const delta = Math.hypot(...[0, 1, 2].map(c => channel(x, y, c) - channel(Math.round(width * .28), y, c)));
      contrast = Math.max(contrast, delta);
    }
    rows.push({ y, contrast });
  }
  const erased = rows.filter(row => row.contrast < .04);
  if (erased.length) throw new Error(`Smoke erased across ${erased.length} horizon rows: ${JSON.stringify(erased)}`);
  return { width, height, checkedRows: rows.length, minimumContrast: Math.min(...rows.map(row => row.contrast)) };
}

/** Run through the dev server in a browser; verifies GPU pixels, not just CPU matrices. */
export async function checkCombatEffects(forceWebGL = false) {
  const renderer = new THREE.WebGPURenderer({ forceWebGL });
  await renderer.init();
  renderer.setSize(512, 512);
  const target = new THREE.RenderTarget(512, 512);
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-32, 32, 32, -32, .1, 100);
  camera.position.z = 20;
  const effects = new CombatEffects();
  scene.add(effects.root);
  const sim = { shells: [], events: [] } as unknown as CombatSimulation;
  const frames: { shells: number; visible: number }[] = [];
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
      renderer.render(scene, camera);
      const pixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, 512, 512);
      let visible = 0;
      // Count occupied grid cells; row order differs between GPU backends.
      for (let y = 16; y < 512; y += 32) for (let x = 16; x < 512; x += 32) {
        // The target stores linear color; dark steel is only about 18/255 red.
        if (pixels[(y * 512 + x) * 4] > 1) visible++;
      }
      frames.push({ shells: count, visible });
      if (visible !== count) throw new Error(`Expected ${count} visible shells, got ${visible}: ${JSON.stringify(frames)}`);
    }
    return { backend: forceWebGL ? 'webgl2' : 'webgpu', frames };
  } finally {
    target.dispose();
    effects.dispose();
    renderer.dispose();
  }
}
