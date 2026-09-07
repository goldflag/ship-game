import { reviewHelm, reviewIntent } from './mixed-fleet.ts';

function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    median: sorted[Math.floor(sorted.length * .5)],
    p95: sorted[Math.floor(sorted.length * .95)],
    mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
  };
}

/** Completed frame work, independent of requestAnimationFrame throttling in an
 * occluded browser. This is a diagnostic clock, not an observed display FPS. */
export async function measureFleetFrames(game, { warmup = 30, frames = 120, battleTick = 3600, view = 'battle' } = {}) {
  if (![warmup, frames, battleTick].every(Number.isSafeInteger) || warmup < 0 || frames < 1 || battleTick < game.simulation.tick) {
    throw new Error('Use nonnegative integer warmup/tick and positive frames; reload before repeating a replay.');
  }
  if (!['battle', 'overview'].includes(view)) throw new Error('Choose battle or overview.');
  const { renderer, simulation } = game;
  for (let i = simulation.tick; i < battleTick; i++) simulation.step(reviewHelm, reviewIntent);
  game.fleetViews.forEach(ship => ship.snap());
  const player = simulation.player.motion;
  if (view === 'overview') {
    game.camera.position.set(0, 9000, 12000);
    game.camera.lookAt(0, 0, -2500);
  } else {
    game.camera.position.set(player.x + 190, player.y + 100, player.z + 230);
    game.camera.lookAt(player.x, player.y + 5, player.z);
  }
  game.camera.updateMatrixWorld();
  game.paused = false;
  const samples = [], draws = [], triangles = [];
  const phases = { simulation: [], render: [], water: [] };
  const originals = [], autoReset = renderer.info.autoReset;
  renderer.info.autoReset = false;
  for (const [target, key, name] of [[simulation, 'advance', 'simulation'], [game, 'renderFrame', 'render'], [game.water, 'update', 'water']]) {
    const original = target[key];
    originals.push(() => { target[key] = original; });
    target[key] = function (...args) {
      const start = performance.now(), value = original.apply(this, args);
      if (value?.then) return value.then(result => { phases[name].push(performance.now() - start); return result; });
      phases[name].push(performance.now() - start);
      return value;
    };
  }
  try {
    for (let i = 0; i < warmup + frames; i++) {
      renderer.info.reset();
      const start = performance.now();
      // Three's render-to-texture passes otherwise reuse the last rAF frame.
      renderer._nodes.nodeFrame.update();
      renderer.info.frame = renderer._nodes.nodeFrame.frameId;
      game.lastTime = start - 1000 / 60;
      await game.frame(start);
      if (renderer.backend.device) await renderer.backend.device.queue.onSubmittedWorkDone();
      else renderer.backend.gl.finish();
      if (i >= warmup) {
        samples.push(performance.now() - start);
        draws.push(renderer.info.render.drawCalls);
        triangles.push(renderer.info.render.triangles);
      }
    }
    if (draws.some(count => count < 100)) throw new Error('A frame did not render the fleet.');
    const state = JSON.stringify({ actors: simulation.actors, shells: simulation.shells,
      torpedoes: simulation.torpedoes, aircraft: simulation.aircraft, events: simulation.events });
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(state));
    const stateHash = [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join('');
    return {
      view, camera: game.camera.position.toArray(), stateHash, completedGpuWork: true, samples: frames,
      drawCalls: stats(draws), triangles: stats(triangles), ships: simulation.actors.length, tick: simulation.tick,
      framebuffer: [renderer.domElement.width, renderer.domElement.height], frameWorkMs: stats(samples),
      phases: Object.fromEntries(Object.entries(phases).map(([key, values]) => [key, stats(values.slice(warmup))])),
      shells: simulation.shells.length, draws: game.fleetDraws?.diagnostics(),
    };
  } finally {
    game.paused = true;
    renderer.info.autoReset = autoReset;
    originals.forEach(restore => restore());
  }
}
