import * as THREE from 'three/webgpu';
import { CombatEffects } from '../../src/game/CombatEffects';
import type { CombatSimulation } from '../../src/simulation/combat';

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
        if (pixels[(y * 512 + x) * 4] > 20) visible++;
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
