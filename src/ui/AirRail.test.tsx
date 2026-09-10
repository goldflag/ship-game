import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { AirRail, type AirRailCarrier, type AirRailFlight, type AirRailProps } from './AirRail';
import type { Aircraft } from '../simulation/aircraft';
import type { AirWingTelemetry } from '../simulation/airTelemetry';

const plane = (id: string, over: Partial<Aircraft> = {}): Aircraft => ({ id, role: 'fighter', phase: 'outbound', hp: 100, ammo: 16, payload: false, ...over } as Aircraft);

const wing = (over: Partial<AirWingTelemetry> = {}): AirWingTelemetry => ({
  recovery: undefined,
  deck: { policy: 'balanced', queue: [], suspended: false, capacity: 12, occupied: 4, groupSize: 4, activeFlightLimit: null, endurance: { kind: 'disabled' }, repairCeilingHp: 60 },
  available: true, total: 48,
  counts: { withdrawn: 0, ready: 4, launching: 0, 'on-mission': 36, returning: 0, servicing: 0, lost: 4, hangar: 4, handling: 0 },
  activeFlights: 2, maxActiveFlights: 4, flightSize: 6, deckCapacity: 12, onDeck: 4, inHangar: 4, recoveryCount: 0,
  squadrons: [], groups: [], flights: [], ...over,
} as AirWingTelemetry);

const flight = (over: Partial<AirRailFlight> = {}): AirRailFlight => ({
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

const carrier: AirRailCarrier = { id: 'cv6', name: 'USS Enterprise (CV-6)', hull: 1, kn: 23, order: 'Route · 20 kn · Waypoint 2/4', wing: wing() };

const planes: Record<string, Aircraft[]> = {
  f1: Array.from({ length: 6 }, (_, i) => plane(`p${i}`, { hp: i === 3 ? 41 : 100, ammo: i === 5 ? 0 : 16 })),
  d3: [...Array.from({ length: 4 }, (_, i) => plane(`d${i}`, { role: 'dive-bomber', phase: 'hangar', payload: false })), plane('d4', { role: 'dive-bomber', phase: 'lost', hp: 0 })],
};

function render(over: Partial<AirRailProps> = {}) {
  const props: AirRailProps = {
    carriers: [carrier], flights: [flight(), grounded], planesOf: f => planes[f.id] ?? [],
    selectedIds: ['f1'], hoverId: undefined, armed: undefined, actionable: true, hasBoundary: true,
    search: { radius: 4000, altitude: 'medium', policy: 'report', setRadius: () => {}, setAltitude: () => {}, setPolicy: () => {} },
    onHover: () => {}, onSelect: () => {}, onVerb: () => {}, onFollowLead: () => {}, canFollow: () => true, onCentre: () => {},
    onService: () => {}, onDeckPolicy: () => {}, onPrioritize: () => {}, onCancelTask: () => {}, onClose: () => {},
    ...over,
  };
  return renderToStaticMarkup(<AirRail {...props}/>);
}

test('the rail lists every carrier and group with the fleet total and deck stats', () => {
  const html = render();
  expect(html).toContain('aria-label="Air groups"');
  expect(html).toContain('USS Enterprise (CV-6)');
  expect(html).toContain('23 kn · Route · 20 kn · Waypoint 2/4');
  expect(html).toContain('44 of 48 · 6 airborne · 4 deck · 4 hangar');
  expect(html).toContain('<small>Deck</small><b>4<i>/12</i></b>');
  expect(html).toContain('<small>Hangar</small><b>4</b>');
  expect(html).toContain('<small>Airborne</small><b>6</b>');
  expect(html).toContain('Balanced');
  expect(html).toContain('Deck crew ready');
  expect(html).toContain('Hide<kbd>Esc</kbd>');
  expect(html).toContain('Fighter 1');
  expect(html).toContain('6/6 armed');
  expect(html).toContain('<small>27:40</small>');
  expect(html).toContain('<b>Loitering</b> · Loiter at station');
  expect(html).toContain('Repair below · 2:40');
  // Five dots for the healthy loaded fighters, one brass, one hollow, and the deck group's loss.
  expect(html.match(/class="hurt"/g)).toHaveLength(2);
  expect(html).toContain('class="empty"');
  expect(html).toContain('class="lost"');
});

test('the selected group expands in place with its verbs, search settings and camera actions', () => {
  const html = render();
  expect(html).toContain('aria-pressed="true"');
  expect(html).toMatch(/aria-pressed="true"[^>]*>.*?Fighter 1/);
  expect(html).toContain('air-rail-expanded');
  expect(html).toContain('6/6 planes · 0 lost');
  expect(html).toContain('100% · 100% · 100% · <b>41%</b> · 100% · 100%');
  expect(html).toContain('<b>Loiter</b> · Loiter at station');
  expect(html).toContain('Loiter<kbd>L</kbd>');
  expect(html).toContain('Defend<kbd>D</kbd>');
  expect(html).toContain('Intercept<kbd>I</kbd>');
  expect(html).toContain('Escort<kbd>E</kbd>');
  expect(html).toContain('Return<kbd>R</kbd>');
  expect(html).toContain('Search<kbd>S</kbd>');
  expect(html).not.toContain('Strike<kbd>A</kbd>');
  expect(html).toContain('Follow lead');
  expect(html).toContain('Centre on chart');
  expect(html).toContain('Radius');
  expect(html).toContain('Altitude');
  expect(html).toContain('On contact');
  // The unselected group stays a single row.
  expect(html.match(/air-rail-expanded/g)).toHaveLength(1);
});

test('a group with no aircraft airborne reads as decked and only offers what the deck allows', () => {
  const html = render({ selectedIds: ['d3'] });
  expect(html).toContain('class="air-rail-group deckd"');
  expect(html).toContain('0/4 armed');
  expect(html).toContain('<small>in hangar</small>');
  expect(html).toContain('4/5 planes · 1 lost');
  expect(html).toContain('Strike<kbd>A</kbd>');
  expect(html).not.toContain('Defend<kbd>D</kbd>');
  // canLaunch is false, so every order verb but Return waits for the deck; Return waits for a flight.
  for (const verb of ['Loiter', 'Strike', 'Intercept', 'Escort', 'Return', 'Search']) {
    expect(html).toMatch(new RegExp(`<button disabled=""[^>]*>${verb}<kbd>`));
  }
  expect(html).toContain('Bring up');
  expect(html).toContain('Repair below');
});

test('an armed verb is pressed, a finished battle disables the orders and no boundary hides Search', () => {
  expect(render({ armed: 'patrol' })).toMatch(/<button aria-pressed="true"[^>]*>Loiter<kbd>L<\/kbd>/);
  const over = render({ actionable: false });
  expect(over).toMatch(/<button disabled=""[^>]*>Loiter<kbd>L<\/kbd>/);
  const inshore = render({ hasBoundary: false });
  expect(inshore).not.toContain('Search<kbd>S</kbd>');
  expect(inshore).not.toContain('Radius');
  expect(inshore).not.toContain('On contact');
  expect(inshore).toContain('Loiter<kbd>L</kbd>');
});

test('the hovered row is marked and a wing without a deck drops the policy cell and the foot', () => {
  expect(render({ hoverId: 'f1' })).toContain('hovered');
  const bare = render({ carriers: [{ ...carrier, wing: wing({ deck: undefined }) }] });
  expect(bare).not.toContain('Deck crew ready');
  expect(bare).not.toContain('Policy');
  expect(bare).not.toContain('air-rail-deck');
  expect(bare).toContain('<small>Deck</small><b>4<i>/12</i></b>');
});
