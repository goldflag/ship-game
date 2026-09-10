import { expect, test } from 'bun:test';
import { runTestFiles, testNamePatterns } from './run';

test('scenario scheduling executes existing, renamed and new names exactly once', () => {
  for (const prefixes of [[], ['fire', 'firing'], ['fire', 'fire again', 'fire'], ['fire(', 'a.b', '[x]', '\\'], ['', 'fire']]) {
    const patterns = testNamePatterns(prefixes).map(pattern => new RegExp(pattern));
    for (const name of ['', 'fire', 'fire again', 'firing', 'fire(mount)', 'a.b', 'axb', '[x]', '\\', 'new test', 'renamed suite > test', '船のテスト']) {
      const matches = patterns.map((pattern, i) => pattern.test(name) ? i : -1).filter(i => i >= 0);
      const first = prefixes.findIndex(prefix => name.startsWith(prefix));
      expect(matches).toEqual([first < 0 ? prefixes.length : first]);
    }
  }
});

test('invalid concurrency cannot silently skip the suite', async () => {
  for (const workers of [0, -1, 1.5, NaN, Infinity]) {
    await expect(runTestFiles(['missing.test.ts'], workers)).rejects.toThrow('Concurrency must be a positive integer');
  }
});
