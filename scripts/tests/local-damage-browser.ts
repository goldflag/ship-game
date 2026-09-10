import { mountedGame } from './damage-realism-browser';
import { heatModule, heatMount, updateDamageControl } from '../../src/simulation/damageControl';
import { hitShip, type Shell } from '../../src/simulation/damage';
import { localToWorld, rotate } from '../../src/simulation/geometry';
import { shipPreset } from '../../src/ships/presets';

const until = async (predicate: () => boolean) => {
  for (let i = 0; i < 300; i++) { if (predicate()) return; await new Promise(r => setTimeout(r, 100)); }
  throw new Error('Review state did not become ready');
};
async function readyGame() {
  let game: any;
  await until(() => { try { game = mountedGame(); return !!game; } catch { return false; } });
  await game.initialization;
  await until(() => !document.querySelector('[aria-label="Loading port"]'));
  return game;
}
export async function articulation(shipId: string) {
  const game = await readyGame();
  if (game.definition.id !== shipId) await game.switchShip(shipPreset(shipId));
  const results = [];
  for (const trainFraction of [-1, 1]) {
    const d = await game.previewArticulation({ trainFraction, elevationFraction: 1, recoilFraction: 1 });
    results.push({ shipId, contentHash: d.contentHash, trainFraction, maxMuzzleErrorM: d.maxMuzzleErrorM, maxTorpedoMuzzleErrorM: d.maxTorpedoMuzzleErrorM });
  }
  await game.previewArticulation(null);
  return results;
}

/** Controlled fixture in the actual battle UI, with the original sea/ship and
 * simulation-owned fires. The helper and its mutation API are development-only. */
export async function damageReview() {
  const game = await readyGame();
  const click = (text: string) => {
    const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim().toLowerCase().startsWith(text.toLowerCase()));
    if (!button) throw new Error(`Missing ${text} control`); button.click();
  };
  if (game.inPort) {
    click('Custom battle'); await new Promise(r => setTimeout(r, 100)); click('Start battle');
    await until(() => !game.inPort);
  }
  cancelAnimationFrame(game.raf); await game.frameTask; cancelAnimationFrame(game.raf);
  game.scheduleFrame = () => {};
  for (const actor of game.simulation.actors) actor.controller = 'idle';
  const sim = game.simulation, actor = sim.target, def = actor.definition;
  const losses = [];
  for (let i = 0; i < 16; i++) {
    const from = localToWorld([-30, .5, -21], actor.motion), to = localToWorld([30, .5, -21], actor.motion);
    const shell: Shell = { id: 900001 + i, ownerId: sim.player.motion.id, position: from, velocity: rotate([820, 0, 0], actor.motion), age: 0, penetrationMm: 550, damage: 70, caliberM: .38, visited: [] };
    sim.shells.push(shell);
    const before = actor.damage.integrity; hitShip(shell, from, to, actor, def, sim.emit);
    losses.push(before - actor.damage.integrity); sim.shells.length = 0;
  }
  for (const a of [sim.player, actor]) {
    heatMount(a, 0, 100);
    const engine = a.definition.modules.findIndex((m: any) => m.kind === 'engine');
    heatModule(a, a.definition, engine, 100);
    for (let i = 0; i < 60; i++) updateDamageControl(a, a.definition, 1 / 60, sim.emit);
  }
  game.fleetViews.forEach((v: any) => v.snap());
  game.paused = true;
  game.camera.position.set(actor.motion.x - 230, 100, actor.motion.z + 155);
  game.camera.lookAt(actor.motion.x, 8, actor.motion.z); game.camera.updateMatrixWorld();
  game.rig.update = () => {};
  for (let i = 0; i < 8; i++) { sim.tick += 15; game.effects.update(sim, .25, game.camera); }
  game.hudTime = -Infinity; await game.frame(performance.now()); cancelAnimationFrame(game.raf);
  await new Promise(r => setTimeout(r, 150));
  const result = { losses, controls: {
    text: document.querySelector('.fleet-hud')?.textContent, viewport: [innerWidth, innerHeight], overflow: document.documentElement.scrollWidth > innerWidth },
    combat: sim.telemetry('main', [0, 0, -1000]), effects: game.effects.diagnostics(),
    maxMuzzleErrorM: game.diagnostics().maxMuzzleErrorM };
  await game.renderFrame();
  await new Promise(r => setTimeout(r, 150));
  const exterior = game.renderer.domElement.toDataURL('image/png');
  game.inspectTarget(); game.hudTime = -Infinity; await game.frame(performance.now()); cancelAnimationFrame(game.raf);
  // WebGPU submits asynchronously. Let newly compiled inspection materials draw
  // before exporting the canvas, rather than capturing the previous exterior.
  for (let i = 0; i < 4; i++) { await game.frame(performance.now()); await new Promise(r => setTimeout(r, 100)); }
  return { ...result, exterior, inspection: game.renderer.domElement.toDataURL('image/png') };
}
