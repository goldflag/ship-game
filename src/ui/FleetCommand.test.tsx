import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { applyGroupFormation, FleetCommand, FORMATION_HINT } from './FleetCommand';
import { CombatSimulation } from '../simulation/combat';
import { shipPreset } from '../ships/presets';
import { Game } from '../game/Game';
import { defaultKeybindings } from '../game/keybindings';
import type { Telemetry } from '../game/types';
import type { FleetOrderState } from '../multiplayer/generated/FleetOrderState';
import type { ControlGroup } from '../game/Game';
import type { Formation } from '../multiplayer/generated/Formation';
import { resolveBattleFleet } from '../simulation/battle';
import { shipClassOf } from './shipGlyphs';
import { SCREEN_INNER_RADIUS_M, SCREEN_OUTER_RADIUS_M, STATION_RADIUS_M } from './formationStations';

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
  for (const item of ['Move · G', 'Hold · H', 'Escort · E', 'Focus fire · F', '20 kn · + / −']) expect(html).toContain(`aria-label="${item}"`);
  // The formation is a property of the group, not a global toggle on the wheel.
  expect(html).not.toContain('C · formation');
  expect(html).toContain('aria-label="Formation"');
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


test('an unselected blocked ship exposes its route and warnings, then clears them on recovery', () => {
  const { render, id, simulation } = fixture();
  const order = (simulation as unknown as Game['simulation']).fleetOrders![id];
  order.navigation = { order: order.movement, waypoint: 1, status: 'blocked', destination: [300, 400], formation: null };
  const html = render();
  expect(html).toContain('fleet-command-course blocked');
  expect(html).toContain('fleet-command-route-alert');
  expect(html).toContain('Bismarck route blocked · Reassign destination');
  expect(html.match(/class="fleet-route-warning"/g)).toHaveLength(2);
  expect(html).not.toContain('Bismarck waypoint 2');
  expect(html).toContain('[300,0,400]');
  order.navigation.status = 'following-route';
  const recovered = render();
  expect(recovered).not.toContain('fleet-command-course blocked');
  expect(recovered).not.toContain('fleet-command-route-alert');
  expect(recovered).not.toContain('class="fleet-route-warning"');
});

const fleetFixture = (formation: Formation = 'column', notices: { tick: number; shipId: string; kind: 'guide-assumed'; text: string }[] = []) => {
  const definition = shipPreset('bismarck');
  const simulation = new CombatSimulation(definition, resolveBattleFleet({ playerShipId: 'bismarck', friendlyBots: ['fletcher', 'baltimore'], enemies: ['yamato'], spawnDistance: 7500 }, shipPreset));
  const escorts: { id: string; leaderId: string; offset: [number, number]; radiusM: number; formation?: Formation; slot?: number }[] = [];
  const standing = (movement: FleetOrderState['movement']): FleetOrderState => ({ movement, weapons: { guns: true, aa: true, torpedoes: false }, formationPolicy: 'slow-for-stragglers', targetId: null, manual: false, navigation: null });
  Object.assign(simulation, { phase: 'running', fleetNotices: notices,
    fleetOrders: { player: standing({ type: 'hold' }),
      'friendly-1': standing({ type: 'escort', leaderId: 'player', offset: [0, 900], radiusM: 160, formation, slot: 1 }),
      'friendly-2': standing({ type: 'escort', leaderId: 'player', offset: [0, 450], radiusM: 160, formation, slot: 0 }) },
    escortShip: (id: string, leaderId: string, offset: [number, number], radiusM: number, kind?: Formation, slot?: number) => { escorts.push({ id, leaderId, offset, radiusM, formation: kind, slot }); } });
  const owned = simulation.telemetry('main', [0, 0, -7500]).contacts.filter(c => c.team === 'friendly');
  const controlGroups = new Map<number, ControlGroup>([[1, { name: 'Group 1', shipIds: owned.map(c => c.id), formation }]]);
  const game = { simulation, selectedShipIds: [], selectedFlightIds: [], controlGroups } as unknown as Game;
  const data: Telemetry = { ship: simulation.ship, order: 1, camera: 'Chase', fps: 60, backend: 'test', trail: [], combat: simulation.telemetry('main', [0, 0, -7500]), fleetCommandMode: true, airOperationsOpen: true, selectedShipIds: [] };
  const render = (selectedShipIds: string[]) => renderToStaticMarkup(<FleetCommand data={{ ...data, selectedShipIds }} game={game} bindings={defaultKeybindings()}/>);
  return { render, game, controlGroups, escorts, owned, classes: owned.map(c => shipClassOf(simulation.actors.find(a => a.motion.id === c.id)!.definition)) };
};

test('the formation picker acts on the selected group and explains itself when the selection is not one', () => {
  const { render, owned } = fleetFixture();
  const whole = render(owned.map(c => c.id));
  expect(whole).toContain('aria-label="Formation"');
  for (const label of ['Column', 'Double column', 'Triple column', 'Screen', 'Line abreast']) expect(whole).toContain(`>${label}</button>`);
  // The group sails in column until the picker says otherwise, and says so on the rail and in the roster.
  expect(whole).toContain('aria-pressed="true">Column</button>');
  expect(whole).toContain('Line ahead. Followers turn in succession');
  expect(whole).toContain('3 ships · Column');
  expect(whole).not.toContain(FORMATION_HINT);
  const partial = render([owned[0].id]);
  expect(partial).toContain('aria-label="Formation"');
  expect(partial).toContain(FORMATION_HINT);
  expect(partial).not.toContain('aria-pressed="true">Column</button>');
  expect(partial).toContain('disabled=""');
});

test('choosing a formation records it on the control group and re-stations every escort by role', () => {
  const { game, controlGroups, escorts, owned, classes } = fleetFixture();
  const group = { index: 1, name: 'Bismarck formation', leaderId: owned[0].id, shipIds: owned.map(c => c.id), formation: 'column' as Formation };
  expect(controlGroups.get(1)!.formation).toBe('column');
  const members = owned.map((c, i) => ({ id: c.id, shipClass: classes[i] }));
  expect(classes).toEqual(['battleship', 'destroyer', 'cruiser']);
  expect(applyGroupFormation(game, group, 'screen', members)).toBe('2 escort orders queued · Screen');
  // The group keeps how it sails, so the roster, the chart and a later Move all agree.
  expect(controlGroups.get(1)).toEqual({ name: 'Group 1', shipIds: owned.map(c => c.id), formation: 'screen' });
  // Cruiser inside, destroyer outside: role order decides the slots, and every order carries both.
  expect(escorts.map(e => [e.id, e.formation, e.slot, e.radiusM])).toEqual([
    [owned[2].id, 'screen', 0, STATION_RADIUS_M],
    [owned[1].id, 'screen', 1, STATION_RADIUS_M],
  ]);
  expect(escorts.map(e => e.leaderId)).toEqual([owned[0].id, owned[0].id]);
  expect(escorts[0].offset).toEqual([0, -SCREEN_INNER_RADIUS_M]);
  expect(SCREEN_INNER_RADIUS_M).toBe(700);
  expect(escorts[1].offset).toEqual([0, -SCREEN_OUTER_RADIUS_M]);
  // A column puts the same ships astern at the battleship's interval, heavies nearest.
  escorts.length = 0;
  expect(applyGroupFormation(game, { ...group, formation: 'screen' }, 'column', members)).toBe('2 escort orders queued · Column');
  expect(escorts.map(e => [e.id, e.offset, e.slot])).toEqual([[owned[2].id, [0, 450], 0], [owned[1].id, [0, 900], 1]]);
  expect(controlGroups.get(1)!.formation).toBe('column');
  // A double column re-stations the same pair abeam and astern of the guide's own column.
  escorts.length = 0;
  expect(applyGroupFormation(game, { ...group, formation: 'column' }, 'double-column', members)).toBe('2 escort orders queued · Double column');
  expect(escorts.map(e => [e.id, e.formation, e.offset, e.slot])).toEqual([
    [owned[2].id, 'double-column', [450, 0], 0],
    [owned[1].id, 'double-column', [0, 450], 1],
  ]);
  expect(controlGroups.get(1)!.formation).toBe('double-column');
  // A group with nobody to station still records the formation it was set to.
  expect(applyGroupFormation(game, { ...group, shipIds: [owned[0].id] }, 'line-abreast', [members[0]])).toBe('Bismarck formation · Line abreast · no escorts to station');
});

test('a guide-assumed notice reaches the feedback line so the fleet knows who has the group', () => {
  const { render, owned } = fleetFixture('column', [{ tick: 120, shipId: 'friendly-1', kind: 'guide-assumed', text: 'Fletcher 2 has the guide' }]);
  expect(render(owned.map(c => c.id))).toContain('Fletcher 2 has the guide');
  expect(render([])).toContain('Fletcher 2 has the guide');
});

test("the guide's label clears its escorts: to port in column, above the marker in a screen", () => {
  const column = fleetFixture('column').render([]);
  expect(column).toContain('<text x="-14" y="-3" text-anchor="end">Bismarck</text>');
  const screen = fleetFixture('screen').render([]);
  expect(screen).toContain('<text x="0" y="-32" text-anchor="middle">Bismarck</text>');
  // Escorts and unled ships keep their labels to starboard.
  expect(screen).toContain('<text x="14" y="-3" text-anchor="start">Fletcher</text>');
  expect(screen).toContain('3 ships · Screen');
});
