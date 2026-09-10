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
    fleetOrders: { [id]: { manual: false, movement: { type: 'route', waypoints: [[100, 200], [300, 400]], speedMps: 10, looped: false }, weapons: { guns: true, aa: true, torpedoes: false } } },
    observationTracks: [
      { id: 'hidden-air-report', kind: 'aircraft', status: 'stale', affiliation: 'hostile', classification: 'Torpedo bomber', estimatedPosition: [200, 400, 900], measuredPosition: [200, 400, 900], velocity: [0, 0, 0], uncertaintyM: 5000, lastObservedTick: 0, sources: [] },
      { id: 'contact-a-1', kind: 'surface', status: 'tracked', affiliation: 'hostile', classification: 'Large warship', identifiedPresetId: 'yamato', estimatedPosition: [4000, 0, -9000], measuredPosition: [4000, 0, -9000], velocity: [0, 0, 0], uncertaintyM: 40, lastObservedTick: 0, sources: [{ observerId: id, kind: 'surface', tick: 0, strength: 1 }] },
    ],
    shipScores: { [id]: { damageDealt: 12400, frags: 1 } },
  });
  const game = { simulation, selectedShipIds: [], selectedFlightIds: [], controlGroups: new Map([[1, { name: 'Group 1', shipIds: [id] }]]) } as unknown as Game;
  const data: Telemetry = { ship: simulation.ship, order: 1, camera: 'Chase', fps: 60, backend: 'test', trail: [], combat: simulation.telemetry('main', [0, 0, -5000]), fleetCommandMode: true, airOperationsOpen: true, selectedShipIds: [] };
  const render = (state = data) => renderToStaticMarkup(<FleetCommand data={state} game={game} bindings={defaultKeybindings()}/>);
  return { render, data, id, simulation };
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

test('the chart shows every formation, the enemy fleet and an order wheel with hotkeys for the selected ship', () => {
  const { render, data, id } = fixture();
  const html = render({ ...data, selectedShipIds: [id] });
  expect(html).toContain('aria-label="Fleet roster"');
  expect(html).toContain('<kbd>1</kbd>Bismarck');
  expect(html).toContain('12.4k dmg · 1 sunk');
  expect(html).toContain('aria-label="Own fleet"');
  // The own card reports the standing order beside each ship, the roster only its score.
  expect(html).toContain('Route · 19 kn · Waypoint 1/2');
  expect(html).toContain('aria-label="Enemy fleet"');
  expect(html).toContain('Yamato');
  expect(html).toContain('1 torpedo bomber');
  expect(html).toContain('aria-label="Battle comparison"');
  expect(html).toContain('12,400');
  expect(html).toContain('aria-label="Order wheel"');
  for (const item of ['Move · G', 'Hold · H', 'Escort · E', 'Focus fire · F', 'Column · C · formation', '20 kn · + / −']) expect(html).toContain(`aria-label="${item}"`);
  expect(html).toContain('Take helm<kbd>T</kbd>');
  expect(html).toContain('Weapons policy');
  expect(html).toContain('fleet-command-hull');
  expect(html).not.toContain('Middle-drag orbit');
  expect(html).toContain('data-map-fade="');
  expect(html).toContain('data-track="hidden-air-report"');
});

test('helm command overlay stays compact so regular instruments have the full lower screen', () => {
  const { render, data, id } = fixture();
  const html = render({ ...data, airOperationsOpen: false, controlledShipId: id });
  expect(html).toContain('Fleet helm controls');
  expect(html).toContain('Give back helm');
  expect(html).not.toContain('Order wheel');
  expect(html).not.toContain('Enemy fleet');
  expect(html).not.toContain('Own fleet');
  expect(html).not.toContain('Fleet roster');
});

test('following keeps one compact panel with the helm and the chart a key away', () => {
  const { render, data, id } = fixture();
  const html = render({ ...data, airOperationsOpen: false, spectatedShipId: id });
  expect(html).toContain('aria-label="Following ship"');
  expect(html).toContain('Captain in command');
  expect(html).toContain('Take helm <kbd>T</kbd>');
  expect(html).toContain('Fleet command <kbd>M</kbd>');
  expect(html).toContain('Weapons policy');
  expect(html).not.toContain('Order wheel');
  expect(html).not.toContain('Own fleet');
  expect(html).not.toContain('Give back helm');
});

test('standing-order report distinguishes temporary evasion from its retained route', async () => {
  const { standingOrder } = await import('./FleetCommand');
  const order = { movement: { type: 'route', waypoints: [[0, 1000]], speedMps: 10, looped: false }, navigation: { status: 'evading-torpedo', waypoint: 0 } } as unknown as import('../multiplayer/generated/FleetOrderState').FleetOrderState;
  expect(standingOrder(order)).toContain('Avoiding spotted torpedoes');
  expect(standingOrder(order)).toContain('Waypoint 1/1');
});

test('enemy HP appears only for current sightings with sampled health', () => {
  const { render, simulation } = fixture();
  Object.assign(simulation, {
    observedShips: [{ id: 'contact-a-1', health: .42, observedTick: 0 }],
    observedAircraft: [{ id: 'hidden-air-report', health: .73, observedTick: 0 }],
  });
  expect(render()).toContain('42% HP');
  expect(render()).not.toContain('73% HP');
  const tracks = (simulation as unknown as { observationTracks: { status: string }[] }).observationTracks;
  tracks[0].status = 'tracked';
  expect(render()).toContain('aria-valuenow="73"');
  expect(render()).not.toContain('73% HP');
  tracks[1].status = 'stale';
  expect(render()).not.toContain('42% HP');
});
