import { expect, test, spyOn } from 'bun:test';
import { HeadlessSession } from '../../../scripts/multiplayer/headless-session';
import { weaponGroups } from '../../ships/weaponGroups';
const setup = { playerShipId: 'enterprise-cv6', friendlyBots: ['fletcher', 'type-viic'], enemies: ['baltimore'], spawnDistance: 5000 };
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
