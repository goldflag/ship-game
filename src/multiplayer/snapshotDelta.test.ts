import { expect, test } from 'bun:test';
import { expandSnapshot } from './snapshotDelta';
test('skipped snapshots reconstruct from an immutable baseline, including new metadata and array changes', () => {
 const baseline = { tick: 0, actors: [{ hp: 100 }], events: [] };
 const next = expandSnapshot(baseline, { type: 'snapshot-delta', patches: [[['tick'], 900], [['actors', 0, 'hp'], 25], [['events'], [1, 2]], [['phase'], 'running']] });
 expect(next).toEqual({ tick: 900, actors: [{ hp: 25 }], events: [1, 2], phase: 'running' });
 expect(baseline.actors[0].hp).toBe(100);
 expect(expandSnapshot(baseline, { type: 'snapshot-delta', patches: [[['tick'], 1200]] })).toEqual({ ...baseline, tick: 1200 });
});
test('invalid snapshot paths cannot reach prototypes or grow arbitrary arrays', () => {
 for (const path of [['__proto__', 'polluted'], ['actors', 900], ['absent', 'key']]) expect(() => expandSnapshot({actors:[{}]}, { type: 'snapshot-delta', patches: [[path, true]] })).toThrow();
 expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
});
