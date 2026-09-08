import { expect, test, spyOn } from 'bun:test';
import { HeadlessSession } from '../../../scripts/multiplayer/headless-session';
import { weaponGroups } from '../../ships/weaponGroups';
import { mountFrame } from '../../simulation/mountFrames';
import { muzzleWorld } from '../../simulation/weapons';
import { localToWorld, sub, length } from '../../simulation/geometry';
import { decodeSnapshot } from './SnapshotSession';
const setup = { playerShipId: 'enterprise-cv6', friendlyBots: ['fletcher', 'type-viic'], enemies: ['baltimore'], spawnDistance: 5000 };
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
