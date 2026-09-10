import { expect, test } from 'bun:test';
import { CommandQueue } from '../game/session/commandQueue';
import { advancePendingRoute, type PendingRoute } from './pendingFleetRoute';

const command = { type: 'route' as const, waypoints: [[100, 200]] as [number, number][], speedMps: 10, looped: false, append: false };
function queued(queue: CommandQueue): PendingRoute {
  queue.enqueue('ship', command);
  return { points: [[0, 0, 0], [100, 0, 200]], receipt: queue.receipts.at(-1)! };
}

test('a route survives dispatch and acceptance before its authoritative snapshot', () => {
  const queue = new CommandQueue(), route = queued(queue);
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
  const queue = new CommandQueue(), route = queued(queue);
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
  const queue = new CommandQueue(), route = queued(queue);
  for (let i = 0; i < 60; i++) queue.enqueue('other', { type: 'focus', targetId: `enemy-${i}` });
  queue.enqueue('ship', { type: 'hold' });
  expect(advancePendingRoute(route, 0)).toBeUndefined();
  const replacement = queued(queue);
  queue.drain(); queue.acknowledge(replacement.receipt.sequence, 'rejected');
  expect(advancePendingRoute(replacement, 0)).toBeUndefined();
});

test('clearing a session invalidates retained queued previews', () => {
  const queue = new CommandQueue(), route = queued(queue);
  queue.clear();
  expect(advancePendingRoute(route, 0)).toBeUndefined();
  expect(queue.receipts).toHaveLength(0);
  expect(queue.length).toBe(0);
});
