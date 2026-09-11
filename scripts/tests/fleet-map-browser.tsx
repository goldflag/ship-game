import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { FleetCommand } from '../../src/ui/FleetCommand';
import { CombatSimulation } from '../../src/simulation/combat';
import { shipPreset } from '../../src/ships/presets';
import type { Game } from '../../src/game/Game';
import type { Telemetry } from '../../src/game/types';
import { defaultKeybindings } from '../../src/game/keybindings';
import type { Vec3 } from '../../src/ships/blueprint';

/** Run on a Vite page: real React events/projection loop, deterministic telemetry. */
export function checkFleetMap(keep = false) {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;inset:0;z-index:10000;background:#10252f;color:#edf1ec;--fleet-active:#86e4c5;--fleet-gold:#e8c56c;--fleet-muted:#c1d0d4;--fleet-line:#c9dce04a';
  document.body.append(host);
  const root = createRoot(host), simulation = new CombatSimulation(shipPreset('enterprise-cv6'));
  const id = simulation.ship.id, frames = new Set<() => void>();
  const routes: { append: boolean; points: [number, number][] }[] = [];
  const order = { manual: false, movement: { type: 'hold', position: [0, 0] }, weapons: { guns: true, aa: true, torpedoes: false } };
  const position: Vec3 = [300, 400, 250];
  Object.assign(simulation, {
    phase: 'running', fleetOrders: { [id]: order }, orderReceipts: [],
    observationTracks: [{ id: 'plane-contact', kind: 'aircraft', status: 'tracked', affiliation: 'hostile', classification: 'Fighter', measuredPosition: position, estimatedPosition: position, velocity: [0, 0, -100], uncertaintyM: 20, lastObservedTick: 0, sources: [] }],
    observedAircraft: [{ id: 'plane-contact', health: .73, observedTick: 0, modelId: 'a6m2-zero' }],
    routeShip: (_: string, points: [number, number][], _speed: number, _loop: boolean, append: boolean) => {
      routes.push({ append, points });
      simulation.orderReceipts!.push({ state: 'queued', shipId: id, command: 'route' } as never);
    },
  });
  const wing = simulation.actors.find(a => a.motion.id === id)!.airWing!;
  const plane = wing.planes[0]; plane.phase = 'outbound'; plane.position = [500, 400, 250];
  let scale = .5, liveZ = 250;
  const project = (x: number, z: number): [number, number] => [250 + x * scale, 150 + z * scale];
  const game = {
    simulation, controlGroups: new Map(), selectedShipIds: [id], selectedFlightIds: [],
    onCameraFrame: (fn: () => void) => { frames.add(fn); return () => frames.delete(fn); },
    projectAirMap: project, projectAircraft: () => project(500, 250), projectContact: () => project(300, liveZ), projectContactGroup: () => project(300, liveZ),
    projectAirMapPath: (p: Vec3[], closed = false) => p.length ? `M${p.map(([x, , z]) => project(x, z).join(' ')).join('L')}${closed ? 'Z' : ''}` : '',
    airMapWater: (x: number, y: number) => [x, y], panAirMap: () => {},
    selectFleetShips: () => {}, selectFlights: () => {}, projectSquadron: () => null,
  } as unknown as Game;
  const data: Telemetry = { ship: simulation.ship, order: 1, camera: 'Chase', fps: 60, backend: 'test', trail: [], combat: simulation.telemetry('main', [0, 0, -5000]), fleetCommandMode: true, airOperationsOpen: true, selectedShipIds: [id] };
  let checks = 0;
  const check = (ok: unknown, message: string) => { if (!ok) throw new Error(message); checks++; };
  const act = (fn: () => void) => flushSync(fn);
  const render = () => act(() => root.render(<FleetCommand data={data} game={game} bindings={defaultKeybindings()}/>));
  try {
    render();
    const chart = host.querySelector('.fleet-command-chart')!;
    const click = (shiftKey: boolean, type = 'click', clientX = 700, clientY = 450) => act(() => chart.dispatchEvent(new MouseEvent(type, { clientX, clientY, shiftKey, bubbles: true, cancelable: true })));
    const key = (code: string, down = true) => act(() => chart.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, shiftKey: down && code.startsWith('Shift'), bubbles: true })));
    click(true);
    check(chart.hasAttribute('data-armed'), 'Placing a waypoint keeps Move mode active');
    key('ShiftLeft');
    const previewOrigin = () => JSON.parse(host.querySelector('.fleet-command-move-preview>path')!.getAttribute('data-map-path')!)[0];
    check(JSON.stringify(previewOrigin()) === '[700,0,450]', 'Holding Shift previews from the final queued waypoint');
    key('ShiftLeft', false);
    check(JSON.stringify(previewOrigin()) === JSON.stringify([simulation.ship.x, 0, simulation.ship.z]), 'Releasing Shift previews a replacement from the ship');
    key('ShiftLeft');
    check(JSON.stringify(previewOrigin()) === '[700,0,450]', 'Pressing Shift updates the preview without moving the pointer');
    check(routes.length === 1 && !routes[0].append, 'First Shift-click creates a route when none exists');
    click(true, 'click', 800, 500); click(true, 'click', 900, 550);
    check(JSON.stringify(previewOrigin()) === '[900,0,550]', 'Each appended waypoint becomes the preview origin');
    check(routes.length === 3 && routes[1].append && routes[2].append, 'Subsequent Shift-clicks append without rearming Move');
    check(host.querySelectorAll('.fleet-command-waypoint').length === 3, 'Queued waypoints remain visible before authority updates');
    click(false, 'contextmenu');
    check(routes.length === 4 && !routes[3].append, 'Plain right-click replaces the route');
    check(chart.hasAttribute('data-armed'), 'Replacement waypoints also keep Move mode active');
    key('Escape');
    check(!chart.hasAttribute('data-armed') && routes.length === 4, 'Escape ends placement without erasing the route');
    key('ShiftLeft', false);
    const enemy = host.querySelector<SVGGElement>('[data-track="plane-contact"]')!;
    const friendly = host.querySelector<SVGGElement>(`[data-plane="${plane.id}"]`)!;
    check(friendly, 'Friendly airborne fixture is rendered');
    const hp = (el: Element) => el.querySelector<SVGElement>('[data-map-detail]')!;
    check(getComputedStyle(hp(enemy)).display === 'none' && getComputedStyle(hp(friendly)).display === 'none', 'Both affiliations hide distant unselected health');
    act(() => enemy.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    frames.forEach(fn => fn());
    check(getComputedStyle(hp(enemy)).display !== 'none', 'Clicking an enemy reveals its compact meter');
    check(hp(enemy).getAttribute('aria-valuenow') === '73' && !hp(enemy).querySelector('text'), 'Enemy condition is accessible without printed HP text');
    act(() => chart.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 700, clientY: 450 })));
    scale = 1.5; frames.forEach(fn => fn());
    check(getComputedStyle(hp(enemy)).display !== 'none' && getComputedStyle(hp(friendly)).display !== 'none', 'Close zoom reveals both affiliations');
    scale = .5; frames.forEach(fn => fn());
    check(getComputedStyle(hp(enemy)).display === 'none' && getComputedStyle(hp(friendly)).display === 'none', 'Zooming out hides unselected health again');
    for (liveZ of [250, 245, 235, 220]) {
      frames.forEach(fn => fn());
      check(enemy.querySelector('[data-map-heading]')!.getAttribute('transform') === 'rotate(0)', 'Live contact interpolation never reverses heading');
    }
    return { passed: checks };
  } finally { if (!keep) { root.unmount(); host.remove(); } }
}
