import { mountedGame } from './damage-realism-browser';
import { localToWorld, rotate } from '../../src/simulation/geometry';

/** Development-only deterministic landed broadside for HUD acceptance.
 * Enter a Bismarck duel, import through Vite, then reload after review. */
export async function landedBroadsides(count = 1) {
  const game = mountedGame();
  await game.initialization;
  if (game.inPort || game.definition.id !== 'bismarck' || game.simulation.target.definition.id !== 'bismarck') throw new Error('Start a Bismarck duel first');
  cancelAnimationFrame(game.raf); await game.frameTask; cancelAnimationFrame(game.raf);
  game.simulation.reset();
  const sim = game.simulation, actor = sim.target, weapon = game.definition.mounts[0].weapon;
  actor.controller = 'idle';
  Object.assign(sim.player.motion, { x: -5000, z: 0, heading: 0 });
  Object.assign(actor.motion, { x: 0, z: 0, heading: 0 });
  for (let volley = 0; volley < count; volley++) {
    for (const [i, z] of [-30, -21, -12, -3, 6, 15, 24, 33].entries()) sim.shells.push({
      id: 9000 + volley * 8 + i, ownerId: 'player', position: localToWorld([-20, .5, z], actor.motion),
      velocity: rotate([730, -35, 0], actor.motion), age: 0, penetrationMm: 550,
      damage: weapon.damage, caliberM: weapon.caliberM, visited: [], ammunition: 'ap', ap: weapon.ap,
    });
    for (let tick = 0; tick < 30; tick++) sim.step({ throttle: 0, rudder: 0 }, { aim: [0, .5, 0], fire: false, battery: 'main' });
  }
  game.fleetViews.forEach((view: any) => view.snap());
  game.gunneryOpen = true;
  if (!game.inspecting) game.inspectTarget();
  game.paused = true;
  game.rig.update(game.targetView.motion, game.targetView.motion.y, 0, true);
  game.hudTime = -Infinity;
  await game.frame(performance.now()); cancelAnimationFrame(game.raf);
  const data = sim.telemetry('main', [0, .5, 0]);
  return { volleys: count, hull: data.targetIntegrity, equipment: data.targetEquipmentIntegrity,
    damage: data.playerDamageDealt, frags: data.playerFrags, sunk: actor.damage.sunk, result: sim.result };
}
