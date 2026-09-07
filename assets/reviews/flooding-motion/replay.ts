import { mountedGame } from '../../../scripts/tests/damage-realism-browser';
import { updateFlooding } from '../../../src/simulation/damage';
import { updateCapability } from '../../../src/simulation/stability';

/** Development-only review on the real ocean scene. Loads prescribed water
 * into both Bismarcks with pumps off; reload after use to restore the preset. */
export async function reviewFlooding(mode: 'afloat' | 'hull-loss' | 'capsize' = 'afloat', seconds = 60) {
  const game = mountedGame();
  await game.initialization;
  cancelAnimationFrame(game.raf); await game.frameTask; cancelAnimationFrame(game.raf);
  game.setInPort(false); cancelAnimationFrame(game.raf);
  game.simulation.reset();
  game.paused = true;
  game.simulation.actors.forEach((actor: any) => {
    actor.controller = actor === game.simulation.player ? 'player' : 'idle';
    const target = actor === game.simulation.target;
    Object.assign(actor.motion, { x: target ? 450 : 0, z: 0, heading: 0 });
    actor.definition.compartments.forEach((c: any, i: number) => {
      c.pumpM3PerSecond = 0;
      if (c.center[0] < -5) actor.damage.compartments[i].waterM3 = c.capacityM3 * (mode === 'capsize' ? .2 : .05);
    });
    if (mode === 'hull-loss') actor.damage.integrity = 0;
    for (let i = 0; i < seconds * 60; i++) updateFlooding(actor, actor.definition, 1 / 60);
    updateCapability(actor, actor.definition);
  });
  game.fleetViews.forEach((view: any) => view.snap());
  game.rig.azimuth = 0; game.rig.elevation = .12; game.rig.distance = 300;
  game.rig.update(game.playerView.motion, game.playerView.motion.y, 0, true);
  game.gunneryOpen = true; game.hudTime = -Infinity;
  await game.frame(performance.now()); cancelAnimationFrame(game.raf);
  // Fixed bow view for comparison, independent of the player's chase aim.
  game.camera.position.set(0, 18, -300); game.camera.lookAt(0, 1, 0);
  game.camera.updateMatrixWorld(true); await game.water.update(0); game.renderFrame();
  const actor = game.simulation.player;
  return { mode, seconds, hp: actor.damage.integrity, waterM3: actor.damage.compartments.reduce((s: number, c: any) => s + c.waterM3, 0),
    rollDeg: actor.motion.roll * 180 / Math.PI, trimDeg: actor.motion.pitch * 180 / Math.PI, y: actor.motion.y,
    sunk: actor.damage.sunk, cause: actor.damage.defeatCause, maxMuzzleErrorM: Math.max(...game.playerView.muzzleErrors()),
    renderedRoll: game.playerView.root.rotation.z, cpuRoll: actor.motion.roll };
}
