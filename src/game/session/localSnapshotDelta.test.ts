import { expect, test } from 'bun:test';
import { applyLocalDelta, localDelta } from './localSnapshotDelta';
import { HeadlessSession } from '../../../scripts/multiplayer/headless-session';
import { decodeSnapshot, SnapshotSession, type Snapshot } from './SnapshotSession';

test('ordered deltas preserve deletions, array replacement, null slots and earlier snapshots', () => {
  let previous: unknown, received: unknown;
  for (const next of [
    { tick: 0, state: { ammo: [1, 2], optional: 'target', jobs: [null] }, stable: { id: 'ship' } },
    { tick: 1, state: { ammo: [1, 1], jobs: [null] }, stable: { id: 'ship' } },
    { tick: 2, state: { ammo: [], jobs: [{ job: 'pump' }] }, stable: { id: 'ship' } },
    { tick: 3, state: { ammo: [4], jobs: [null], optional: 'new target' }, stable: { id: 'ship' } },
  ]) {
    const old = structuredClone(received);
    const updated = applyLocalDelta(received, structuredClone(localDelta(previous, next)));
    expect(updated).toEqual(next); expect(received).toEqual(old);
    previous = next; received = updated;
  }
  expect(localDelta(received, structuredClone(received))).toBeUndefined();
});

class Receiver extends SnapshotSession {
  readonly networked = false;
  protected send() {}
  advance() {}
  dispose() {}
  receive(frame: Snapshot) { this.apply(frame); }
}

function freezeFrame(value: unknown): void {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return;
  Object.freeze(value);
  for (const child of Object.values(value)) freezeFrame(child);
}

test('real carrier snapshots remain exact through transfer and renderer identity updates', async () => {
  const source = await HeadlessSession.create({ playerShipId: 'bismarck', friendlyBots: ['enterprise-cv6', 'fletcher'], enemies: ['enterprise-cv6', 'baltimore'], spawnDistance: 5000 });
  const receiver = new Receiver(source.setup);
  let previous: Snapshot | undefined, received: Snapshot | undefined, fullBytes = 0, deltaBytes = 0;
  try {
    previous = decodeSnapshot(source.runtime.snapshot());
    received = structuredClone(previous); freezeFrame(received); receiver.receive(received);
    for (let step = 0; step < 160; step++) {
      source.advance(.1, { throttle: .5, rudder: .25 }, { aim: [0, 0, -5000], battery: 'main', fire: true });
      const next = decodeSnapshot(source.runtime.snapshot());
      const delta = localDelta(previous, next);
      fullBytes += JSON.stringify(next).length; deltaBytes += JSON.stringify(delta).length;
      received = applyLocalDelta(received, structuredClone(delta)) as Snapshot;
      freezeFrame(received);
      receiver.receive(received);
      expect(received).toEqual(next);
      // Definitions are shared immutable assets; compare the complete live state.
      expect(receiver.actors.map(({ definition, ...state }) => state)).toEqual(source.actors.map(({ definition, ...state }) => state));
      expect(receiver.events).toEqual(source.events);
      expect(receiver.shells).toEqual(source.shells);
      previous = next;
    }
    expect(deltaBytes).toBeLessThan(fullBytes * .5);
  } finally { source.dispose(); }
}, 30000);
