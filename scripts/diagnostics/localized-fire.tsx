/** Development-only fixture. Real Game/WebGPU, production HUD and finite fire state.
 * Seeded heat is deliberately separate from the ordinary-combat replay. */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { CombatSimulation } from '../../src/simulation/combat';
import { Game } from '../../src/game/Game';
import { FleetHud } from '../../src/ui/FleetHud';
import { ShipContext } from '../../src/ui/ShipContext';
import { defaultKeybindings } from '../../src/game/keybindings';
import { heatMount, heatRoom, updateDamageControl } from '../../src/simulation/damageControl';
import '../../src/ui/styles.css';
import '@fontsource/barlow/latin-400.css';
import '@fontsource/barlow/latin-500.css';
import '@fontsource/barlow-condensed/latin-500.css';
const status = document.querySelector('output')!;
let Hud = FleetHud;
const root = createRoot(document.querySelector('#hud')!);
let ready!: () => void;
const loaded = new Promise<void>(resolve => ready = resolve);
const game = new Game(document.querySelector('#scene')!, { quality: 'medium', resolution: 1 }, {
  progress: message => status.textContent = message, ready, telemetry() {}, pause() {}, hud() {},
  error: message => { status.textContent = message; Object.assign(window, { reviewError: message }); },
});
const g = game as any;
let optics = false;
function hud() {
  root.render(<ShipContext.Provider value={game.definition}><Hud game={game} visible bindings={defaultKeybindings()} data={{
    ship: { ...game.simulation.player.motion }, order: 3, camera: 'Chase', binoculars: optics, magnification: optics ? 8 : 1,
    fps: 60, backend: 'WebGPU', trail: [], pointerLocked: true, combat: game.simulation.telemetry('main', [0, 0, -1000]),
  }}/></ShipContext.Provider>);
}
function camera(view = 'normal', updateHud = true) {
  optics = view === 'optics';
  game.rig.binoculars = optics;
  const pose = (optics ? game.simulation.target : game.simulation.player).motion;
  game.camera.fov = optics ? 5.625 : 45;
  game.camera.position.set(pose.x + (optics ? 1800 : 290), 105, pose.z + (optics ? 700 : 215));
  game.camera.lookAt(pose.x, 8, pose.z); game.camera.updateProjectionMatrix(); game.camera.updateMatrixWorld(); if (updateHud) hud();
}
async function render() { hud(); await new Promise(requestAnimationFrame); await g.frame(performance.now()); }
async function advance(seconds: number) {
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    game.simulation.step({ throttle: .5, rudder: 0 }, { aim: [0, 0, -5000], fire: false, battery: 'main', controlPriority: game.controlPriority, controlFocus: game.controlFocus });
    g.fleetViews.forEach((view: any) => view.snap());
    camera(optics ? 'optics' : 'normal', false);
    game.effects.update(game.simulation, 1 / 60, game.camera, optics, g.fleetViews);
  }
  camera(optics ? 'optics' : 'normal'); await render(); return report();
}
function report() { return { tick: game.simulation.tick, effects: game.effects.diagnostics(), player: game.simulation.telemetry('main', [0, 0, 0]).playerFires,
  pose: { ...game.simulation.player.motion }, hash: game.definition.contentHash }; }
async function prepare() {
  game.setPaused(true);
  game.simulation.reset(); game.effects.reset(); game.controlPriority = 'balanced'; game.controlFocus = '';
  for (const actor of game.simulation.actors) {
    actor.controller = actor === game.simulation.player ? 'player' : 'idle';
    Object.assign(actor.motion, { x: actor === game.simulation.player ? 0 : -350, z: actor === game.simulation.player ? 0 : -280, heading: 0 });
    heatMount(actor, 0, 140); heatMount(actor, 3, 140);
    const room = actor.definition.compartments.findIndex(c => c.fire?.ventPosition && actor.definition.modules.some(m => m.kind === 'engine' && m.compartmentId === c.id));
    heatRoom(actor, actor.definition, room, 140);
  }
  g.fleetViews.forEach((view: any) => view.snap()); camera(); return advance(6);
}
Object.assign(window, { fireReview: { game, prepare, advance, camera, render, report, useHud: (component: typeof FleetHud) => { Hud = component; hud(); } } });
game.start(); await loaded; game.setInPort(true);
await g.replaceFleet(new CombatSimulation(game.definition, { friendlyBots: [], enemies: [game.definition], seed: 1941 }), game.definition);
game.setInPort(false); game.setPaused(true); game.rig.update = () => {};
g.scheduleFrame = () => {}; cancelAnimationFrame(g.raf); await g.frameTask; cancelAnimationFrame(g.raf);
await prepare(); status.hidden = true; Object.assign(window, { reviewReady: true });

async function fleet(perTeam = 30) {
  game.setInPort(true);
  await g.replaceFleet(new CombatSimulation(game.definition, { friendlyBots: Array(perTeam - 1).fill(game.definition), enemies: Array(perTeam).fill(game.definition), seed: 1941 }), game.definition);
  game.setInPort(false); game.setPaused(true); game.effects.reset();
  game.simulation.actors.forEach((actor, i) => {
    actor.controller = actor === game.simulation.player ? 'player' : 'idle';
    Object.assign(actor.motion, { x: (i % 10 - 4.5) * 350, z: (Math.floor(i / 10) - 2.5) * 450, heading: 0 });
    heatMount(actor, 0, 140); heatMount(actor, 3, 140);
  });
  g.fleetViews.forEach((view: any) => view.snap());
  game.camera.position.set(1800, 1500, 2200); game.camera.lookAt(0, 0, 0); game.camera.fov = 45; game.camera.updateProjectionMatrix(); game.camera.updateMatrixWorld();
  for (let i = 0; i < 360; i++) {
    // Fixed CPU damage-control stepping isolates simultaneous-fires cost from bot gunnery.
    game.simulation.actors.forEach(actor => updateDamageControl(actor, actor.definition, 1 / 60, () => {}));
    game.simulation.tick++; game.effects.update(game.simulation, 1 / 60, game.camera, false, g.fleetViews);
  }
  await render(); return report();
}
async function measure(samples = 24) {
  const fireMeshes = g.effects.localFires ? [g.effects.localFires.root] : [g.effects.smoke.mesh, g.effects.fire.mesh];
  const renderer = g.renderer, oldAuto = renderer.info.autoReset, oldTracking = renderer.backend.trackTimestamp;
  renderer.info.autoReset = false; renderer.backend.trackTimestamp = renderer.hasFeature('timestamp-query');
  const values: Record<string, any> = { fires: { submit: [], gpu: [], adapter: [] }, clear: { submit: [], gpu: [], adapter: [] } };
  try {
    for (let i = -6; i < samples; i++) for (const visible of i % 2 ? [true, false] : [false, true]) {
      await new Promise(requestAnimationFrame); fireMeshes.forEach((mesh: any) => mesh.visible = visible);
      const updateStart = performance.now(); game.effects.update(game.simulation, 0, game.camera, false, g.fleetViews); const updateMs = performance.now() - updateStart;
      renderer.info.reset(); const start = performance.now(); g.renderFrame(); const cpu = performance.now() - start;
      const gpu = renderer.backend.trackTimestamp ? await renderer.resolveTimestampsAsync('render') : null;
      if (i < 0) continue;
      const row = values[visible ? 'fires' : 'clear']; row.submit.push(cpu); row.adapter.push(updateMs);
      if (gpu !== null) row.gpu.push(gpu); row.drawCalls = renderer.info.render.drawCalls;
    }
    const stats = (ns: number[]) => { ns.sort((a, b) => a - b); return { median: ns[Math.floor(ns.length / 2)] ?? null, p90: ns[Math.floor(ns.length * .9)] ?? null }; };
    return { actors: game.simulation.actors.length, canvas: [renderer.domElement.width, renderer.domElement.height], effects: game.effects.diagnostics(),
      timestampQueries: renderer.backend.trackTimestamp, results: Object.fromEntries(Object.entries(values).map(([key, row]) => [key, { submitMs: stats(row.submit), gpuMs: stats(row.gpu), adapterMs: stats(row.adapter), drawCalls: row.drawCalls }])) };
  } finally { renderer.info.autoReset = oldAuto; renderer.backend.trackTimestamp = oldTracking; fireMeshes.forEach((mesh: any) => mesh.visible = true); }
}
async function spread() {
  await prepare(); const actor = game.simulation.player;
  actor.damage.control.teams = []; // Explicit unattended-spread fixture; profiles and finite fuel remain unchanged.
  const link = actor.damage.connections.find(c => actor.definition.compartments[c.fromIndex].fire?.fuelSeconds && actor.definition.compartments[c.toIndex].fire?.fuelSeconds)!;
  link.state = 'damaged'; link.damageAreaM2 = .5;
  heatRoom(actor, actor.definition, link.fromIndex, 140);
  const snapshots = [{ phase: 'start', from: { ...actor.damage.control.rooms[link.fromIndex] }, to: { ...actor.damage.control.rooms[link.toIndex] } }];
  await advance(80);
  snapshots.push({ phase: 'spread', from: { ...actor.damage.control.rooms[link.fromIndex] }, to: { ...actor.damage.control.rooms[link.toIndex] } });
  return { from: actor.definition.compartments[link.fromIndex].id, to: actor.definition.compartments[link.toIndex].id, snapshots, report: report() };
}
Object.assign((window as any).fireReview, { fleet, measure, spread });
