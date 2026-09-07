import { expect, test } from 'bun:test';
import { segmentBox } from './geometry';
import { segmentIntersectsBox } from './obstruction';
import type { Vec3 } from '../ships/blueprint';

test('boolean gun obstruction query agrees with swept hits, including tangency and starts inside', () => {
  let seed = 19;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 0x100000000 - .5) * 50;
  const point = (): Vec3 => [random(), random(), random()];
  for (let i = 0; i < 10000; i++) {
    const center = point(), size = point().map(n => Math.abs(n)) as Vec3;
    const from = i % 3 === 0 ? center : point(), to = point();
    if (i % 4 === 0) { from[0] = center[0] + size[0] / 2; to[0] = from[0]; }
    expect(segmentIntersectsBox(from, to, { center, size })).toBe(!!segmentBox(from, to, { center, size }));
  }
});
