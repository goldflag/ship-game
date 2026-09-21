import { expect, test } from 'bun:test';
import type { BattleProgress } from '../../game/Game';
import { BattleEntry } from './BattleEntry';

function harbor() {
  let active = true;
  const events: string[] = [];
  const entry = new BattleEntry(
    () => active,
    (label) => events.push(label),
    () => events.push('failed'),
  );
  return {
    entry,
    events,
    retire: () => {
      active = false;
    },
  };
}

test('entry serializes preparation, commits once and stops accepting settled progress', async () => {
  const { entry, events } = harbor();
  const preparation = Promise.withResolvers<void>();
  let report!: BattleProgress;
  const launch = entry.run(
    (progress) => {
      report = progress;
      progress('loading', 0.5);
      return preparation.promise;
    },
    () => events.push('commit'),
  );
  expect(entry.pending).toBe(true);
  await expect(
    entry.run(
      async () => {},
      () => events.push('overlap'),
    ),
  ).rejects.toThrow('still preparing');
  preparation.resolve();
  await launch;
  report('late', 1);
  expect(entry.pending).toBe(false);
  expect(events).toEqual(['loading', 'commit']);
});

test.each(['resolve', 'reject'] as const)('retired Game %s cannot change a replacement launch', async (outcome) => {
  const old = harbor(),
    replacement = harbor();
  const oldPreparation = Promise.withResolvers<void>(),
    newPreparation = Promise.withResolvers<void>();
  let report!: BattleProgress;
  const launch = old.entry.run(
    (progress) => {
      report = progress;
      return oldPreparation.promise;
    },
    () => old.events.push('commit'),
    () => old.events.push('dispose'),
  );
  const failure = new Error('old preparation failed');
  const result = launch.catch((error) => {
    expect(error).toBe(failure);
  });
  old.retire();
  const next = replacement.entry.run(
    () => newPreparation.promise,
    () => replacement.events.push('commit'),
  );
  report('stale progress', 0.8);
  if (outcome === 'resolve') oldPreparation.resolve();
  else oldPreparation.reject(failure);
  await result;
  expect(old.events).toEqual(outcome === 'resolve' ? ['dispose'] : []);
  expect(old.entry.pending).toBe(false);
  expect(replacement.entry.pending).toBe(true);
  expect(replacement.events).toEqual([]);
  newPreparation.resolve();
  await next;
  expect(replacement.events).toEqual(['commit']);
});

test('current failure clears presentation, preserves the error contract, and permits retry', async () => {
  const { entry, events } = harbor();
  const failure = new Error('asset unavailable');
  await expect(
    entry.run(
      async () => {
        throw failure;
      },
      () => events.push('commit'),
    ),
  ).rejects.toBe(failure);
  expect(entry.pending).toBe(false);
  expect(events).toEqual(['failed']);
  await entry.run(
    async () => {},
    () => events.push('retry committed'),
  );
  expect(events).toEqual(['failed', 'retry committed']);
});
