import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { AirOperations } from '../../src/ui/AirOperations';
import { CombatSimulation } from '../../src/simulation/combat';
import { shipPreset } from '../../src/ships/presets';
import { Game } from '../../src/game/Game';
import { defaultKeybindings } from '../../src/game/keybindings';
import type { Telemetry } from '../../src/game/types';
import { PerspectiveCamera } from 'three/webgpu';
import { BattlefieldCamera } from '../../src/game/BattlefieldCamera';

/** Import on a blank Vite page. Freeze telemetry to exercise input between HUD updates. */
export async function checkCarrierSelection() {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const simulation = new CombatSimulation(shipPreset('enterprise-cv6'));
  const combat = simulation.telemetry('main', [0, 0, -5000]);
  const [first, second] = combat.airWing!.groups;
  first.active = true; first.position = [0, 420, 0]; first.destination = [1000, 0, 12000];
  const camera = new PerspectiveCamera(52, 1600 / 900, 1, 60000);
  const battlefieldCamera = new BattlefieldCamera(camera); battlefieldCamera.update();
  const frames = new Set<() => void>();
  let orders = 0, checks = 0;
  const game = Object.assign(Object.create(Game.prototype), {
    simulation, selectedFlightId: first.id, camera, battlefieldCamera, hudScale: 1,
    host: { clientWidth: 1600, clientHeight: 900 },
    onCameraFrame: (fn: () => void) => { frames.add(fn); return () => frames.delete(fn); },
    projectSquadron: () => ({ x: 300, y: 200 }),
    commandSquadron: () => { orders++; return true; },
  }) as Game;
  const data: Telemetry = { ship: simulation.ship, order: 1, camera: 'Chase', trail: [], fps: 60, backend: 'test', combat,
    airOperationsOpen: true, selectedFlightId: first.id,
    squadronMarkers: [{ ...first, ownerId: simulation.ship.id, team: 'friendly', screen: { x: 300, y: 200 } }] };
  const check = (condition: unknown, message: string) => { if (!condition) throw new Error(message); checks++; };
  const act = (fn: () => void) => flushSync(fn);
  const key = (code: string, repeat = false) => window.dispatchEvent(new KeyboardEvent('keydown', { code, repeat, bubbles: true, cancelable: true }));
  const selected = () => host.querySelector('.air-squadron-box[aria-pressed=true]');
  try {
    act(() => root.render(<AirOperations data={data} game={game} bindings={defaultKeybindings()}/>));
    const cards = host.querySelectorAll<HTMLButtonElement>('.air-squadron-box');
    act(() => cards[0].click());
    check(!selected() && !game.selectedFlightId && !host.querySelector('.air-route'), 'Click deselects immediately despite old telemetry');
    act(() => key('KeyR'));
    check(orders === 0, 'A deselected squadron cannot receive a command from stale telemetry');
    act(() => key('Digit1'));
    check(selected() === cards[0] && game.selectedFlightId === first.id, 'Hotkey selects');
    act(() => key('Digit1', true));
    check(selected() === cards[0], 'Holding the hotkey does not toggle repeatedly');
    act(() => key('KeyL'));
    check(host.querySelector('[data-action=patrol]'), 'Targeting arms');
    act(() => key('Digit1'));
    check(!selected() && !host.querySelector('[data-action=patrol]'), 'Hotkey deselects and cancels targeting');
    act(() => cards[1].click());
    check(selected() === cards[1] && game.selectedFlightId === second.id, 'Another squadron selects before telemetry updates');
    const tag = host.querySelector<HTMLButtonElement>('.air-squadron-tag')!;
    act(() => tag.click());
    check(selected() === cards[0] && game.selectedFlightId === first.id, 'Map label selects through the same handler');
    act(() => key('KeyL'));
    act(() => tag.click());
    check(!selected() && !game.selectedFlightId && !host.querySelector('[data-action=patrol]'), 'Map label toggles off and cancels targeting');
    act(() => cards[0].click());
    for (const radius of [8000, 4000, 2000, 1000, 600]) {
      battlefieldCamera.view.radius = radius; battlefieldCamera.update(); frames.forEach(fn => fn());
      const path = host.querySelector('.air-route')!.getAttribute('d')!;
      const [x1, y1, x2, y2] = path.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/g)!.map(Number);
      check(x2 > x1 && y2 > y1, `Live route keeps direction at radius ${radius}`);
    }
    return { passed: checks };
  } finally { root.unmount(); host.remove(); }
}
