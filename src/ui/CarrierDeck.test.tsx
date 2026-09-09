import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { CombatSimulation } from '../simulation/combat';
import { airWingTelemetry } from '../simulation/airTelemetry';
import { shipPreset } from '../ships/presets';
import { AirGroupService, CarrierDeck } from './CarrierDeck';
import { decodeSnapshot } from '../game/session/snapshotCodec';
import { AirWingManifest } from './AirWingManifest';

function fixture() {
  const sim = new CombatSimulation(shipPreset('enterprise-cv6'));
  const actor = sim.player, state = actor.airWing!;
  state.deck = { policy: 'balanced', queue: [], suspended: false, capacity: 24, occupied: 24, groupSize: 4, activeFlightLimit: null, endurance: { kind: 'disabled' }, repairCeilingHp: 60 };
  state.flights = actor.definition.airWing!.squadrons.flatMap(s => Array.from({ length: 4 }, (_, i) => ({
    id: `${s.id}-group-${i}`, name: `${s.name} ${i + 1}`, squadronId: s.id, order: { kind: 'defend' as const },
    planeIds: state.planes.filter(p => p.squadronId === s.id).slice(i * 4, i * 4 + 4).map(p => p.id),
  })));
  for (const flight of state.flights) for (const plane of state.planes.filter(p => flight.planeIds.includes(p.id))) {
    plane.flightId = flight.id; plane.phase = 'hangar'; plane.flightTime = 2000;
  }
  return { actor, state, telemetry: () => airWingTelemetry(actor, [actor])! };
}

test('closed recovery preserves unavailable identities without counting them as losses, hangar stock or usable groups', () => {
  const { actor, state, telemetry } = fixture();
  state.recovery = { kind: 'closed', reason: 'Recovery equipment destroyed' };
  state.deck!.suspended = true;
  state.deck!.occupied = 0;
  state.planes.forEach((p, i) => {
    p.phase = i === 0 ? 'lost' : 'withdrawn';
    p.hp = i === 0 ? 0 : 73;
    p.lossReason = i === 0 ? 'Shot down' : 'Unavailable · Recovery equipment destroyed';
  });
  const frame = decodeSnapshot(JSON.stringify({ tick: 30, actors: [{}], wings: [{ ownerId: actor.motion.id, state }] }));
  actor.airWing = frame.wings[0].state;
  const wing = telemetry();
  expect(wing.recovery).toEqual(state.recovery);
  expect(wing.counts).toMatchObject({ withdrawn: 47, lost: 1, hangar: 0, ready: 0 });
  expect(Object.values(wing.counts).reduce((a, b) => a + b, 0)).toBe(48);
  expect(wing).toMatchObject({ activeFlights: 0, inHangar: 0, onDeck: 0, recoveryCount: 0, available: false });
  expect(wing.groups).toHaveLength(12);
  expect(wing.groups.every(g => !g.active && !g.surviving && !g.armed && g.status === 'withdrawn')).toBe(true);
  expect(wing.groups.every(g => g.deck && !g.deck.canLaunch && !g.deck.canRaise && !g.deck.canStow && !g.deck.canRepair && !g.deck.canRearm)).toBe(true);
  expect(wing.flights.every(p => !p.followable)).toBe(true);
  expect(wing.flights.slice(1).every(p => p.hp === 73 && p.location === 'Unavailable')).toBe(true);
  const deck = renderToStaticMarkup(<CarrierDeck name="Enterprise" wing={wing} enabled cancel={() => {}} setPolicy={() => {}}/>);
  const manifest = renderToStaticMarkup(<AirWingManifest wing={wing} onSelect={() => {}}/>);
  for (const html of [deck, manifest]) {
    expect(html).toContain('Flight operations unavailable · Recovery equipment destroyed');
    expect(html).toContain('47 unavailable · 1 lost');
    expect(html).not.toContain('Deck operations suspended');
  }
  expect(deck).not.toContain('role="combobox"');
  expect(deck).not.toContain('Deck crew ready');
  expect(manifest).toContain('<strong>0<small>/48</small></strong>');
});

test('managed telemetry retains four-plane groups and reports unlimited flights without fuel warnings', () => {
  const { state, telemetry } = fixture();
  const group = state.flights[0], planes = state.planes.filter(p => group.planeIds.includes(p.id));
  planes.forEach((p, i) => { p.phase = 'ready'; p.deckSlot = i; });
  let wing = telemetry();
  expect(wing.groups).toHaveLength(12);
  expect(wing.groups.every(g => g.total === 4)).toBe(true);
  expect(wing.maxActiveFlights).toBeNull();
  expect(wing.groups.every(g => g.enduranceSeconds === null && !g.notice)).toBe(true);
  expect(wing.groups[0].deck?.canLaunch).toBe(true);
  expect(wing.groups[1].status).toBe('hangar');
  const damagedBelow = state.planes.find(p => wing.groups[1].aircraftIds.includes(p.id))!;
  damagedBelow.hp = 22;
  expect(telemetry().groups[1].deck?.canRepair).toBe(true);
  damagedBelow.hp = 60;
  expect(telemetry().groups[1].deck?.canRepair).toBe(false);
  expect(wing.activeFlights).toBe(0);
  planes[0].phase = 'lowering';
  wing = telemetry();
  expect(wing.groups[0].status).toBe('handling');
  expect(wing.groups[0].active).toBe(false);
  expect(wing.groups[0].deck?.canLaunch).toBe(false);
  planes[0].phase = 'returning'; delete planes[0].deckSlot;
  wing = telemetry();
  expect(wing.groups[0].deck).toMatchObject({ canStow: true, canRepair: true, canRearm: false, canRaise: false, canLaunch: false });
  expect(wing.groups[0].deck?.reason).toContain('Waiting');
  expect(wing.groups[0].notice).toBeUndefined();
  state.deck!.endurance = { kind: 'timed', exhaustionSeconds: 3000, orderLimitSeconds: 1000, recallSeconds: 1400, fighterRecallSeconds: 1500 };
  expect(telemetry().groups[0].enduranceSeconds).toBe(1000);
  expect(telemetry().groups[0].notice).toContain('Low endurance');
});

test('snapshot normalization preserves an explicit unlimited policy and authoritative group identities', () => {
  const { actor, state } = fixture();
  const frame = decodeSnapshot(JSON.stringify({ tick: 0, actors: [{}], wings: [{ ownerId: actor.motion.id, state }] }));
  actor.airWing = frame.wings[0].state;
  expect(actor.airWing.deck!.activeFlightLimit).toBeNull();
  expect(airWingTelemetry(actor, [actor])!.groups.map(g => g.id)).toEqual(state.flights.map(f => f.id));
  expect(actor.airWing).toEqual(state);
});

test('deck controls explain mixed groups and distinguish required clearance from cancellable tasks', () => {
  const { state, telemetry } = fixture();
  const group = state.flights[0], p = state.planes.find(p => group.planeIds.includes(p.id))!;
  p.phase = 'ready'; p.deckSlot = 0;
  let wing = telemetry();
  const buttons = renderToStaticMarkup(<AirGroupService flights={wing.groups.slice(0, 2)} enabled command={() => {}}/>);
  expect(buttons).toContain('Bring up (2)');
  expect(buttons).toContain('Send below (1)');
  expect(buttons).toMatch(/disabled=""[^>]*>Rearm \(0\)/);
  expect(buttons).toContain('1 on deck · 7 in hangar · 0 airborne');
  state.deck!.queue = [
    { id: 1, flightId: group.id, action: 'stow', automatic: true },
    { id: 2, flightId: state.flights[1].id, action: 'raise', automatic: false },
  ];
  state.deck!.currentPlaneId = p.id; state.deck!.task = 'Moving aircraft';
  wing = telemetry();
  expect(wing.groups[0].deck).toMatchObject({ canRaise: false, canStow: false, canRepair: false });
  const deck = renderToStaticMarkup(<CarrierDeck name="Enterprise" wing={wing} enabled cancel={() => {}}/>);
  expect(deck).toContain('Automatic deck clearance');
  expect(deck).toContain('Moving aircraft');
  expect(deck.match(/<button /g)).toHaveLength(1);
  expect(deck).toContain('Cancel Bring up');
  expect(deck).not.toContain('Cancel Send below');
  delete state.deck!.task; delete state.deck!.currentPlaneId;
  state.deck!.queue = state.deck!.queue.slice(1);
  expect(renderToStaticMarkup(<CarrierDeck name="Enterprise" wing={telemetry()} enabled cancel={() => {}}/>)).toContain('Waiting for deck space');
  state.deck!.task = 'Raising aircraft'; state.deck!.stepRemainingSeconds = 5;
  p.phase = 'rearming'; p.timer = 34;
  const timed = renderToStaticMarkup(<CarrierDeck name="Enterprise" wing={telemetry()} enabled cancel={() => {}}/>);
  expect(timed).toContain('Current aircraft · 0:05 remaining');
  expect(timed).toContain('Service 0:34 remaining');
  expect(renderToStaticMarkup(<AirGroupService flights={telemetry().groups} enabled command={() => {}}/>)).toContain('Current service 0:34 remaining');
  state.deck!.suspended = true;
  expect(renderToStaticMarkup(<CarrierDeck name="Enterprise" wing={telemetry()} enabled={false} cancel={() => {}}/>)).toContain('Deck operations suspended');
});

test('deck priorities show the selected policy and keep automatic clearance out of player reordering', () => {
  const { state, telemetry } = fixture();
  state.deck!.policy = 'recover-first';
  state.deck!.nextRequestId = 2;
  state.deck!.queue = [
    { id: 1, flightId: state.flights[0].id, action: 'stow', automatic: true },
    { id: 2, flightId: state.flights[1].id, action: 'raise', automatic: false },
    { id: 3, flightId: state.flights[2].id, action: 'repair', automatic: false },
  ];
  const render = (enabled: boolean) => renderToStaticMarkup(<CarrierDeck name="Enterprise" wing={telemetry()} enabled={enabled}
    cancel={() => {}} setPolicy={() => {}} prioritize={() => {}}/>);
  const html = render(true);
  expect(html).toContain('role="combobox"');
  expect(html).toContain('Recover first');
  expect(html).toContain('Up to 4 takeoffs / 8 landings per turn when paths are clear');
  expect(html).not.toContain('Make next: Send below');
  expect(html).toContain('aria-label="Next: Bring up');
  expect(html).toContain('aria-label="Make next: Repair below');
  expect(html).toMatch(/<button disabled="" aria-pressed="true"[^>]*>Next<\/button>/);
  expect(html).toMatch(/<button aria-pressed="false"[^>]*>Make next<\/button>/);
  const disabled = render(false).match(/<button[^>]*>/g)!;
  expect(disabled.length).toBeGreaterThan(0);
  expect(disabled.every(button => button.includes('disabled=""'))).toBe(true);
});
