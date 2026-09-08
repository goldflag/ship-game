/** Renderer-adapter CPU stress only; use fireReview.fleet()/measure() for GPU review. */
import { PerspectiveCamera } from 'three/webgpu';
import { CombatSimulation } from '../../src/simulation/combat';
import { shipPreset } from '../../src/ships/presets';
import { CombatEffects } from '../../src/game/CombatEffects';
import { writeFileSync } from 'node:fs';
const baseline = process.argv.includes('--baseline');
const Effects = baseline ? (await import('../../src/game/CombatEffects.baseline.ts')).CombatEffects : CombatEffects;
const def = shipPreset('bismarck');
const sim = new CombatSimulation(def, { friendlyBots: Array(29).fill(def), enemies: Array(30).fill(def), seed: 1941 });
const camera = new PerspectiveCamera(45, 16 / 9, 1, 20000), effects = new Effects();
camera.position.set(1800, 1500, 2200); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
sim.actors.forEach((actor, i) => {
  Object.assign(actor.motion, { x: (i % 10 - 4.5) * 350, z: (Math.floor(i / 10) - 2.5) * 450, heading: 0 });
  actor.damage.control.mounts.forEach(fire => fire.intensity = 1);
  actor.damage.control.rooms.forEach(fire => fire.intensity = 1);
});
const times: number[] = [];
for (let i = -120; i < 600; i++) {
  sim.tick++;
  const start = performance.now(); effects.update(sim, 1 / 60, camera); const elapsed = performance.now() - start;
  if (i >= 0) times.push(elapsed);
}
times.sort((a, b) => a - b);
const result = { fixture: '60 Bismarcks, every existing fire at intensity 1. Synthetic adapter saturation, not normal combat or a GPU timing.',
  bun: Bun.version, actors: sim.actors.length, burningLocations: sim.actors.reduce((n, a) => n + a.damage.control.rooms.length + a.damage.control.mounts.length, 0), samples: times.length,
  milliseconds: { median: times[300], p90: times[540], p99: times[594] }, effects: effects.diagnostics() };
writeFileSync(`assets/reviews/localized-fire/${baseline ? 'before' : 'after'}-cpu-cost.json`, JSON.stringify(result, null, 2) + '\n');
console.log(result); effects.dispose();
