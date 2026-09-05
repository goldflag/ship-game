import { hitShip, updateFlooding, type Shell } from '../../src/simulation/damage';
import { localToWorld, normalize, scale, sub } from '../../src/simulation/geometry';

/** Development-only acceptance fixture, imported through Vite. Uses the mounted
 * game's real simulation, inspection renderer and React telemetry callback.
 * This is a controlled underwater shot with pumps off, not normal gunnery or an
 * FPS benchmark. Reload after use. No production debug/mutation API is exposed. */
export function mountedGame(): any {
  const el = document.querySelector('.ocean-viewport') as any;
  let fiber = el?.[Object.keys(el).find(k => k.startsWith('__reactFiber'))!];
  for (; fiber; fiber = fiber.return) for (let hook = fiber.memoizedState, i = 0; hook && i < 100; hook = hook.next, i++) {
    const value = hook.memoizedState?.current;
    if (value?.simulation && value?.diagnostics) return value;
  }
  throw new Error('Mounted game not found');
}
export async function floodingReplay() {
  const game = mountedGame();
  await game.initialization;
  if (game.inPort || game.definition.id !== 'bismarck') throw new Error('Enter a Bismarck battle first');
  cancelAnimationFrame(game.raf); await game.frameTask; cancelAnimationFrame(game.raf);
  game.setPaused(false); cancelAnimationFrame(game.raf);
  const actor = game.simulation.target, def = actor.definition;
  if (def.id !== 'bismarck') throw new Error('Bismarck target required');
  def.compartments.forEach((c: any) => c.pumpM3PerSecond = 0);
  const from = localToWorld([-30, -2, -21], actor.motion), to = localToWorld([30, -2, -21], actor.motion);
  const shell: Shell = { id: 900001, ownerId: 'player', position: from, velocity: scale(normalize(sub(to, from)), 820), age: 0, penetrationMm: 10000, damage: 1, caliberM: .38, visited: [] };
  game.simulation.shells.push(shell);
  hitShip(shell, from, to, actor, def, game.simulation.emit);
  game.simulation.shells.splice(game.simulation.shells.indexOf(shell), 1);
  game.simulation.shellHistory.find((h: any) => h.shellId === shell.id).outcome = 'passed-through';
  for (let i = 0; i < 36000; i++) updateFlooding(actor, def, 1 / 60);
  game.fleetViews.forEach((view: any) => view.snap());
  game.gunneryOpen = true;
  if (!game.inspecting) game.inspectTarget();
  game.paused = true; // Freeze this fixture, without opening the pause dialog.
  game.rig.update(game.targetView.motion, game.targetView.motion.y, 0, true);
  game.hudTime = -Infinity;
  await game.frame(performance.now()); cancelAnimationFrame(game.raf);
  return { fixture: '600 s flooding only, 380 mm / 10000 mm penetration / 1 damage through-shot, pumps off', diagnostics: game.diagnostics() };
}
export function captureCanvas(): string {
  const game = mountedGame();
  game.renderFrame();
  return game.renderer.domElement.toDataURL('image/png');
}
export async function articulationReview() {
  const game = mountedGame();
  await game.initialization;
  cancelAnimationFrame(game.raf); await game.frameTask; cancelAnimationFrame(game.raf);
  const result = [];
  for (const trainFraction of [-1, 1]) {
    const d = game.previewArticulation({ trainFraction, elevationFraction: 1, recoilFraction: 1 });
    result.push({ shipId: d.shipId, contentHash: d.contentHash, trainFraction, maxMuzzleErrorM: d.maxMuzzleErrorM });
  }
  game.previewArticulation(null); game.scheduleFrame();
  return result;
}
