// Development-only, paused review using the actual ocean, camera, simulation and HUD.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { Game } from '../../src/game/Game';
import { FleetHud } from '../../src/ui/FleetHud';
import { BinocularOverlay } from '../../src/ui/BinocularOverlay';
import { ShipContext } from '../../src/ui/ShipContext';
import { shipPreset } from '../../src/ships/presets';
import { defaultKeybindings } from '../../src/game/keybindings';
import '../../src/ui/styles.css';
import '@fontsource/barlow/latin-400.css';
import '@fontsource/barlow/latin-500.css';
import '@fontsource/barlow-condensed/latin-500.css';
import '@fontsource/barlow-condensed/latin-600.css';

const host = document.createElement('div'); host.className = 'ocean-viewport'; document.body.appendChild(host);
const hud = document.createElement('div'); document.body.appendChild(hud);
const root = createRoot(hud), noop = () => {};
const definition = shipPreset('bismarck');
const game: any = new Game(host, { quality: 'medium', resolution: 1 }, { progress: noop, ready: noop, pause: noop, hud: noop, telemetry: noop, error: message => { window.reviewError = message; } }, definition);
game.scheduleFrame = noop; game.setInPort(true); game.start();
await game.initialization;
await game.prepareBattle({ playerShipId: 'bismarck', friendlyBots: [], enemies: ['bismarck'], spawnDistance: 5000 });
game.setInPort(false); game.setPaused(true); game.water.deterministic = true;
game.manualAim = false; game.aimModule = ''; game.battery = 'main';
const sim = game.simulation;
Object.assign(sim.ship, { x: 0, y: 0, z: 0, heading: 0 });
Object.assign(sim.target.motion, { x: 0, y: 0, z: -5000, heading: Math.PI / 2 });
sim.actors.forEach(actor => { if (actor.controller === 'bot') actor.controller = 'idle'; });
for (let tick = 0; tick < 600; tick++) sim.step({ throttle: 0, rudder: 0 }, { aim: [0, .5, -5000], fire: false, battery: 'main' });
game.fleetViews.forEach(view => view.snap());
window.reviewGame = game;
window.reviewView = async ({ width = innerWidth, height = innerHeight, scope = true, hidden = false, hudScale = 1 } = {}) => {
  host.style.cssText = `position:absolute;width:${width}px;height:${height}px`;
  hud.style.cssText = `position:absolute;inset:0;width:${width}px;height:${height}px`;
  game.resize();
  game.setHudScale(hudScale);
  game.rig.binoculars = scope; game.rig.scopeMagnification = 8; game.rig.opticsTransition = undefined;
  game.currentAim = [0, .5, -5000];
  game.rig.update(game.playerView.motion, 0, 0, true);
  game.rig.aimAt(game.currentAim, game.playerView.motion);
  game.water.syncToTick(3600); await game.water.update(1 / 60);
  for (let i = 0; i < 8; i++) await game.frame(performance.now());
  const data = { ship: { ...sim.ship }, order: 1, camera: game.rig.mode, binoculars: scope, magnification: game.rig.magnification,
    pointerLocked: true, fps: 60, backend: game.water.backend, trail: [], combat: sim.telemetry('main', game.currentAim) };
  root.render(<ShipContext.Provider value={definition}><main className="game-shell" style={{ '--hud-scale': hudScale } as React.CSSProperties}><BinocularOverlay data={data}/><div className="hud-viewport"><FleetHud data={data} game={game} visible={!hidden} bindings={defaultKeybindings()}/></div></main></ShipContext.Provider>);
  return { width, height, scope, hidden, hudScale, flightTimeSeconds: data.combat.flightTimeSeconds, error: window.reviewError };
};
await window.reviewView(); window.reviewReady = true;
