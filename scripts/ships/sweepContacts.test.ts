import { expect, test } from 'bun:test';
import { applyAccepted, globMatch, groupContacts, parseAccepted, selectMounts, splitPatterns, type SweepMount } from './sweepContacts';
import { createReplay, type Pose, type ReplayUnit, type Resolve } from './sweepInterlock';

const ids = ['main-1', 'main-2', 'casemate-p1', 'casemate-s1', 'port-aa-20-6', 'secondary-p1'];

test('mount filters are whole-ID shell globs', () => {
  expect(globMatch('main-*', 'main-1')).toBe(true);
  expect(globMatch('main', 'main-1')).toBe(false);
  expect(globMatch('*secondary*', 'secondary-p1')).toBe(true);
  expect(globMatch('*aa*', 'port-aa-20-6')).toBe(true);
  expect(globMatch('casemate-?1', 'casemate-p1')).toBe(true);
  expect(globMatch('casemate-[s]1', 'casemate-p1')).toBe(false);
  expect(globMatch('casemate-[!s]1', 'casemate-p1')).toBe(true);
  expect(globMatch('{main,casemate}-*1', 'casemate-s1')).toBe(true);
  // Regular-expression characters are literal.
  expect(globMatch('main.1', 'main-1')).toBe(false);
  expect(globMatch('main-(1)', 'main-(1)')).toBe(true);
});

test('comma lists split outside braces, and patterns that match nothing are reported', () => {
  expect(splitPatterns('main-*, {casemate,aa}-p1,')).toEqual(['main-*', '{casemate,aa}-p1']);
  expect(selectMounts(ids, ['*-p1', 'main-2'])).toEqual({ selected: ['main-2', 'casemate-p1', 'secondary-p1'], unmatched: [] });
  expect(selectMounts(ids, ['*secondary*', '*tertiary*'])).toEqual({ selected: ['secondary-p1'], unmatched: ['*tertiary*'] });
});

test('a rotating base touching what it stands on is a seat contact; elevating parts and other parts are clashes', () => {
  const mount: SweepMount = {
    id: 'port-aa-20-6', samples: 4, seats: ['deck'], clashes: [
      { moving: 'port-aa-20-6.pedestal', joint: 'train', fixed: 'deck', fixedAssembly: 'hull', poses: [[0, 0, 0], [5, 0, 0]] },
      { moving: 'port-aa-20-6.base', joint: 'train', fixed: 'deck', fixedAssembly: 'hull', poses: [[5, 0, 0], [10, 0, 0]] },
      { moving: 'port-aa-20-6.barrel', joint: 'elevation', fixed: 'deck', fixedAssembly: 'hull', poses: [[0, -10, 0]] },
      { moving: 'port-aa-20-6.base', joint: 'train', fixed: 'rail', fixedAssembly: 'rail', poses: [[90, 0, 0]] },
    ],
  };
  const { clashes, seats } = groupContacts(mount);
  expect(seats).toEqual([{ against: 'deck (hull)', fixed: 'deck', assembly: 'hull', poses: [[0, 0, 0], [5, 0, 0], [10, 0, 0]] }]);
  expect(clashes.map(c => [c.against, c.poses.length])).toEqual([['deck (hull)', 1], ['rail', 1]]);
  // A sweep.json without seat data (an older sweep) has no seat contacts.
  expect(groupContacts({ ...mount, seats: undefined }).seats).toEqual([]);
});

test('accepted contacts match by mount and part, either way round for neighbours, and report stale entries', () => {
  const entries = parseAccepted(JSON.stringify({ accepted: [
    { mount: 'casemate-*', against: 'hull', reason: 'drums turn in their embrasures' },
    { mount: 'main-2', against: 'main-1', reason: 'posed independently only' },
    { mount: 'main-1', against: 'windlass-*', reason: 'fixed since' },
    { mount: 'aa-9', against: 'deck', reason: 'not swept this run' },
  ] }));
  const failing = [
    { mount: 'casemate-p1', against: ['hull', 'Blueprint lofted hull'], kind: 'fixed' as const },
    { mount: 'main-1', against: ['main-2'], kind: 'mount' as const },
    { mount: 'main-1', against: ['vent-12', 'vent-12.hood'], kind: 'fixed' as const },
  ];
  const { accepted, stale } = applyAccepted(entries, failing, ['casemate-p1', 'main-1', 'main-2']);
  expect(accepted.map(e => e?.reason)).toEqual(['drums turn in their embrasures', 'posed independently only', undefined]);
  expect(stale.map(e => e.reason)).toEqual(['fixed since']);
  expect(() => parseAccepted('{"accepted":[{"mount":"main-1","against":"hull"}]}')).toThrow('accepted[0] needs a non-empty string "reason"');
  expect(() => parseAccepted('[]')).toThrow('expected { "accepted"');
});

// A toy resolver: mount 0 cannot train through 30–40° below 10° of elevation, and its barrel meets mount 1 when
// both train past 60°. Enough to exercise intervals, train-first moves, stops and neighbour replays.
const rad = (d: number) => (d * Math.PI) / 180;
const resolve: Resolve = (current, requested) => current.map((from, i) => {
  const to = requested[i];
  const low = Math.max(from.elevation, to.elevation) < rad(10);
  let train = to.train;
  if (i === 0 && low && from.train <= rad(30) && to.train > rad(30)) train = rad(30);
  if (i === 0 && low && from.train >= rad(40) && to.train < rad(40)) train = rad(40);
  const other = current[1 - i];
  if (other && other.train > rad(60) && to.train > rad(60) && from.train <= rad(60)) train = rad(60);
  const pose: Pose = { train, elevation: to.elevation, recoil: to.recoil };
  return { pose, blocked: train !== to.train, obstructionId: null };
});
const definition = { mounts: [{ id: 'a', initialElevationDeg: 0 }, { id: 'b', initialElevationDeg: 0 }] };
const units: ReplayUnit[] = [
  { kind: 'fixed', mount: 'a', poses: [[20, 0, 0], [35, 0, 0], [50, 0, 0], [50, 20, 0], [35, 20, 1]] },
  { kind: 'fixed', mount: 'b', poses: [[70, 0, 0]] },
  { kind: 'mount', a: 'a', b: 'b', poses: [[70, 20, 0, 70, 0, 0], [20, 0, 0, 70, 0, 0], [70, 0, 0, 20, 0, 0], [65, 20, 0, 65, 0, 0]] },
];

test('the round-based parallel replay equals one sequential replay', () => {
  const sequential = createReplay(definition, resolve);
  const expected = units.map(u => sequential.replay(u));
  expect(expected[0]).toEqual({ reachable: 3, example: [20, 0, 0], stopsAt: 'train 30.0°, elevation 0.0°' });
  expect(expected[2]).toEqual({ reachable: 1, example: [20, 0, 0, 70, 0, 0] });

  const main = createReplay(definition, () => { throw new Error('main thread resolved'); });
  expect(() => main.replayCached(units[0])).toThrow('interlock replay cache lacks band');
  const workers = [createReplay(definition, resolve), createReplay(definition, resolve), createReplay(definition, resolve)];
  let rounds = 0;
  for (let queries = main.pending(units); queries.length; queries = main.pending(units)) {
    expect(++rounds).toBeLessThan(8);
    queries.forEach((q, k) => { workers[k % workers.length].answer(q); });
    for (const cache of workers.map(w => w.drain())) { main.seed(cache); for (const w of workers) w.seed(cache); }
  }
  expect(rounds).toBeGreaterThan(1);
  expect(units.map(u => main.replayCached(u))).toEqual(expected);
});
