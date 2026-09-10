import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { FleetCommand } from './FleetCommand';
import { CombatSimulation } from '../simulation/combat';
import { shipPreset } from '../ships/presets';
import { Game } from '../game/Game';
import { defaultKeybindings } from '../game/keybindings';
import type { Telemetry } from '../game/types';

function fixture() {
  const definition = shipPreset('bismarck'), simulation = new CombatSimulation(definition);
  const id = simulation.ship.id;
  Object.assign(simulation, {
    fleetOrders: { [id]: { manual: false, movement: { type: 'route', waypoints: [[100, 200], [300, 400]], speedMps: 10, looped: false } } },
    observationTracks: [{ id: 'hidden-air-report', kind: 'aircraft', status: 'stale', affiliation: 'hostile', estimatedPosition: [200, 400, 900], measuredPosition: [200, 400, 900], velocity: [0, 0, 0], uncertaintyM: 5000, lastObservedTick: 0 }],
  });
  const game = { simulation, selectedShipIds: [], selectedFlightIds: [], controlGroups: new Map() } as unknown as Game;
  const data: Telemetry = { ship: simulation.ship, order: 1, camera: 'Chase', fps: 60, backend: 'test', trail: [], combat: simulation.telemetry('main', [0, 0, -5000]), fleetCommandMode: true, airOperationsOpen: true, selectedShipIds: [] };
  const render = (state = data) => renderToStaticMarkup(<FleetCommand data={state} game={game} bindings={defaultKeybindings()}/>);
  return { render, data, id };
}

test('unselected owned routes retain waypoint markers and stale aircraft never draw uncertainty rings', () => {
  const { render } = fixture();
  const html = render();
  expect(html).toContain('Bismarck waypoint 1');
  expect(html).toContain('Bismarck waypoint 2');
  expect(html).toContain('data-route-owner=');
  expect(html).toContain('hidden-air-report');
  expect(html).not.toContain('fleet-command-uncertainty');
});

test('helm command overlay stays compact so regular instruments have the full lower screen', () => {
  const { render, data, id } = fixture();
  const html = render({ ...data, airOperationsOpen: false, controlledShipId: id });
  expect(html).toContain('Fleet helm controls');
  expect(html).toContain('Give back helm');
  expect(html).not.toContain('Command card');
  expect(html).not.toContain('Fleet views');
});

test('standing-order report distinguishes temporary evasion from its retained route', async () => {
  const { standingOrder } = await import('./FleetCommand');
  const order = { movement: { type: 'route', waypoints: [[0, 1000]], speedMps: 10, looped: false }, navigation: { status: 'evading-torpedo', waypoint: 0 } } as unknown as import('../multiplayer/generated/FleetOrderState').FleetOrderState;
  expect(standingOrder(order)).toContain('Avoiding spotted torpedoes');
  expect(standingOrder(order)).toContain('Waypoint 1/1');
});
