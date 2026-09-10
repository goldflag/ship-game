import { expect, test } from 'bun:test';
import { CommandQueue } from './commandQueue';
import { HeadlessSession } from '../../../scripts/multiplayer/headless-session';

test('paused orders preserve appends and focus, then report superseded movement without erasing the new route', () => {
  const queue = new CommandQueue(4);
  const route = { type: 'route' as const, waypoints: [[100, 200]] as [number, number][], speedMps: 10, looped: false, append: false };
  queue.enqueue('ship', route);
  queue.enqueue('ship', { ...route, append: true, waypoints: [[300, 400]] });
  queue.enqueue('ship', { type: 'focus', targetId: 'enemy' });
  queue.enqueue('ship', { ...route, waypoints: [[500, 600]] });
  expect(queue.receipts.map(r => r.state)).toEqual(['superseded', 'superseded', 'queued', 'queued']);
  expect(queue.drain().map(c => c.command)).toEqual([{ type: 'focus', targetId: 'enemy' }, { ...route, waypoints: [[500, 600]] }]);
  expect(queue.length).toBe(0);
});

test('queue overflow is explicit and cannot evict accepted pending aircraft or control transfers', () => {
  const queue = new CommandQueue(2);
  expect(queue.enqueue('carrier', { type: 'select' })).toBe(true);
  expect(queue.enqueue('carrier', { type: 'recall', flightId: null })).toBe(true);
  expect(queue.enqueue('carrier', { type: 'release-helm' })).toBe(false);
  expect(queue.receipts.at(-1)?.state).toBe('rejected');
  expect(queue.drain().map(c => c.command.type)).toEqual(['select', 'recall']);
  expect(queue.enqueue('carrier', { type: 'release-helm' })).toBe(true);
});

test('tactical pause retains authoritative time and old orders until the outbox reaches Rust, including rejected escort targets', async () => {
  const session = await HeadlessSession.create({ playerShipId: 'enterprise-cv6', friendlyBots: ['fletcher'], enemies: ['baltimore'], spawnDistance: 5000 });
  try {
    const queue = new CommandQueue();
    const before = JSON.parse(session.runtime.snapshot());
    queue.enqueue('player', { type: 'release-helm' });
    queue.enqueue('player', { type: 'route', waypoints: [[0, -2000]], speedMps: 10, looped: false, append: false });
    queue.enqueue('friendly-1', { type: 'escort', leaderId: 'enemy-1', offset: [650, 450], radiusM: 160, formation: 'column', slot: 0 });
    expect(JSON.parse(session.runtime.snapshot())).toEqual(before);
    for (const command of queue.drain()) {
      try { session.runtime.command(JSON.stringify(command)); queue.acknowledge(command.sequence, 'accepted'); }
      catch (error) { queue.acknowledge(command.sequence, 'rejected', String(error)); }
    }
    const after = JSON.parse(session.runtime.snapshot());
    expect(after.tick).toBe(before.tick);
    expect(after.fleetOrders.player.movement.type).toBe('route');
    expect(after.fleetOrders['friendly-1'].movement).toEqual(before.fleetOrders['friendly-1'].movement);
    expect(Object.keys(after.fleetOrders)).toEqual(['friendly-1', 'player']);
    expect(queue.receipts.map(r => r.state)).toEqual(['accepted', 'accepted', 'rejected']);
    session.runtime.step(6);
    expect(JSON.parse(session.runtime.snapshot()).actors[0].helm.throttle).toBeGreaterThan(0);
  } finally { session.dispose(); }
});
