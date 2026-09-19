import { expect, test } from 'bun:test';
import { CommandQueue, type OrderReceipt } from '../../game/session/commandQueue';
import { CombatSimulation } from '../../simulation/combat';
import type { FleetActor } from '../../simulation/battle';
import { KNOTS_PER_MPS } from '../../game/session/motion';
import { shipPreset } from '../../ships/presets';
import type { Vec3 } from '../../ships/blueprint';
import type { ContactTrack } from '../../multiplayer/generated/ContactTrack';
import type { FleetOrderState } from '../../multiplayer/generated/FleetOrderState';
import { SCREEN_INNER_RADIUS_M, SCREEN_OUTER_RADIUS_M, STATION_RADIUS_M } from '../formationStations';
import { SQUADRON_ACTIONS } from '../airCommands';
import { fleetDesk, type ControlGroup, type FleetAuthority, type FleetFrame, type FleetOrder } from './fleetDesk';
import {
  advancePendingRoute,
  advancePendingRoutes,
  applyGroupFormation,
  boxSelect,
  fleetBoxSelection,
  fleetDragMode,
  fleetView,
  fleetWaterAction,
  nextNotice,
  projectAirMarker,
  projectMapHeading,
  reportGesture,
  sendAirOrder,
  sendHold,
  sendRoute,
  sendSearch,
  shipGesture,
  type Contact,
  type FleetViewInputs,
  type PendingRoute,
} from './fleetView';

// ---- A literal frame: three owned hulls in one column, a reported enemy, and a
// recording door that answers a route the way the session's queue does.

const hull = (id: string, presetId: string, x: number, z: number, speedMps = 8): FleetActor =>
  ({
    motion: { id, x, z, speed: speedMps, heading: 0 },
    team: 'friendly',
    definition: shipPreset(presetId),
    damage: { integrity: 9000, maxIntegrity: 10000, sunk: false },
  }) as unknown as FleetActor;
const contact = (id: string, name: string, shipId: string, x: number, z: number, team: Contact['team'] = 'friendly'): Contact => ({
  id,
  name,
  shipId,
  team,
  controller: 'bot',
  x,
  z,
  heading: 0,
  speed: 8,
  integrity: 0.9,
  sunk: false,
  status: 'operational',
  combatLost: false,
  physicalLost: false,
});
const standing = (movement: FleetOrderState['movement'], navigation: FleetOrderState['navigation'] = undefined): FleetOrderState => ({
  movement,
  weapons: { guns: true, aa: true, torpedoes: false },
  formationPolicy: 'slow-for-stragglers',
  targetId: undefined,
  manual: false,
  navigation,
});
const report: ContactTrack = {
  id: 'contact-b-1',
  kind: 'surface',
  affiliation: 'hostile',
  status: 'tracked',
  firstObservedTick: 0,
  lastObservedTick: 600,
  measuredPosition: [9000, 0, -9000],
  estimatedPosition: [9000, 0, -9000],
  velocity: [0, 0, 0],
  uncertaintyM: 40,
  identificationConfidence: 1,
  classification: 'Large warship',
  identifiedPresetId: 'yamato',
  sources: [{ observerId: 'unit-1', kind: 'surface', tick: 600, strength: 1 }],
};

function fixture() {
  const frame: FleetFrame & { orderReceipts: OrderReceipt[] } = {
    tick: 600,
    phase: 'running',
    ship: { id: 'unit-1', x: 0, z: 0 },
    actors: [hull('unit-1', 'bismarck', 0, 0, 10), hull('unit-2', 'fletcher', 0, 450, 10), hull('unit-3', 'fletcher', 0, 900, 10)],
    observationTracks: [report],
    observedShips: [{ id: 'contact-b-1', health: 0.42, observedTick: 600 } as never],
    missionRules: { area: { radiusM: 20000, warningMarginM: 1500 } } as never,
    fleetOrders: {
      'unit-1': standing({ type: 'hold' }),
      'unit-2': standing({ type: 'escort', leaderId: 'unit-1', offset: [0, 450], radiusM: 160, formation: 'column', slot: 0 }),
      'unit-3': standing({ type: 'escort', leaderId: 'unit-1', offset: [0, 900], radiusM: 160, formation: 'column', slot: 1 }),
    },
    fleetNotices: [],
    orderReceipts: [],
    shipScores: { 'unit-1': { damageDealt: 12400, frags: 1 } },
  };
  const contacts = [
    contact('unit-1', 'Bismarck', 'bismarck', 0, 0),
    contact('unit-2', 'Fletcher', 'fletcher', 0, 450),
    contact('unit-3', 'Fletcher', 'fletcher', 0, 900),
    contact('enemy-1', 'Yamato', 'yamato', 9000, -9000, 'enemy'),
  ];
  const orders: FleetOrder[] = [];
  const queue = new CommandQueue();
  /** The door under test records every order; a route also earns a receipt, as the session's queue would give it. */
  const issue = (order: FleetOrder) => {
    orders.push(order);
    if (order.kind === 'route') {
      queue.enqueue(order.shipId, {
        type: 'route',
        waypoints: [order.point],
        speedMps: order.speedMps,
        looped: false,
        append: order.append,
      });
      frame.orderReceipts.push(queue.receipts.at(-1)!);
    }
    return true;
  };
  const controlGroups = new Map<number, ControlGroup>([
    [1, { name: 'Group 1', shipIds: ['unit-1', 'unit-2', 'unit-3'], formation: 'column' }],
  ]);
  const inputs = (selectedShipIds: string[] = [], rest: Partial<FleetViewInputs> = {}): FleetViewInputs => ({
    combat: { contacts, result: 'active' },
    selectedShipIds,
    selectedFlightIds: [],
    controlGroups,
    mapOpen: true,
    ...rest,
  });
  const view = (selectedShipIds: string[] = [], rest: Partial<FleetViewInputs> = {}) => fleetView(frame, inputs(selectedShipIds, rest));
  return { frame, contacts, orders, queue, issue, controlGroups, view };
}

test('rows and marks come from the frame: numbered names, the column under its guide, standing orders and the guide label side', () => {
  const { view } = fixture();
  const v = view();
  expect(v.ships.map((s) => s.name)).toEqual(['Bismarck', 'Fletcher 1', 'Fletcher 2']);
  expect(v.formations.map((f) => [f.index, f.name, f.leaderId, f.shipIds, f.formation])).toEqual([
    [1, 'Bismarck formation', 'unit-1', ['unit-1', 'unit-2', 'unit-3'], 'column'],
  ]);
  expect(v.ownShips.map((s) => [s.name, s.kn, s.order, s.damageDealt, s.shipClass])).toEqual([
    ['Bismarck', Math.round(10 * KNOTS_PER_MPS), 'Stop', 12400, 'battleship'],
    ['Fletcher 1', Math.round(10 * KNOTS_PER_MPS), 'Escort Bismarck · Assigned', 0, 'destroyer'],
    ['Fletcher 2', Math.round(10 * KNOTS_PER_MPS), 'Escort Bismarck · Assigned', 0, 'destroyer'],
  ]);
  expect(v.markerOf(v.ships[0]).side).toBe('port');
  expect(v.markerOf(v.ships[1]).side).toBe('starboard');
  expect(v.markerOf(v.ships[0]).own).toBe(true);
  // An escort's station link only shows on its own; the whole formation sails on the guide's route.
  expect(v.courseOf(v.ships[1]).escortLink).toBe(true);
  expect(view(['unit-2']).courseOf(v.ships[1]).escortLink).toBe(false);
  expect(v.courseOf(v.ships[1]).points).toEqual([
    [0, 0, 450],
    [0, 0, 450],
  ]);
  expect(v.bracketOf(v.formations[0])!.points).toEqual([
    [-420, 0, -420],
    [420, 0, -420],
    [420, 0, 1320],
    [-420, 0, 1320],
  ]);
  // The enemy is the report and the telemetry contact; its health rides on a current sighting.
  expect(v.enemies.map((e) => e.id)).toEqual(['enemy-1', 'contact-b-1']);
  expect(v.healthOf(report)).toBe(0.42);
  expect(v.actionable).toBe(true);
  expect(
    fleetView(
      { ...view().frame, phase: 'loading' },
      { combat: { contacts: [], result: 'active' }, selectedShipIds: [], selectedFlightIds: [], controlGroups: new Map(), mapOpen: true },
    ).actionable,
  ).toBe(false);
});

test('off the chart the seat follows one hull, and the subject is the only recipient', () => {
  const { view } = fixture();
  const following = view([], { mapOpen: false, spectatedShipId: 'unit-2' });
  expect(following.subject?.id).toBe('unit-2');
  expect(following.recipients.map((s) => s.id)).toEqual(['unit-2']);
  const chart = view(['unit-1', 'unit-2']);
  expect(chart.subject).toBeUndefined();
  expect(chart.recipients.map((s) => s.id)).toEqual(['unit-1', 'unit-2']);
  expect(chart.selectedGroup).toBeUndefined();
  expect(view(['unit-1', 'unit-2', 'unit-3']).selectedGroup?.index).toBe(1);
});

test('box-select then move: the box picks the hulls, the door gets one route for the lead and a station for every other ship', () => {
  const { orders, issue, view, frame } = fixture();
  // The box covers the guide and the first escort but not the second.
  const contains = ([x, , z]: Vec3) => x >= -100 && x <= 100 && z >= -100 && z <= 500;
  const picked = boxSelect(view(), 'ships', contains);
  expect(picked).toEqual({ kind: 'ships', ids: ['unit-1', 'unit-2'] });
  issue({ kind: 'select-ships', ids: picked.ids });
  const selected = view(picked.ids);
  const { note, pending } = sendRoute(selected, issue, [3000, 4000], 20, false, selected.leadRoute({}));
  expect(note).toBe('Route queued · 20 kn · Column');
  expect(orders).toEqual([
    { kind: 'select-ships', ids: ['unit-1', 'unit-2'] },
    { kind: 'route', shipId: 'unit-1', point: [3000, 4000], speedMps: 20 / KNOTS_PER_MPS, append: false },
    { kind: 'escort', shipId: 'unit-2', leaderId: 'unit-1', offset: [0, 450], radiusM: STATION_RADIUS_M, formation: 'column', slot: 0 },
  ]);
  // The receipt the session handed back keeps the queued path on the chart until an authority frame carries it.
  expect(pending).toEqual({
    points: [
      [0, 0, 0],
      [3000, 0, 4000],
    ],
    receipt: frame.orderReceipts[0],
  });
  expect(selected.courseOf(selected.ships[0], pending).waypoints).toEqual([[3000, 0, 4000]]);
  // Shift extends the route from its last waypoint instead of starting over.
  const extended = sendRoute(selected, issue, [5000, 6000], 20, true, pending!.points);
  expect(extended.note).toBe('Waypoint appended · 20 kn · Column');
  expect(extended.pending?.points).toEqual([
    [0, 0, 0],
    [3000, 0, 4000],
    [5000, 0, 6000],
  ]);
  expect(orders.at(-2)).toEqual({ kind: 'route', shipId: 'unit-1', point: [5000, 6000], speedMps: 20 / KNOTS_PER_MPS, append: true });
  // A destination with nothing in hand orders nothing.
  expect(sendRoute(view(), issue, [1, 1], 20, false, []).note).toBe('Select ships before giving a destination.');
  expect(orders.filter((o) => o.kind === 'route')).toHaveLength(2);
  expect(sendHold(selected, issue)).toBe('2 hold orders queued · 500 m station area');
  expect(orders.slice(-2)).toEqual([
    { kind: 'hold-area', shipId: 'unit-1', position: [0, 0], radiusM: 500 },
    { kind: 'hold-area', shipId: 'unit-2', position: [0, 450], radiusM: 500 },
  ]);
});

test('a control-group assignment records the formation on the group and re-stations its escorts by role through the same door', () => {
  const { orders, issue, view, controlGroups } = fixture();
  const v = view(['unit-1', 'unit-2', 'unit-3']);
  const note = applyGroupFormation({ controlGroups, issue }, v.selectedGroup!, 'screen', v.afloat.map(v.stationShip));
  expect(note).toBe('2 escort orders queued · Screen');
  expect(orders).toEqual([
    { kind: 'control-group', index: 1, group: { name: 'Group 1', shipIds: ['unit-1', 'unit-2', 'unit-3'], formation: 'screen' } },
    // Two destroyers both take the outer ring of the screen, ahead and astern of the guide.
    {
      kind: 'escort',
      shipId: 'unit-2',
      leaderId: 'unit-1',
      offset: [0, -SCREEN_OUTER_RADIUS_M],
      radiusM: STATION_RADIUS_M,
      formation: 'screen',
      slot: 0,
    },
    {
      kind: 'escort',
      shipId: 'unit-3',
      leaderId: 'unit-1',
      offset: [0, SCREEN_OUTER_RADIUS_M],
      radiusM: STATION_RADIUS_M,
      formation: 'screen',
      slot: 1,
    },
  ]);
  expect(SCREEN_INNER_RADIUS_M).toBeLessThan(SCREEN_OUTER_RADIUS_M);
  // Over a live game the desk's door lands the group on the game's own ledger and the escorts on the session.
  const escorts: unknown[][] = [];
  const authority = {
    simulation: {
      escortShip: (...args: unknown[]) => {
        escorts.push(args);
      },
    },
    controlGroups: new Map(controlGroups),
  } as unknown as FleetAuthority;
  const desk = fleetDesk(authority);
  expect(applyGroupFormation(desk, v.selectedGroup!, 'line-abreast', v.afloat.map(v.stationShip))).toBe(
    '2 escort orders queued · Line abreast',
  );
  expect(desk.controlGroups.get(1)!.formation).toBe('line-abreast');
  expect(escorts.map((e) => [e[0], e[1], e[4], e[5]])).toEqual([
    ['unit-2', 'unit-1', 'line-abreast', 0],
    ['unit-3', 'unit-1', 'line-abreast', 1],
  ]);
  // A session without escort orders refuses them at the door.
  expect(
    fleetDesk({ simulation: {}, controlGroups: new Map() } as unknown as FleetAuthority).issue({
      kind: 'escort',
      shipId: 'a',
      leaderId: 'b',
      offset: [0, 0],
      radiusM: 1,
      formation: 'column',
      slot: 0,
    }),
  ).toBe(false);
});

test('clicks on hulls and reports resolve to one gesture each, with the armed order and the selection deciding', () => {
  const { view } = fixture();
  const v = view(['unit-1']);
  expect(shipGesture(v, { id: 'unit-2', team: 'friendly' }, { right: false, additive: true })).toEqual({
    act: 'select-ship',
    id: 'unit-2',
    additive: true,
  });
  expect(shipGesture(v, { id: 'unit-2', team: 'friendly' }, { right: true, additive: false })).toEqual({
    act: 'escort',
    leaderId: 'unit-2',
  });
  expect(shipGesture(v, { id: 'unit-2', team: 'friendly' }, { right: false, additive: false, armed: 'escort' })).toEqual({
    act: 'escort',
    leaderId: 'unit-2',
  });
  expect(shipGesture(v, { id: 'enemy-1', team: 'enemy' }, { right: false, additive: false })).toEqual({
    act: 'inspect',
    id: 'enemy-1',
    target: true,
  });
  expect(shipGesture(v, { id: 'enemy-1', team: 'enemy' }, { right: true, additive: false })).toEqual({ act: 'focus', targetId: 'enemy-1' });
  expect(shipGesture(v, { id: 'enemy-1', team: 'enemy' }, { right: false, additive: false, armed: 'search' })).toEqual({
    act: 'feedback',
    text: 'Choose water for the center of the search area.',
  });
  expect(reportGesture(v, report, { right: true })).toEqual({ act: 'focus', targetId: 'contact-b-1' });
  // The report's standing comes from the frame, not from the marker that was clicked.
  const stale = fleetView(
    { ...v.frame, observationTracks: [{ ...report, status: 'stale' }] },
    { combat: { contacts: [], result: 'active' }, selectedShipIds: [], selectedFlightIds: [], controlGroups: new Map(), mapOpen: true },
  );
  expect(reportGesture(stale, report, { right: true })).toEqual({
    act: 'feedback',
    text: 'Report is stale. Search its last reported area before attacking.',
  });
  const sinking = fleetView(
    { ...v.frame, observationTracks: [{ ...report, visibleCondition: { sinking: true } as never }] },
    { combat: { contacts: [], result: 'active' }, selectedShipIds: [], selectedFlightIds: [], controlGroups: new Map(), mapOpen: true },
  );
  expect(reportGesture(sinking, report, { right: true })).toEqual({ act: 'feedback', text: 'Sinking already confirmed.' });
  const air = { ...report, id: 'air-1', kind: 'aircraft' as const };
  expect(reportGesture(v, air, { right: false })).toEqual({ act: 'inspect', id: 'air-1', target: false });
  expect(reportGesture(v, air, { right: true })).toEqual({
    act: 'feedback',
    text: 'Select a fighter group and Intercept, then choose an aircraft contact.',
  });
});

test('the air wing summary and orders come from the carriers in the frame', () => {
  const simulation = new CombatSimulation(shipPreset('enterprise-cv6'));
  Object.assign(simulation, { phase: 'running', missionRules: { area: { radiusM: 20000, warningMarginM: 1500 } } });
  const combat = simulation.telemetry('main', [0, 0, -5000]);
  const inputs = (selectedFlightIds: string[]): FleetViewInputs => ({
    combat,
    selectedShipIds: [],
    selectedFlightIds,
    controlGroups: new Map(),
    mapOpen: true,
  });
  const v = fleetView(simulation, inputs([]));
  expect(v.wings).toHaveLength(1);
  expect(v.flights.length).toBeGreaterThan(0);
  expect(v.flights.every((f) => f.ownerId === simulation.ship.id && f.carrierName === combat.contacts[0].name)).toBe(true);
  expect(v.ownWing).toEqual({ remaining: 48, total: 48, airborne: 0, onDeck: 0, inHangar: 48 });
  expect(v.ownShips[0].aircraft).toEqual({ remaining: 48, total: 48 });
  const fighter = v.flights.find((f) => f.role === 'fighter')!,
    bomber = v.flights.find((f) => f.role !== 'fighter')!;
  const chosen = fleetView(simulation, inputs([fighter.id, bomber.id]));
  expect(chosen.selectedFlights.map((f) => f.id)).toEqual([fighter.id, bomber.id]);
  expect(chosen.flightCentroid).toBeDefined();
  const orders: FleetOrder[] = [];
  const issue = (order: FleetOrder) => {
    orders.push(order);
    return true;
  };
  // Defend takes fighters only; the bomber is skipped and counted.
  const defend = { kind: 'defend', label: 'Defend', key: 'D', role: 'fighter', target: 'a friendly ship' } as never;
  expect(sendAirOrder(chosen, issue, defend, { kind: 'ship', id: simulation.ship.id, team: 'friendly' })).toEqual({
    sent: true,
    note: '1 air group orders queued · 1 incompatible groups skipped',
  });
  expect(orders).toEqual([{ kind: 'squadron', flightId: fighter.id, order: { kind: 'defend', targetId: simulation.ship.id } }]);
  // A patrol wants water; aimed at a hull it asks again and orders nothing.
  const patrol = SQUADRON_ACTIONS.find((a) => a.kind === 'patrol')!;
  expect(sendAirOrder(chosen, issue, patrol, { kind: 'ship', id: simulation.ship.id, team: 'friendly' })).toEqual({
    sent: false,
    note: `Choose ${patrol.target}.`,
  });
  expect(orders).toHaveLength(1);
  // A search needs turning room inside the boundary before any group is asked.
  expect(sendSearch(chosen, issue, [19000, 0], { radiusM: 4000, altitude: 'medium', policy: 'report' })).toEqual({
    sent: false,
    note: 'The search area needs 1.5 km of turning room inside the battle boundary.',
  });
  expect(sendSearch(chosen, issue, [1000, 0], { radiusM: 4000, altitude: 'medium', policy: 'strike' })).toEqual({
    sent: true,
    note: '1 search orders queued · 1 fighter groups skipped',
  });
  expect(orders.at(-1)).toEqual({
    kind: 'squadron',
    flightId: bomber.id,
    order: { kind: 'search-area', center: [1000, 0], radiusM: 4000, altitude: 'medium', policy: 'strike' },
  });
});

test('a guide-assumed notice is read once, in the roster name', () => {
  const { frame, view } = fixture();
  expect(nextNotice(view(), 0)).toEqual({ seen: 0 });
  frame.fleetNotices = [{ tick: 700, shipId: 'unit-3', kind: 'guide-assumed', text: 'Fletcher has the guide' }];
  expect(nextNotice(view(), 0)).toEqual({ seen: 1, text: 'Fletcher 2 has the guide' });
  expect(nextNotice(view(), 1)).toEqual({ seen: 1 });
  frame.fleetNotices = [];
  expect(nextNotice(view(), 1)).toEqual({ seen: 0 });
});

// ---- Box selection, drag modes and water clicks.

const containsBox = ([x, , z]: Vec3) => x >= 10 && x <= 20 && z >= 10 && z <= 20;
const planes = [
  { id: 'wingman', flightId: 'carrier-a/flight', position: [15, 200, 15] as Vec3 },
  { id: 'leader-outside', flightId: 'carrier-a/flight', position: [300, 200, 300] as Vec3 },
  { id: 'another-carrier', flightId: 'carrier-b/flight', position: [17, 300, 17] as Vec3 },
];
test('boxing individual planes selects their flights across carriers even on the Ships tab', () => {
  expect(fleetBoxSelection([], planes, 'ships', containsBox)).toEqual({ kind: 'aircraft', ids: ['carrier-a/flight', 'carrier-b/flight'] });
});
test('mixed boxes use the active tab, deduplicate flights and still select ships from the Aircraft tab', () => {
  const ships = [{ id: 'ship', position: [15, 0, 15] as Vec3 }];
  expect(fleetBoxSelection(ships, planes, 'ships', containsBox)).toEqual({ kind: 'ships', ids: ['ship'] });
  expect(fleetBoxSelection(ships, [...planes, planes[0]], 'aircraft', containsBox)).toEqual({
    kind: 'aircraft',
    ids: ['carrier-a/flight', 'carrier-b/flight'],
  });
  expect(fleetBoxSelection(ships, [], 'aircraft', containsBox)).toEqual({ kind: 'ships', ids: ['ship'] });
});
test('Shift-left drag selects, Ctrl/Cmd adds to the box selection, and unshifted modifiers orbit', () => {
  expect(fleetDragMode(0, true, false, false)).toBe('select');
  expect(fleetDragMode(0, true, true, false)).toBe('select');
  expect(fleetDragMode(0, false, true, false)).toBe('orbit');
  expect(fleetDragMode(1, true, false, false)).toBe('orbit');
  expect(fleetDragMode(0, true, false, true)).toBe('pan');
  const { view } = fixture();
  expect(boxSelect(view(), 'ships', () => true, { shipIds: ['unit-3'], flightIds: [] })).toEqual({
    kind: 'ships',
    ids: ['unit-3', 'unit-1', 'unit-2'],
  });
});
test('a destination is one click: plain sends and releases, Shift extends, right leaves the move', () => {
  const water = { right: false, shift: false, flights: false, lead: true };
  expect(fleetWaterAction('move', water)).toBe('move');
  expect(fleetWaterAction('move', { ...water, shift: true })).toBe('move');
  expect(fleetWaterAction('move', { ...water, right: true })).toBe('cancel-move');
  // Outside the move order the chart keeps its own idioms: right-click orders, plain clears.
  expect(fleetWaterAction(undefined, { ...water, right: true })).toBe('move');
  expect(fleetWaterAction(undefined, { ...water, shift: true })).toBe('move');
  expect(fleetWaterAction(undefined, { ...water, shift: true, lead: false })).toBe('clear');
  expect(fleetWaterAction(undefined, water)).toBe('clear');
  // An armed order that wants a unit ignores water rather than clearing the selection.
  expect(fleetWaterAction('other', water)).toBeUndefined();
});
test('selected air groups take the water click before any ship order does', () => {
  const air = { right: false, shift: false, flights: true, lead: true };
  expect(fleetWaterAction('search', air)).toBe('search');
  expect(fleetWaterAction('squadron', air)).toBe('air');
  expect(fleetWaterAction(undefined, { ...air, right: true })).toBe('air');
  expect(fleetWaterAction(undefined, { ...air, shift: true })).toBe('clear');
  expect(fleetWaterAction('search', { ...air, flights: false })).toBeUndefined();
});

// ---- Pending routes: the queued path outlives display-history eviction and dies with the hull.

const command = { type: 'route' as const, waypoints: [[100, 200]] as [number, number][], speedMps: 10, looped: false, append: false };
function queued(queue: CommandQueue): PendingRoute {
  queue.enqueue('ship', command);
  return {
    points: [
      [0, 0, 0],
      [100, 0, 200],
    ],
    receipt: queue.receipts.at(-1)!,
  };
}
test('a route survives dispatch and acceptance before its authoritative snapshot', () => {
  const queue = new CommandQueue(),
    route = queued(queue);
  expect(advancePendingRoute(route, 100)).toBe(route);
  queue.drain();
  expect(advancePendingRoute(route, 101)).toBe(route);
  queue.acknowledge(route.receipt.sequence, 'accepted');
  const accepted = advancePendingRoute(route, 101)!;
  expect(accepted.points).toBe(route.points);
  expect(advancePendingRoute(accepted, 101)).toBe(accepted);
  expect(advancePendingRoute(accepted, 102)).toBeUndefined();
});
test('route status remains live after more than a full display history of paused orders', () => {
  const queue = new CommandQueue(),
    route = queued(queue);
  for (let i = 0; i < 60; i++) queue.enqueue('other', { type: 'focus', targetId: `enemy-${i}` });
  expect(queue.receipts).toHaveLength(48);
  expect(queue.receipts).not.toContain(route.receipt);
  queue.drain();
  expect(route.receipt.state).toBe('sent');
  queue.acknowledge(route.receipt.sequence, 'accepted');
  const accepted = advancePendingRoute(route, 200)!;
  expect(advancePendingRoute(accepted, 201)).toBeUndefined();
});
test('a hold supersedes an evicted paused route immediately, and rejected routes disappear', () => {
  const queue = new CommandQueue(),
    route = queued(queue);
  for (let i = 0; i < 60; i++) queue.enqueue('other', { type: 'focus', targetId: `enemy-${i}` });
  queue.enqueue('ship', { type: 'hold' });
  expect(advancePendingRoute(route, 0)).toBeUndefined();
  const replacement = queued(queue);
  queue.drain();
  queue.acknowledge(replacement.receipt.sequence, 'rejected');
  expect(advancePendingRoute(replacement, 0)).toBeUndefined();
});
test('clearing a session invalidates retained queued previews', () => {
  const queue = new CommandQueue(),
    route = queued(queue);
  queue.clear();
  expect(advancePendingRoute(route, 0)).toBeUndefined();
  expect(queue.receipts).toHaveLength(0);
  expect(queue.length).toBe(0);
});
test('the chart advances every pending route at once and keeps the same object when nothing moved', () => {
  const queue = new CommandQueue(),
    route = queued(queue);
  queue.enqueue('lost', command);
  const routes = { ship: route, lost: { points: [[1, 0, 1]] as Vec3[], receipt: queue.receipts.at(-1)! } };
  const view = { tick: 5, afloat: [{ id: 'ship' }] as Contact[] };
  const next = advancePendingRoutes(routes, view);
  expect(next).toEqual({ ship: route });
  expect(advancePendingRoutes(next, view)).toBe(next);
});

// ---- Chart projection: markers carry a world position; live poses read the chart.

test('plane markers and group labels follow frame poses instead of cached telemetry coordinates', () => {
  let x = 100;
  const chart = {
    projectAirMap: () => [10, 20],
    projectAircraft: () => [x, 30],
    projectContact: () => [x, 40],
    projectContactGroup: () => [x, 50],
    projectFleetShip: () => null,
  } as never;
  for (const [marker, y] of [
    [{ plane: 'own-plane' }, 30],
    [{ track: 'enemy-plane' }, 40],
    [{ contactGroup: '["enemy-plane"]' }, 50],
  ] as const) {
    expect(projectAirMarker(chart, marker, [10, 0, 20])).toEqual([100, y]);
    x = 150;
    expect(projectAirMarker(chart, marker, [10, 0, 20])).toEqual([150, y]);
    x = 100;
  }
});
test('heading stays north as an interpolated contact passes its telemetry position', () => {
  let liveZ = 0;
  const chart = { projectAirMap: (x: number, z: number) => [x, z], projectContact: () => [0, liveZ] } as never;
  for (liveZ of [0, -5, -10, -15, -30]) {
    const marker = projectAirMarker(chart, { track: 'enemy' }, [0, 0, 0])!;
    // The old subtraction flips south once interpolation moves beyond the 10 m heading probe.
    const oldAngle = (Math.atan2(-marker[0], marker[1] + 10) * 180) / Math.PI;
    if (liveZ < -10) expect(Math.abs(oldAngle)).toBe(180);
    expect(projectMapHeading(chart, [0, 0, 0], 0)).toBe(0);
  }
});
test('own hull markers ride above the rendered hull and fall back to the sea-level point without a model', () => {
  let anchored: [number, number] | null = [7, 8];
  const chart = { projectAirMap: () => [10, 20], projectFleetShip: (id: string) => (id === 'own' ? anchored : null) } as never;
  expect(projectAirMarker(chart, { shipMarker: 'own' }, [1, 0, 2])).toEqual([7, 8]);
  anchored = null;
  expect(projectAirMarker(chart, { shipMarker: 'own' }, [1, 0, 2])).toEqual([10, 20]);
  expect(projectAirMarker(chart, { shipMarker: 'enemy' }, [1, 0, 2])).toEqual([10, 20]);
});
