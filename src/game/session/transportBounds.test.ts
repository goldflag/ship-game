import { expect, test } from 'bun:test';
import { decodeSnapshot } from './SnapshotSession';

test('worker transfer preserves absent optional fields and positional null slots', () => {
  const decoded = decodeSnapshot(JSON.stringify({ tick: 0, actors: [{ optional: null, nested: { absent: null, value: 4 }, slots: [null, { absent: null }] }] }));
  expect(structuredClone(decoded) as unknown).toEqual({ tick: 0, actors: [{ nested: { value: 4 }, slots: [null, {}] }] });
});
test('snapshot boundary rejects missing fleets, negative ticks and excess actors', () => {
 for (const frame of [{ tick: 0 }, { tick: -1, actors: [{}] }, { tick: 1, actors: Array(61).fill({}) }]) expect(() => decodeSnapshot(JSON.stringify(frame))).toThrow('Invalid battle snapshot');
});
