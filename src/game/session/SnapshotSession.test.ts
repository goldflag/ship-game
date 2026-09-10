import { expect, test, spyOn } from 'bun:test';
import { HeadlessSession } from '../../../scripts/multiplayer/headless-session';
import { weaponGroups } from '../../ships/weaponGroups';
import { mountFrame } from '../../simulation/mountFrames';
import { muzzleWorld } from '../../simulation/weapons';
import { localToWorld, sub, length } from '../../simulation/geometry';
import { decodeSnapshot } from './SnapshotSession';
import { squadronFlights, type AirOrder } from '../../simulation/aircraft';
import pveRules from '../../../assets/gameplay/pve-mission.v1.json';
import type { MissionRules } from '../../multiplayer/generated/MissionRules';
import { managedDeckFixture } from '../../../scripts/multiplayer/managed-deck-fixture';
import { airWingTelemetry } from '../../simulation/airTelemetry';
const setup = { playerShipId: 'enterprise-cv6', friendlyBots: ['fletcher', 'type-viic'], enemies: ['baltimore'], spawnDistance: 5000 };
test('managed deck commands and queues retain carrier ownership and policies through real WASM snapshots', async () => {
  const content = new Uint8Array(await Bun.file(new URL('../../../.build/naval-content/manifest.json', import.meta.url)).arrayBuffer());
  const session = await HeadlessSession.create({ playerShipId: 'fletcher', friendlyBots: ['enterprise-cv6', 'shokaku'], enemies: ['fletcher'], spawnDistance: 16000 }, managedDeckFixture(content));
  try {
    const carriers = session.actors.filter(a => a.team === 'friendly' && a.airWing);
    expect(session.controlledShipId).toBe('player');
    expect(session.setDeckPolicy(carriers[0].motion.id, 'launch-first')).toBe(true);
    expect(session.setDeckPolicy(carriers[1].motion.id, 'recover-first')).toBe(true);
    for (const carrier of carriers) {
      const wing = airWingTelemetry(carrier, session.actors)!;
      expect(wing.maxActiveFlights).toBeNull(); expect(wing.onDeck).toBe(24); expect(wing.inHangar).toBe(24);
      expect(wing.groups).toHaveLength(12); expect(wing.groups.every(f => f.total === 4 && f.enduranceSeconds === null)).toBe(true);
      const group = wing.groups.find(f => f.deck?.canRaise)!;
      expect(session.commandDeck(group.id, 'raise')).toBe(true);
    }
    session.applyRaw(session.runtime.snapshot());
    expect(session.tick).toBe(0); expect(session.controlledShipId).toBe('player');
    for (const carrier of carriers) expect(carrier.airWing!.deck!.queue).toHaveLength(1);
    const first = carriers[0], request = first.airWing!.deck!.queue[0];
    expect(first.airWing!.deck!.policy).toBe('launch-first');
    expect(carriers[1].airWing!.deck!.policy).toBe('recover-first');
    expect(() => session.prioritizeDeckTask(first.motion.id, request.id)).toThrow('deck is full');
    expect(request.automatic).toBe(false);
    expect(session.cancelDeckTask(first.motion.id, request.id)).toBe(true);
    expect(session.cancelDeckTask('enemy-1', request.id)).toBe(false);
    expect(session.commandDeck('foreign-group', 'raise')).toBe(false);
    session.applyRaw(session.runtime.snapshot());
    expect(first.airWing!.deck!.queue).toHaveLength(0);
    expect(carriers[1].airWing!.deck!.queue).toHaveLength(1);
    expect(session.controlledShipId).toBe('player'); expect(session.tick).toBe(0);
    for (const group of first.airWing!.flights.slice(0, 2)) session.commandDeck(group.id, 'stow');
    session.applyRaw(session.runtime.snapshot());
    const next = first.airWing!.deck!.queue[1].id;
    expect(session.prioritizeDeckTask(first.motion.id, next)).toBe(true);
    session.applyRaw(session.runtime.snapshot());
    expect(first.airWing!.deck!.nextRequestId).toBe(next);
    expect(first.airWing!.deck!.queue[0].id).toBe(next);
    expect(carriers[1].airWing!.deck!.queue).toHaveLength(1);
    expect(session.controlledShipId).toBe('player'); expect(session.tick).toBe(0);

  } finally { session.dispose(); }
});
test('PvE WASM sends an owned fleet and unknown enemy state; instruments work without a target', async () => {
  const session = await HeadlessSession.create({ playerShipId: 'fletcher', friendlyBots: [], enemies: [{ shipId: 'fletcher', aiLevel: 'static' }], spawnDistance: 16000, weather: 'clear', missionRules: pveRules as MissionRules });
  try {
    expect(session.actors).toHaveLength(1);
    expect(session.target).toBeUndefined();
    expect(session.controlledShipId).toBeUndefined();
    expect(session.player.controller).toBe('bot');
    expect(session.afloatKg[1]).toBeNull();
    expect(session.remainingSeconds).toBeNull();
    const telemetry = session.telemetry('main', session.aimAt());
    expect(telemetry.targetKnowledge).toBe('none');
    expect(telemetry.targetIntegrity).toBeUndefined();
    expect(telemetry.modules).toBeUndefined();
    expect(telemetry.playerIntegrity).toBeGreaterThan(0);
    expect(telemetry.remainingSeconds).toBeNull();
    expect(session.selectTarget('enemy-1')).toBe(false);
    expect(session.selectShip('player')).toBe(true);
    session.advance(.1, { throttle: 0, rudder: 0 }, { aim: session.aimAt(), battery: 'main', fire: false });
    expect(session.controlledShipId).toBe('player');
  } finally { session.dispose(); }
});
test('a reported PvE target can be selected and focused without exposing HP or internal modules', async () => {
  const session = await HeadlessSession.create({ playerShipId: 'fletcher', friendlyBots: [], enemies: [{ shipId: 'fletcher', aiLevel: 'static' }], spawnDistance: 2000, weather: 'clear', missionRules: pveRules as MissionRules });
  try {
    session.advance(.1, { throttle: 0, rudder: 0 }, { aim: session.aimAt(), battery: 'main', fire: false });
    const contact = session.observationTracks[0];
    expect(contact.id).toStartWith('contact-');
    expect(session.selectTarget(contact.id)).toBe(true);
    expect(session.target).toBeUndefined();
    session.focusShip('player', contact.id);
    expect(() => session.focusShip('player', 'enemy-1')).toThrow();
    session.advance(.1, { throttle: 0, rudder: 0 }, { aim: session.aimAt(), battery: 'main', fire: false });
    expect(session.fleetOrders.player.targetId).toBe(contact.id);
    const telemetry = session.telemetry('main', session.aimAt());
    expect(telemetry.targetKnowledge).toBe('contact');
    expect(telemetry.targetId).toBe(contact.id);
    expect(telemetry.targetIntegrity).toBeUndefined();
    expect(telemetry.targetSupport).toBeUndefined();
    expect(telemetry.modules).toBeUndefined();
  } finally { session.dispose(); }
});

test('PvE search orders survive WASM projection, fly native routes and retain a separate ship helm', async () => {
  const session = await HeadlessSession.create({ playerShipId: 'fletcher', friendlyBots: ['enterprise-cv6'], enemies: [{ shipId: 'fletcher', aiLevel: 'static' }], spawnDistance: 16000, weather: 'clear', missionRules: pveRules as MissionRules });
  try {
    session.selectShip('player');
    const carrier = session.actors.find(a => a.airWing)!;
    const flight = squadronFlights(carrier).find(f => carrier.airWing!.planes.some(p => f.planeIds.includes(p.id) && p.role === 'dive-bomber'))!;
    const order = { kind: 'search-area', center: [0, -5000], radiusM: 2000, altitude: 'high', policy: 'report' } satisfies AirOrder;
    expect(() => session.commandSquadron(flight.id, { ...order, center: [0, 24000] })).toThrow();
    expect(session.commandSquadron(flight.id, { ...order, center: [...order.center] })).toBe(true);
    for (let i = 0; i < 300; i++) session.runtime.step(6);
    session.applyRaw(session.runtime.snapshot());
    expect(session.controlledShipId).toBe('player');
    const group = airWingTelemetry(carrier, session.actors)!.groups.find(f => f.id === flight.id)!;
    expect(group.order).toEqual(order); expect(group.search!.route.length).toBeGreaterThan(2);
    expect(group.search!.route.every(p => p[1] === 1500)).toBe(true);
    expect(group.search!.trail.length).toBeGreaterThan(0);
    expect(group.route.length).toBeGreaterThan(2); expect(group.armed).toBe(group.surviving);
    expect(carrier.airWing!.planes.filter(p => p.flightId === flight.id).every(p => !p.targetId)).toBe(true);
    expect(session.actors.every(a => a.team === 'friendly')).toBe(true);
    expect(session.commandSquadron(flight.id, { kind: 'patrol', point: [0, 850, 0] })).toBe(true);
    session.applyRaw(session.runtime.snapshot());
    expect(carrier.airWing!.planes.filter(p => p.flightId === flight.id).every(p => !p.search)).toBe(true);
    expect(session.controlledShipId).toBe('player');
  } finally { session.dispose(); }
});
test('PvE strikes address a reported contact on an owned carrier while the destroyer keeps the helm', async () => {
  const session = await HeadlessSession.create({ playerShipId: 'fletcher', friendlyBots: ['enterprise-cv6'], enemies: [{ shipId: 'fletcher', aiLevel: 'static' }], spawnDistance: 2000, weather: 'clear', missionRules: pveRules as MissionRules });
  try {
    session.selectShip('player');
    session.runtime.step(6); session.applyRaw(session.runtime.snapshot());
    const contact = session.observationTracks.find(c => c.kind === 'surface')!;
    expect(contact).toBeDefined();
    const carrier = session.actors.find(a => a.airWing)!;
    const flight = squadronFlights(carrier).find(f => carrier.airWing!.planes.some(p => f.planeIds.includes(p.id) && p.role === 'dive-bomber'))!;
    expect(() => session.commandSquadron(flight.id, { kind: 'attack', targetId: 'enemy-1' })).toThrow();
    expect(session.commandSquadron(flight.id, { kind: 'attack', targetId: contact.id })).toBe(true);
    session.applyRaw(session.runtime.snapshot());
    expect(carrier.airWing!.flights.find(f => f.id === flight.id)!.order).toEqual({ kind: 'strike', contactId: contact.id });
    expect(carrier.airWing!.planes.filter(p => p.flightId === flight.id).every(p => p.targetId === contact.id)).toBe(true);
    expect(session.controlledShipId).toBe('player'); expect(session.tick).toBe(6);
    expect(session.actors.every(a => a.team === 'friendly')).toBe(true);
    expect(airWingTelemetry(carrier, session.actors)!.groups.find(f => f.id === flight.id)!.targetName).toBe('reported contact');
    expect(session.runtime.snapshot()).not.toContain('enemy-1');
  } finally { session.dispose(); }
});
test('Iowa carries its roof gun through real WASM snapshots without mutating delta baselines', async () => {
  const session = await HeadlessSession.create({ playerShipId: 'iowa', friendlyBots: [], enemies: [{ shipId: 'baltimore', aiLevel: 'static' }], spawnDistance: 5000 });
  try {
    const def = session.definition;
    const child = def.mounts.findIndex(m => m.parentMountId);
    const parent = def.mounts.findIndex(m => m.id === def.mounts[child].parentMountId);
    for (let i = 0; i < 20; i++) session.advance(.1, { throttle: 0, rudder: 0 }, { aim: [1500, 10, 0], battery: 'main', fire: false });
    expect(Math.abs(session.player.mounts[parent].train)).toBeGreaterThan(.1);
    const state = session.player.mounts[child], mount = def.mounts[child];
    const frame = mountFrame(def, child, session.player.mounts.map(m => m.train));
    expect(state.carrier!.position).toEqual([frame.x, frame.y, frame.z]);
    const actual = muzzleWorld(mount, state, 0, session.ship);
    const neutral = muzzleWorld(mount, { ...state, carrier: undefined }, 0, { x: 0, y: 0, z: 0, heading: 0, pitch: 0, roll: 0 });
    const pivot = def.mounts[parent].position;
    const expected = localToWorld(localToWorld(sub(neutral, pivot), { x: pivot[0], y: pivot[1], z: pivot[2],
      heading: session.player.mounts[parent].train, pitch: 0, roll: 0 }), session.ship);
    expect(length(sub(actual, expected))).toBeLessThan(1e-8);
    const wire = JSON.parse(session.runtime.snapshot());
    expect(wire.actors[0].mounts[child].carrier).toBeUndefined();
    // Applying a decoded frame must also leave that frame untouched for later deltas.
    const frameToApply = decodeSnapshot(session.runtime.snapshot());
    (session as any).apply(frameToApply);
    expect(frameToApply.actors[0].mounts[child].carrier).toBeUndefined();
    expect(session.player.mounts[child].carrier).toBeDefined();
  } finally { session.dispose(); }
});
test('real WASM snapshots preserve renderer identities and support every instrument', async () => {
  const session = await HeadlessSession.create(setup);
  try {
    const actor = session.player, motion = actor.motion, damage = actor.damage;
    expect(session.player.damage.control.teams.every(job => job === null)).toBe(true);
    expect(session.aircraft.length).toBeGreaterThan(0);
    expect(session.aircraft.every(p => p.deckSlot === undefined || typeof p.deckSlot === 'number')).toBe(true);
    for (const actor of session.actors) for (const group of weaponGroups(actor.definition)) {
      const readout = session.telemetry(group.battery, [0, 0, -5000], group.id, actor);
      expect(Number.isFinite(readout.playerIntegrity)).toBe(true);
    }
    session.advance(.1, { throttle: 1, rudder: 0 }, { aim: [0, 0, -5000], battery: 'main', fire: false }, () => expect(session.tick).toBe(0));
    expect(session.tick).toBe(6); expect(session.player).toBe(actor); expect(session.ship).toBe(motion); expect(session.player.damage).toBe(damage);
    session.advance(0, { throttle: 1, rudder: 0 }, { aim: [0, 0, -5000], battery: 'main', fire: true }); expect(session.tick).toBe(6);
    expect(() => session.holdShip('enemy-1')).toThrow('belong');
    expect(session.selectShip('friendly-1')).toBe(true);
    session.advance(.1, { throttle: 0, rudder: 0 }, { aim: [0, 0, -5000], battery: 'main', fire: false });
    expect(session.ship.id).toBe('friendly-1');
  } finally { session.dispose(); }
});
test('carrier commands launch through Rust and selected waypoints survive gun input', async () => {
  const session = await HeadlessSession.create(setup);
  try {
    const squadron = session.definition.airWing!.squadrons[0];
    expect(session.launchAircraft(squadron.id)).toBeGreaterThan(0);
    session.advance(.1, { throttle: 0, rudder: 0 }, { aim: [0, 0, -5000], battery: 'main', fire: false });
    expect(session.player.airWing!.flights.length).toBeGreaterThan(0);
    const previousPosition = structuredClone(session.aircraft[0].position);
    session.moveShip(session.ship.id, [1000, 0, -1000]);
    session.advance(.1, { throttle: 0, rudder: 0 }, { aim: [0, 0, -5000], battery: 'main', fire: false });
    expect(session.player.helm!.throttle).toBeGreaterThan(0);
    expect(session.aircraft[0].previousPosition).toEqual(previousPosition);
    session.advance(.1, { throttle: -.25, rudder: 0 }, { aim: [0, 0, -5000], battery: 'main', fire: false });
    expect(session.player.helm!.throttle).toBe(-.25);
  } finally { session.dispose(); }
});

test('physical loss stops continuous commands while another vessel can take control', async () => {
  const session = await HeadlessSession.create(setup);
  const send = spyOn(session as any, 'send');
  try {
    session.player.damage.sunk = true;
    session.advance(.1, { throttle: 1, rudder: .5 }, { aim: [0,0,-5000], battery: 'main', fire: true });
    expect(send).not.toHaveBeenCalled();
    expect(session.selectShip('friendly-1')).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
  } finally { send.mockRestore(); session.dispose(); }
});


test('declined orders expire even while paused and never clear a later failure', async () => {
  const session = await HeadlessSession.create(setup);
  const now = spyOn(performance, 'now');
  const helm = { throttle: 0, rudder: 0 };
  const intent = { aim: [0, 0, -5000] as [number, number, number], battery: 'main' as const, fire: false };
  try {
    now.mockReturnValue(1000);
    session.commandAcknowledged(false, 'Target lost');
    expect(session.connectionStatus).toContain('Target lost');
    now.mockReturnValue(4001);
    session.advance(0, helm, intent);
    expect(session.connectionStatus).toBe('');
    session.commandAcknowledged(false, 'Ship lost');
    session.connectionStatus = 'Battle worker stopped';
    now.mockReturnValue(8000);
    session.advance(0, helm, intent);
    expect(session.connectionStatus).toBe('Battle worker stopped');
  } finally { now.mockRestore(); session.dispose(); }
});

test('fleet routes and escorts survive focus and explicit helm release through real WASM', async () => {
  const session = await HeadlessSession.create(setup);
  const helm = { throttle: 0, rudder: 0 };
  const intent = { aim: [0, 0, -5000] as [number, number, number], battery: 'main' as const, fire: false };
  try {
    const carrier = session.player;
    const integrity = carrier.damage.integrity;
    session.routeShip('player', [[0, -1500], [1000, -1500]], 12);
    session.escortShip('friendly-1', 'player', [650, 350], 1500);
    session.focusShip('friendly-1', 'enemy-1');
    session.setShipWeapons('friendly-1', { guns: false, aa: true, torpedoes: false });
    session.advance(.1, helm, intent);
    expect(session.controlledShipId).toBe('player');
    expect(carrier.helm!.throttle).toBe(0);
    session.requestFire();
    expect(session.releaseHelm()).toBe(true);
    const send = spyOn(session as any, 'send');
    session.advance(.1, helm, intent);
    expect(send).not.toHaveBeenCalled();
    send.mockRestore();
    expect(session.controlledShipId).toBeUndefined();
    expect(session.player).toBe(carrier);
    expect(carrier.damage.integrity).toBe(integrity);
    expect(carrier.controller).toBe('bot');
    expect(carrier.helm!.throttle).toBeGreaterThan(0);
    const frame = JSON.parse(session.runtime.snapshot());
    const escort = frame.actors.find((a: any) => a.motion.id === 'friendly-1');
    expect(escort.navigation.order).toEqual({ type: 'escort', leaderId: 'player', offset: [650, 350], radiusM: 1500, formation: 'column', slot: 0 });
    expect(escort.targetId).toBe('enemy-1');
    expect(session.selectShip('friendly-1')).toBe(true);
    session.advance(.1, helm, intent);
    expect(session.controlledShipId).toBe('friendly-1');
    expect(session.ship.id).toBe('friendly-1');
    expect(session.actors.find(a => a.motion.id === 'player')).toBe(carrier);
    expect(session.releaseHelm()).toBe(true);
    session.advance(.1, helm, intent);
    expect(JSON.parse(session.runtime.snapshot()).actors.find((a: any) => a.motion.id === 'friendly-1').navigation.order.type).toBe('escort');
  } finally { session.dispose(); }
});

test('air groups on multiple carriers receive addressed orders while a destroyer retains the helm', async () => {
  const session = await HeadlessSession.create({ playerShipId: 'fletcher', friendlyBots: ['enterprise-cv6', 'shokaku'], enemies: ['baltimore'], spawnDistance: 7500 });
  try {
    const ids = session.actors.filter(a => a.team === 'friendly' && a.airWing).map(a => squadronFlights(a)[0].id);
    for (const id of ids) expect(session.commandSquadron(id, { kind: 'patrol', point: [1000, 1000, -1000] })).toBe(true);
    session.advance(.1, { throttle: 0, rudder: 0 }, { aim: [0, 0, -5000], battery: 'main', fire: false });
    expect(session.controlledShipId).toBe('player');
    for (const id of ids) {
      const flight = session.actors.flatMap(a => a.airWing?.flights ?? []).find(f => f.id === id);
      expect(flight?.order.kind).toBe('patrol');
      session.recallAircraft(id);
    }
    session.advance(.1, { throttle: 0, rudder: 0 }, { aim: [0, 0, -5000], battery: 'main', fire: false });
    expect(session.controlledShipId).toBe('player');
    expect(session.commandSquadron('unknown-flight', { kind: 'return' })).toBe(false);
  } finally { session.dispose(); }
});

test('delayed snapshots cannot restore helm during a paused transfer; rejected transfers recover', async () => {
  const session = await HeadlessSession.create(setup);
  const now = spyOn(performance, 'now');
  try {
    const previous = session.runtime.snapshot();
    now.mockReturnValue(1000);
    session.releaseHelm();
    now.mockReturnValue(60000);
    session.applyRaw(previous);
    expect(session.controlledShipId).toBeUndefined();
    session.applyRaw(session.runtime.snapshot());
    expect(session.controlledShipId).toBeUndefined();
    const released = session.runtime.snapshot();
    session.selectShip('friendly-1');
    session.applyRaw(previous);
    expect(session.controlledShipId).toBeUndefined();
    session.applyRaw(session.runtime.snapshot());
    expect(session.controlledShipId).toBe('friendly-1');
    // A queue rejection clears only its corresponding transfer request.
    const send = spyOn(session as any, 'send').mockImplementation(() => {});
    session.selectShip('player');
    session.commandAcknowledged(false, 'Unavailable', 'select', 'friendly-1');
    session.applyRaw(released);
    expect(session.controlledShipId).toBeUndefined();
    session.commandAcknowledged(false, 'Queue full', 'select', 'player');
    session.applyRaw(session.runtime.snapshot());
    expect(session.controlledShipId).toBe('friendly-1');
    send.mockRestore();
  } finally { now.mockRestore(); session.dispose(); }
});
test('PvE debrief appears only after an authoritative outcome and leaves active actors filtered', async () => {
  const session = await HeadlessSession.create({ playerShipId: 'fletcher', friendlyBots: [], enemies: [{ shipId: 'fletcher', aiLevel: 'static' }], spawnDistance: 16000, weather: 'clear', missionRules: { ...pveRules, durationSeconds: 1 } as MissionRules });
  try {
    expect(session.debrief).toBeUndefined();
    const initial = session.runtime.snapshot();
    for (let i = 0; i < 12; i++) session.advance(.1, { throttle: 0, rudder: 0 }, { aim: session.aimAt(), battery: 'main', fire: false });
    expect(session.result).toBe('draw'); expect(session.outcome?.reason).toBe('time-limit');
    expect(session.debrief?.ships).toHaveLength(2);
    expect(session.debrief?.ships.find(s => s.team === 'enemy')?.status).toBe('operational');
    expect(session.actors).toHaveLength(1); expect(session.target).toBeUndefined();
    // Applying the reset frame withdraws the report as well as the outcome.
    session.applyRaw(initial); expect(session.debrief).toBeUndefined(); expect(session.result).toBe('active');
  } finally { session.dispose(); }
});

test('simplified PvE carrier presentation uses unlimited slots and the admitted endurance profile', async () => {
  const session = await HeadlessSession.create({ playerShipId: 'enterprise-cv6', friendlyBots: [], enemies: ['fletcher'], spawnDistance: 16000, missionRules: pveRules as MissionRules });
  try {
    const wing = airWingTelemetry(session.player, session.actors)!;
    expect(wing.maxActiveFlights).toBeNull();
    expect(wing.groups).toHaveLength(9);
    expect(wing.groups.every(group => group.enduranceSeconds === 2400)).toBe(true);
    expect(wing.deck).toBeUndefined();
    for (const group of wing.groups) expect(session.commandSquadron(group.id, { kind: 'patrol', point: [0, 600, 11000] })).toBe(true);
    session.applyRaw(session.runtime.snapshot());
    expect(airWingTelemetry(session.player, session.actors)!.activeFlights).toBe(9);
    expect(session.player.airWing!.planes).toHaveLength(48);
    expect(session.player.airWing!.planes.every(p => p.phase === 'queued')).toBe(true);
  } finally { session.dispose(); }
});
