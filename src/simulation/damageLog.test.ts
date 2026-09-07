import { expect, test } from 'bun:test';
import { DamageLog } from './damageLog';

const hit = { tick: 0, sourceId: 'player', targetId: 'enemy-1', projectileId: 1, weapon: '380 mm AP · Main', damage: 10 };

test('salvos combine damage but count a shell only once across plates and equipment', () => {
  const log = new DamageLog();
  log.record(hit);
  log.record({ ...hit, tick: 1, damage: 20 });
  log.record({ ...hit, tick: 12, projectileId: 2, damage: 30 });
  expect(log.snapshot()).toMatchObject([{ damage: 60, hits: 2, tick: 12 }]);
  const previous = log.snapshot();
  log.record({ ...hit, tick: 13, projectileId: 3 });
  expect(previous[0].damage).toBe(60);
  expect(log.snapshot()[0].damage).toBe(70);
});

test('weapon, target, incoming fire and later salvos stay separate and the latest hit moves first', () => {
  const log = new DamageLog();
  log.record(hit);
  log.record({ ...hit, weapon: '150 mm HE · Secondary' });
  log.record({ ...hit, targetId: 'enemy-2' });
  log.record({ ...hit, sourceId: 'enemy-1', targetId: 'player' });
  log.record({ ...hit, tick: 20 });
  expect(log.snapshot()).toHaveLength(4);
  expect(log.snapshot()[0]).toMatchObject({ sourceId: 'player', targetId: 'enemy-1', weapon: hit.weapon, damage: 20 });
  log.record({ ...hit, tick: 61 });
  expect(log.snapshot()).toHaveLength(5);
});

test('zero damage is omitted, history is bounded, and a new battle clears it', () => {
  const log = new DamageLog();
  log.record({ ...hit, damage: 0 });
  expect(log.snapshot()).toEqual([]);
  for (let i = 0; i < 100; i++) log.record({ ...hit, tick: i * 120 });
  expect(log.snapshot()).toHaveLength(40);
  expect(log.snapshot()[0].tick).toBe(99 * 120);
  log.clear();
  expect(log.snapshot()).toEqual([]);
});
