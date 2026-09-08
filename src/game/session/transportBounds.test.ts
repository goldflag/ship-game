import { expect, test } from 'bun:test';
import { decodeSnapshot } from './SnapshotSession';
test('snapshot boundary rejects missing fleets, negative ticks and excess actors', () => {
 for (const frame of [{ tick: 0 }, { tick: -1, actors: [{}] }, { tick: 1, actors: Array(61).fill({}) }]) expect(() => decodeSnapshot(JSON.stringify(frame))).toThrow('Invalid battle snapshot');
});
