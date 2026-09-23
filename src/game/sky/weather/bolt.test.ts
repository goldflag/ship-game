import { expect, test } from 'bun:test';
import { buildBolt, createBoltChannel, MAX_BOLT_SEGMENTS } from './bolt';
import { seededRandom } from './lightning';

const top: [number, number, number] = [140, 650, -60], bottom: [number, number, number] = [0, -3, 0];

test('a bolt runs unbroken from the cloud base to the sea, with branches that only the first stroke lights', () => {
  for (let seed = 1; seed < 200; seed++) {
    const channel = createBoltChannel();
    buildBolt(channel, seededRandom(seed), top, bottom);
    expect(channel.count).toBeGreaterThan(20);
    expect(channel.count).toBeLessThanOrEqual(MAX_BOLT_SEGMENTS);
    const { start, end } = channel;
    const main = Array.from({ length: channel.count }, (_, i) => i).filter(i => end[i * 4 + 3] > 0);
    const branches = channel.count - main.length;
    expect(branches).toBeGreaterThan(0);
    // The main channel is one polyline: it starts on the cloud base, each segment starts where the last ended, and it meets the sea.
    expect([start[0], start[1], start[2]]).toEqual(top.map(Math.fround));
    for (let k = 1; k < main.length; k++) for (let c = 0; c < 3; c++) expect(start[main[k] * 4 + c]).toBe(end[main[k - 1] * 4 + c]);
    const last = main[main.length - 1];
    expect([end[last * 4], end[last * 4 + 1], end[last * 4 + 2]]).toEqual(bottom);
    for (let i = 0; i < channel.count; i++) {
      // Branches stay above the sea and under the cloud; brightness stays within a stroke's peak.
      expect(Math.abs(end[i * 4 + 3])).toBeLessThanOrEqual(1);
      expect(start[i * 4 + 3]).toBeGreaterThan(0);
      if (end[i * 4 + 3] < 0) expect(end[i * 4 + 1]).toBeGreaterThan(bottom[1]);
      // Segments are short: a channel turns every few tens of metres.
      expect(Math.hypot(end[i * 4] - start[i * 4], end[i * 4 + 1] - start[i * 4 + 1], end[i * 4 + 2] - start[i * 4 + 2])).toBeLessThan(45);
    }
  }
});

test('the same seed builds the same bolt; another seed another', () => {
  const build = (seed: number) => {
    const channel = createBoltChannel();
    buildBolt(channel, seededRandom(seed), top, bottom);
    return [...channel.start.subarray(0, channel.count * 4), ...channel.end.subarray(0, channel.count * 4)];
  };
  expect(build(7)).toEqual(build(7));
  expect(build(8)).not.toEqual(build(7));
});
