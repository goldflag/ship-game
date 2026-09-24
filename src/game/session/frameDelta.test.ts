import { expect, test } from 'bun:test';
import { applyFramePatch, BinaryFrameReader, binaryUpdateTicks, decodeFrameUpdate, type FrameUpdate } from './frameDelta';
import { HeadlessSession } from '../../../scripts/multiplayer/headless-session';
import { SnapshotSession, type Snapshot } from './SnapshotSession';
import { decodeSnapshot } from './snapshotCodec';
import { managedDeckFixture } from '../../../scripts/multiplayer/managed-deck-fixture';

test('scalar patches preserve zero, false, empty text and null; a wrapped value replaces whole', () => {
  const previous = { changing: 5, stable: { id: 'ship' }, list: [1, 2] };
  for (const next of [0, false, '', null, 4, true, 'target']) {
    const result = applyFramePatch(previous, { object: { changing: next } }) as typeof previous;
    expect(result).toEqual({ ...previous, changing: next as never }); expect(previous.changing).toBe(5);
    expect(result.stable).toBe(previous.stable);
  }
  expect(applyFramePatch(previous, { object: { stable: { value: { id: 'other' } } }, removed: ['changing'] })).toEqual({ stable: { id: 'other' }, list: [1, 2] });
  expect(applyFramePatch(previous, { object: { list: { array: [[1, 9]] } } })).toEqual({ ...previous, list: [1, 9] });
  expect(applyFramePatch(previous, undefined)).toBe(previous);
});

test('a keyed array copies its survivors to where they now sit and patches the rest', () => {
  const a = { id: 1 }, b = { id: 2, v: 0 }, c = { id: 3 };
  const previous = { list: [a, b, c], other: { id: 'kept' } };
  const result = applyFramePatch(previous, { object: { list: { array: [[0, { object: { v: 1 } }], [2, { value: { id: 4 } }], [3, null]], from: [[0, 1, 2]], length: 4 } } }) as typeof previous;
  expect(result.list).toEqual([{ id: 2, v: 1 }, { id: 3 }, { id: 4 }, null] as never);
  expect(result.list[1]).toBe(c); expect(result.other).toBe(previous.other);
  expect(previous.list).toEqual([a, b, c]); expect(b.v).toBe(0);
  // Runs may leave gaps for arrivals between survivors.
  expect(applyFramePatch([a, b, c], { array: [[1, { value: { id: 5 } }]], from: [[0, 0, 1], [2, 2, 1]], length: 3 })).toEqual([a, { id: 5 }, c]);
});

test('prototype-named fields remain ordinary own data properties', () => {
  const previous = JSON.parse('{"__proto__":{"unchanged":1,"value":2},"constructor":3,"other":{"id":"ship"}}');
  const result = applyFramePatch(previous, JSON.parse('{"object":{"__proto__":{"object":{"value":0}},"constructor":false}}')) as Record<string, unknown>;
  expect(result).toEqual(JSON.parse('{"__proto__":{"unchanged":1,"value":0},"constructor":false,"other":{"id":"ship"}}'));
  expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
  expect(Object.hasOwn(result, '__proto__')).toBe(true);
  expect(previous.__proto__.value).toBe(2);
});

test('an update against a reference the session does not hold is a transport fault', () => {
  const frame = { tick: 3, actors: [{}] } as unknown as Snapshot;
  expect(() => decodeFrameUpdate(undefined, { baseTick: 2, tick: 3 })).toThrow('not holding');
  expect(() => decodeFrameUpdate(frame, { baseTick: null, tick: 4, delta: { value: frame } })).toThrow('not holding');
  expect(() => decodeFrameUpdate(frame, { baseTick: 3, tick: 4 })).toThrow('disagrees');
  expect(() => decodeFrameUpdate(frame, { baseTick: 3, tick: -1 })).toThrow('Invalid');
  expect(decodeFrameUpdate(frame, { baseTick: 3, tick: 3 })).toBe(frame);
  expect(decodeFrameUpdate(frame, { baseTick: 3, tick: 4, delta: { object: { tick: 4 } } })).toEqual({ ...frame, tick: 4 });
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

/** The codec's null invariant, checked on the wire: no object field is null
 * except the one whose null is a policy. */
function nullKeys(value: unknown, path = ''): string[] {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap((v, i) => nullKeys(v, `${path}[${i}]`));
  return Object.entries(value).flatMap(([key, v]) => v === null ? key === 'activeFlightLimit' ? [] : [`${path}.${key}`] : nullKeys(v, `${path}.${key}`));
}

test('Rust-encoded updates rebuild the complete frame, its identities and its events', async () => {
  const source = await HeadlessSession.create({ playerShipId: 'bismarck', friendlyBots: ['enterprise-cv6', 'fletcher'], enemies: ['enterprise-cv6', 'baltimore'], spawnDistance: 5000 });
  const receiver = new Receiver(source.setup);
  let received: Snapshot | undefined, fullBytes = 0, patchBytes = 0;
  try {
    for (let step = 0; step < 120; step++) {
      // The panel detail follows the camera; changing it moves whole subtrees
      // in and out of the frame between one update and the next.
      const detail = step < 40 ? ['player'] : step < 80 ? ['player', 'enemy-1'] : [];
      const json = source.runtime.snapshot_delta(detail);
      const update = JSON.parse(json) as FrameUpdate;
      expect(update.baseTick ?? undefined).toBe(received?.tick);
      received = decodeFrameUpdate(received, structuredClone(update));
      freezeFrame(received); receiver.receive(received);
      // The complete frame is what the renderer would hold from a whole
      // snapshot; the patched frame has to equal it field for field, absent
      // optionals included, and neither may carry a null the codec should
      // have dropped.
      const complete = decodeSnapshot(source.runtime.detailed_snapshot(detail));
      expect(received).toEqual(complete);
      expect(nullKeys(complete)).toEqual([]);
      if (!detail.length) {
        expect(receiver.actors.map(({ definition, ...state }) => state)).toEqual(source.actors.map(({ definition, ...state }) => state));
        expect(receiver.events).toEqual(source.events);
        expect(receiver.shells).toEqual(source.shells);
      }
      fullBytes += JSON.stringify(complete).length; patchBytes += json.length;
      source.advance(.1, { throttle: .5, rudder: .25 }, { aim: [0, 0, -5000], battery: 'main', fire: true });
    }
    expect(patchBytes).toBeLessThan(fullBytes * .2);
  } finally { source.dispose(); }
}, 60000);

/** The same frame through two decoders: equal leaves (`Object.is`), the same key
 * order, and the same subtrees kept from each one's previous frame. */
function sameDecode(a: unknown, aPrevious: unknown, b: unknown, bPrevious: unknown, path = 'frame'): string | undefined {
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return Object.is(a, b) ? undefined : `${path}: ${String(a)} vs ${String(b)}`;
  if ((a === aPrevious) !== (b === bPrevious)) return `${path}: kept by one decoder only`;
  if (a === aPrevious) return;
  const keys = Object.keys(a);
  if (Array.isArray(a) !== Array.isArray(b) || keys.join() !== Object.keys(b).join()) return `${path}: shape`;
  for (const key of keys) {
    const child = (value: unknown) => value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined;
    const found = sameDecode(child(a), child(aPrevious), child(b), child(bPrevious), `${path}.${key}`);
    if (found) return found;
  }
}

test('the worker\'s binary stream rebuilds the text stream\'s frames, identities, key order and key table included', async () => {
  // Twin sessions from one seed publish the same frames, one stream in each form.
  const setup = { playerShipId: 'bismarck', friendlyBots: ['enterprise-cv6', 'fletcher'], enemies: ['enterprise-cv6', 'baltimore'], spawnDistance: 5000 };
  const [text, binary] = await Promise.all([HeadlessSession.create(setup), HeadlessSession.create(setup)]);
  const reader = new BinaryFrameReader();
  let fromText: Snapshot | undefined, fromBinary: Snapshot | undefined, textBytes = 0, binaryBytes = 0;
  try {
    for (let step = 0; step < 160; step++) {
      const detail = step % 60 < 20 ? ['player'] : step % 60 < 40 ? ['player', 'enemy-1'] : [];
      const json = text.runtime.snapshot_delta(detail), bytes = binary.runtime.snapshot_delta_binary(detail);
      const ticks = binaryUpdateTicks(bytes), update = JSON.parse(json) as FrameUpdate;
      expect(ticks).toEqual({ baseTick: update.baseTick, tick: update.tick });
      const nextText = decodeFrameUpdate(fromText, update), nextBinary = reader.decode(fromBinary, bytes);
      freezeFrame(nextText); freezeFrame(nextBinary);
      expect(sameDecode(nextText, fromText, nextBinary, fromBinary)).toBeUndefined();
      expect(nextBinary).toEqual(decodeSnapshot(binary.runtime.detailed_snapshot(detail)));
      fromText = nextText; fromBinary = nextBinary; textBytes += json.length; binaryBytes += bytes.byteLength;
      for (const session of [text, binary]) session.advance(.1, { throttle: .5, rudder: .25 }, { aim: [0, 0, -5000], battery: 'main', fire: true });
    }
    expect(binaryBytes).toBeLessThan(textBytes * .5);
    // An update against another reference, or a key table the reader is not holding, is a transport fault.
    const next = binary.runtime.snapshot_delta_binary([]);
    expect(() => new BinaryFrameReader().decode(fromBinary, next)).toThrow('key table');
    expect(() => reader.decode(undefined, next)).toThrow('baseline');
  } finally { text.dispose(); binary.dispose(); }
}, 60000);

test('a carrier frame keeps its declared shape: the deck limit is the one null that travels', async () => {
  const content = new Uint8Array(await Bun.file(new URL('../../../.build/naval-content/manifest.json', import.meta.url)).arrayBuffer());
  const source = await HeadlessSession.create({ playerShipId: 'enterprise-cv6', friendlyBots: [], enemies: ['fletcher'], spawnDistance: 5000 }, managedDeckFixture(content));
  try {
    const frame = decodeSnapshot(source.runtime.snapshot());
    const deck = frame.wings.find(w => w.ownerId === 'player')!.state.deck!;
    expect(Object.hasOwn(deck, 'activeFlightLimit')).toBe(true);
    expect(nullKeys(frame)).toEqual([]);
    expect(frame.phase).toBe('running'); expect(frame.selectedShipIds[0]).toBe('player');
    expect(Object.hasOwn(frame, 'outcome')).toBe(false);
  } finally { source.dispose(); }
});

test('one Rust-encoded update reads the same through the worker reference and the immutable baseline', async () => {
  const source = await HeadlessSession.create({ playerShipId: 'fletcher', friendlyBots: ['fletcher'], enemies: ['fletcher'], spawnDistance: 5000 });
  try {
    // The worker holds the frame it received last; the match client holds
    // the baseline it was admitted with. After one step both are the same
    // frame, so the same update must decode identically against either.
    const first = JSON.parse(source.runtime.snapshot_delta([])) as FrameUpdate;
    expect(first.baseTick).toBeNull();
    const baseline = decodeFrameUpdate(undefined, first);
    source.runtime.step(6);
    const update = JSON.parse(source.runtime.snapshot_delta([])) as FrameUpdate;
    expect(update.baseTick).toBe(baseline.tick); expect(update.tick).toBe(baseline.tick + 6);
    const viaWorker = decodeFrameUpdate(baseline, structuredClone(update));
    const viaBaseline = decodeFrameUpdate(structuredClone(baseline), structuredClone(update));
    expect(viaWorker).toEqual(viaBaseline);
    expect(viaWorker).toEqual(decodeSnapshot(source.runtime.snapshot()));
    expect(baseline.tick).toBe(0);
  } finally { source.dispose(); }
});
