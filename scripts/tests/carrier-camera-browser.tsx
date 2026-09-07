import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { PerspectiveCamera } from 'three/webgpu';
import { FleetHud } from '../../src/ui/FleetHud';
import { Game } from '../../src/game/Game';
import { BattlefieldCamera } from '../../src/game/BattlefieldCamera';
import { InputController } from '../../src/game/InputController';
import { defaultKeybindings } from '../../src/game/keybindings';
import { CombatSimulation } from '../../src/simulation/combat';
import { shipPreset } from '../../src/ships/presets';
import type { Telemetry } from '../../src/game/types';

/** Run on a blank Vite page; use the real H binding, HUD, map handlers and camera. */
export async function checkCarrierCamera() {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;inset:0;container: hud / size'; document.body.append(host);
  const root = createRoot(host), bindings = defaultKeybindings();
  const simulation = new CombatSimulation(shipPreset('enterprise-cv6'));
  const camera = new PerspectiveCamera(52, innerWidth / innerHeight, 1, 60000);
  const battlefieldCamera = new BattlefieldCamera(camera); battlefieldCamera.update();
  let toggleHud = () => {}, optics = 0, checks = 0;
  const noop = () => {};
  const input = new InputController({ hud: () => toggleHud(), optics: () => { optics++; },
    pause: noop, camera: noop, recenter: noop, fullscreen: noop, weaponGroup: noop, cursor: noop, chartSize: noop, shellFollow: noop }, bindings);
  const game = Object.assign(Object.create(Game.prototype), { simulation, camera, battlefieldCamera, hudScale: 1, host,
    input, onCameraFrame: () => noop, projectSquadron: () => null }) as Game;
  const data: Telemetry = { ship: simulation.ship, order: 1, camera: 'Chase', trail: [], fps: 60, backend: 'test',
    airOperationsOpen: true, airMap: battlefieldCamera.view, combat: simulation.telemetry('main', [0, 0, -5000]) };
  function Fixture() {
    const [visible, setVisible] = useState(true); toggleHud = () => setVisible(v => !v);
    return <FleetHud data={data} game={game} bindings={bindings} visible={visible}/>;
  }
  const check = (value: unknown, message: string) => { if (!value) throw new Error(message); checks++; };
  const key = (code: string, type = 'keydown', shiftKey = false) => window.dispatchEvent(new KeyboardEvent(type, { code, shiftKey, bubbles: true, cancelable: true }));
  const act = (fn: () => void) => flushSync(fn);
  const frames = async () => { for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame); };
  try {
    act(() => root.render(<Fixture/>));
    act(() => key('KeyH')); key('KeyH', 'keyup');
    const map = host.querySelector<SVGSVGElement>('.air-battlefield-map')!;
    check(host.querySelector('.fleet-hud-hidden') && !map.closest('[inert]'), 'H hides instruments without making the map inert');
    check(getComputedStyle(map).visibility === 'visible' && !host.querySelector('.air-squadron-box'), 'Hidden HUD retains only the visible transparent map surface');
    const hit = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
    check(hit && map.contains(hit), 'The browser hit-tests the map with H off');
    // Synthetic pointers have no browser capture identity; test capture-independent motion here.
    map.setPointerCapture = noop; map.hasPointerCapture = () => false;
    const drag = (button: number, shiftKey = false) => act(() => {
      const rect = map.getBoundingClientRect(), x = rect.width / 2, y = rect.height / 2;
      for (const [type, dx, dy] of [['pointerdown', 0, 0], ['pointermove', 60, -35], ['pointerup', 60, -35]] as const) {
        map.dispatchEvent(new PointerEvent(type, { button, buttons: type === 'pointerup' ? 0 : button === 1 ? 4 : 1, pointerId: 1, pointerType: 'mouse', clientX: x + dx, clientY: y + dy, shiftKey, bubbles: true, cancelable: true }));
      }
    });
    const startX = data.airMap!.x;
    drag(0); check(data.airMap!.x !== startX, 'Dragging pans with H off');
    const radius = data.airMap!.radius;
    map.dispatchEvent(new WheelEvent('wheel', { deltaY: -200, clientX: innerWidth / 2, clientY: innerHeight / 2, bubbles: true, cancelable: true }));
    check(data.airMap!.radius < radius, 'Wheel zoom works with H off');
    drag(1); check(!!data.airMap!.bearing && !!data.airMap!.tilt, 'Middle-drag changes the camera angle');
    const bearing = data.airMap!.bearing;
    drag(0, true); check(data.airMap!.bearing !== bearing, 'Shift-drag changes the angle');
    const x = data.airMap!.x;
    key('ArrowRight'); await frames(); key('ArrowRight', 'keyup');
    check(data.airMap!.x !== x, 'Arrow keys pan with H off');
    const tilt = data.airMap!.tilt;
    key('ShiftLeft', 'keydown', true); key('ArrowUp', 'keydown', true); await frames(); key('ArrowUp', 'keyup', true); key('ShiftLeft', 'keyup');
    check(data.airMap!.tilt !== tilt && optics === 0, 'Shift+arrows tilt without toggling ship optics');
    act(() => key('KeyH')); key('KeyH', 'keyup');
    check(host.querySelector('.air-squadron-box'), 'H restores the squadron controls');
    const reset = [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Reset angle')!;
    act(() => reset.click());
    check(data.airMap!.bearing === 0 && Math.abs(data.airMap!.tilt! - Math.PI / 9) < 1e-8, 'Reset angle restores the original view');
    return { passed: checks };
  } finally { input.dispose(); root.unmount(); host.remove(); }
}
