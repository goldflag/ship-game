import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { FlightLine, type FlightLineCarrier, type FlightLineFlight, type FlightLineProps } from './FlightLine';
import type { Aircraft } from '../simulation/aircraft';
import type { AirWingTelemetry } from '../simulation/airTelemetry';

const plane = (id: string, over: Partial<Aircraft> = {}): Aircraft => ({ id, role: 'fighter', modelId: 'f4f-4-wildcat', phase: 'outbound', hp: 100, ammo: 16, payload: false, ...over } as Aircraft);

const wing = (over: Partial<AirWingTelemetry> = {}): AirWingTelemetry => ({
  recovery: undefined,
  deck: { policy: 'balanced', queue: [], suspended: false, capacity: 12, occupied: 4, groupSize: 4, activeFlightLimit: null, endurance: { kind: 'disabled' }, repairCeilingHp: 60 },
  available: true, total: 48,
  counts: { withdrawn: 0, ready: 4, launching: 0, 'on-mission': 36, returning: 0, servicing: 0, lost: 4, hangar: 4, handling: 0 },
  activeFlights: 2, maxActiveFlights: 4, flightSize: 6, deckCapacity: 12, onDeck: 4, inHangar: 4, recoveryCount: 0,
  squadrons: [], groups: [], flights: [], ...over,
} as AirWingTelemetry);

const flight = (over: Partial<FlightLineFlight> = {}): FlightLineFlight => ({
  id: 'f1', name: 'Fighter 1', squadronId: 'vf-6', role: 'fighter', order: { kind: 'patrol', point: [0, 0, 0] },
  active: true, status: 'on-mission', total: 6, surviving: 6, airborne: 6, hp: 100, armed: 6, enduranceSeconds: 1660, rearmSeconds: 0,
  position: [0, 0, 0], destination: [0, 0, 0], activity: 'Loitering', heading: 0, route: [], aircraftIds: ['p1'],
  ownerId: 'cv6', carrierName: 'Enterprise', ...over,
});

const grounded = flight({
  id: 'd3', name: 'Dive 3', role: 'dive-bomber', order: { kind: 'return' }, active: false, status: 'hangar',
  total: 5, surviving: 4, airborne: 0, armed: 0, enduranceSeconds: null, activity: 'In hangar', notice: 'Repair below · 2:40',
  deck: { onDeck: 0, inHangar: 4, canRaise: true, canStow: false, canRearm: false, canRepair: true, canLaunch: false },
});

const carrier: FlightLineCarrier = { id: 'cv6', name: 'USS Enterprise (CV-6)', hull: 1, kn: 23, order: 'Route · 20 kn · Waypoint 2/4', wing: wing() };

const planes: Record<string, Aircraft[]> = {
  f1: Array.from({ length: 6 }, (_, i) => plane(`p${i}`, { hp: i === 3 ? 41 : 100, ammo: i === 5 ? 0 : 16 })),
  d3: [...Array.from({ length: 4 }, (_, i) => plane(`d${i}`, { role: 'dive-bomber', modelId: 'sbd-3-dauntless', phase: 'hangar', payload: false })), plane('d4', { role: 'dive-bomber', modelId: 'sbd-3-dauntless', phase: 'lost', hp: 0 })],
};

function render(over: Partial<FlightLineProps> = {}) {
  const props: FlightLineProps = {
    carriers: [carrier], flights: [flight(), grounded], planesOf: f => planes[f.id] ?? [],
    selectedIds: ['f1'], hoverId: undefined, armed: undefined, actionable: true, hasBoundary: true,
    search: { radius: 4000, altitude: 'medium', policy: 'report', setRadius: () => {}, setAltitude: () => {}, setPolicy: () => {} },
    onHover: () => {}, onSelect: () => {}, onVerb: () => {}, onFollowLead: () => {}, canFollow: () => true, onCentre: () => {},
    onService: () => {}, onDeckPolicy: () => {}, onPrioritize: () => {}, onCancelTask: () => {}, onToggleDeck: () => {}, onClose: () => {},
    ...over,
  };
  return renderToStaticMarkup(<FlightLine {...props}/>);
}

test('the line shows one chip per carrier and one box per group with picture, count, key, status, ticks, armament and endurance', () => {
  const html = render();
  expect(html).toContain('aria-label="Air groups"');
  expect(html).toContain('aria-label="USS Enterprise (CV-6) air wing"');
  expect(html).toContain('100% · 23 kn');
  expect(html).toContain('<b>4<i>/12</i></b><small>deck</small>');
  expect(html).toContain('<b>4</b><small>hangar</small>');
  expect(html).toContain('<b>6</b><small>airborne</small>');
  expect(html).toContain('Deck crew ready');
  expect(html).toContain('Deck · <b>Balanced</b>');
  expect(html).toContain('Hide<kbd>Esc</kbd>');
  expect(html).toContain('<strong>Fighter 1</strong><kbd>1</kbd>');
  expect(html).toContain('<strong>Dive 3</strong><kbd>2</kbd>');
  expect(html).toContain('models/aircraft/f4f-4-wildcat-thumbnail.png');
  expect(html).toContain('models/aircraft/sbd-3-dauntless-thumbnail.png');
  expect(html).toContain('6<small>/6</small>');
  expect(html).toContain('4<small>/5</small>');
  expect(html).toContain('<span>Loitering</span>');
  // The foot counts what is actually left: bursts for fighters, planes still carrying for bombers.
  expect(html).toContain('<b>80 bursts</b><span>27:40</span>');
  expect(html).toContain('<b class="dim">0 carrying</b><span>hangar</span>');
  expect(html).toContain('<b>Fighter 1</b> · Loiter at station · 80 bursts');
  // The notice replaces the status line in brass.
  expect(html).toContain('flight-line-status notice');
  expect(html).toContain('<span>Repair below · 2:40</span>');
  // One tick per plane: five armed, one hurt, four empty bombers and the loss.
  expect(html.match(/class="armed"/g)).toHaveLength(4);
  expect(html.match(/class="hurt"/g)).toHaveLength(1);
  expect(html.match(/class="empty"/g)).toHaveLength(5);
  expect(html.match(/class="lost"/g)).toHaveLength(1);
});

test('the selected group gets the verb bar with keys, camera actions and a hint naming its order', () => {
  const html = render();
  expect(html).toMatch(/data-flight-id="f1" aria-pressed="true"/);
  expect(html).toContain('aria-label="Air group orders"');
  for (const verb of ['Loiter<kbd>L</kbd>', 'Defend<kbd>D</kbd>', 'Intercept<kbd>I</kbd>', 'Escort<kbd>E</kbd>', 'Return<kbd>R</kbd>', 'Search<kbd>S</kbd>']) expect(html).toContain(verb);
  expect(html).not.toContain('Strike<kbd>A</kbd>');
  expect(html).toContain('Follow lead');
  expect(html).toContain('Centre');
  expect(html).toContain('<b>Fighter 1</b> · Loiter at station');
  // Deck service belongs to a group on deck or below, not to a flight in the air.
  expect(html).not.toContain('Bring up');
  // Search settings wait until Search is armed.
  expect(html).not.toContain('Radius');
  const search = render({ armed: 'search' });
  expect(search).toMatch(/<button aria-pressed="true"[^>]*>Search<kbd>S<\/kbd>/);
  expect(search).toContain('aria-label="Search settings"');
  for (const field of ['Radius', 'Altitude', 'On contact']) expect(search).toContain(field);
});

test('nothing selected leaves a hint in the bar, and a mixed selection offers both Defend and Strike', () => {
  const none = render({ selectedIds: [] });
  expect(none).toContain('Select a group');
  expect(none).not.toContain('Loiter<kbd>L</kbd>');
  const both = render({ selectedIds: ['f1', 'd3'] });
  expect(both).toContain('Defend<kbd>D</kbd>');
  expect(both).toContain('Strike<kbd>A</kbd>');
  expect(both).toContain('<b>2 air groups</b> · Enterprise');
});

test('a group in the hangar reads as decked, waits for the deck on every verb and offers its service in the bar', () => {
  const html = render({ selectedIds: ['d3'] });
  expect(html).toContain('flight-line-box decked');
  expect(html).toContain('Strike<kbd>A</kbd>');
  expect(html).not.toContain('Defend<kbd>D</kbd>');
  for (const verb of ['Loiter', 'Strike', 'Intercept', 'Escort', 'Return', 'Search']) expect(html).toMatch(new RegExp(`<button disabled=""[^>]*>${verb}<kbd>`));
  expect(html).toContain('Bring up');
  expect(html).toContain('Repair below');
  expect(html).not.toContain('in hangar · 0 airborne');
});

test('an armed verb is pressed, a finished battle disables the orders and no boundary hides Search', () => {
  expect(render({ armed: 'patrol' })).toMatch(/<button aria-pressed="true"[^>]*>Loiter<kbd>L<\/kbd>/);
  expect(render({ actionable: false })).toMatch(/<button disabled=""[^>]*>Loiter<kbd>L<\/kbd>/);
  const inshore = render({ hasBoundary: false, armed: 'search' });
  expect(inshore).not.toContain('Search<kbd>S</kbd>');
  expect(inshore).not.toContain('Radius');
  expect(inshore).toContain('Loiter<kbd>L</kbd>');
});

test('hovering a box marks it and raises a card with manifest cells, the HP list and the order', () => {
  const html = render({ hoverId: 'f1' });
  expect(html).toContain('flight-line-box hovered');
  expect(html).toContain('role="tooltip"');
  expect(html).toContain('<b>Fighter 1</b><span>6/6<small>80 bursts · 27:40 endurance</small></span>');
  expect(html).toContain('<b>Loiter</b> · Loiter at station');
  expect(html.match(/class="air-manifest-cell"/g)).toHaveLength(6);
  expect(html).toContain('data-condition="damaged"');
  expect(html).toContain('100% · 100% · 100% · <b>41%</b> · 100% · 100%');
  expect(render()).not.toContain('role="tooltip"');
  const below = render({ hoverId: 'd3' });
  expect(below).toContain('<b>Dive 3</b><span>4/5<small>0 carrying · in hangar</small></span>');
  expect(below).toContain('data-status="lost"');
  expect(below).toContain('flight-line-notice');
});

test('the carrier chip opens the flight deck as a popover, and a wing without a deck has no toggle', () => {
  const html = render({ deckOpen: 'cv6' });
  expect(html).toContain('aria-expanded="true"');
  expect(html).toContain('flight-line-deck');
  expect(html).toContain('aria-label="USS Enterprise (CV-6) flight deck"');
  expect(html).toContain('Deck policy');
  expect(html).toContain('Close<kbd>Esc</kbd>');
  expect(render()).not.toContain('aria-label="USS Enterprise (CV-6) flight deck"');
  const bare = render({ carriers: [{ ...carrier, wing: wing({ deck: undefined }) }], deckOpen: 'cv6' });
  expect(bare).not.toContain('flight-line-deck-toggle');
  expect(bare).not.toContain('flight-line-deck"');
  expect(bare).toContain('<b>4<i>/12</i></b><small>deck</small>');
  expect(bare).toContain('Route · 20 kn · Waypoint 2/4');
});

test('status lines follow actual launch, transit and return status', () => {
  for (const [status, activity] of [['launching', 'Launching'], ['on-mission', 'En route'], ['returning', 'Returning'], ['servicing', 'Servicing']] as const) {
    const html = render({ flights: [flight({ status, activity })] });
    expect(html).not.toContain('Loitering');
    expect(html).toContain(activity);
    if (status === 'returning' || status === 'servicing') expect(html).not.toContain('Loiter at station');
  }
});
