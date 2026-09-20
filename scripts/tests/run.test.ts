import { expect, test } from 'bun:test';
import { boundedOutput, failedTests, runTestFiles, testNamePatterns } from './run';

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

test('failed test names come from Bun\'s fail lines and a failing file\'s output is bounded', () => {
  expect(failedTests('(pass) a [1.00ms]\n(fail) suite > renders the wheel [11.23ms]\n(fail) plain name\n(fail) suite > renders the wheel [2.00s]')).toEqual(['suite > renders the wheel', 'plain name']);
  const output = boundedOutput(['bun test v1.3.3 (274e01c7)', "THREE.GLTFLoader: Couldn't load texture blob:x", 'Received: ' + 'x'.repeat(5000), ...Array.from({ length: 400 }, (_, i) => `line ${i}`)].join('\n'));
  expect(output).not.toContain('GLTFLoader');
  expect(output.split('\n').length).toBeLessThanOrEqual(161);
  expect(Math.max(...output.split('\n').map(line => line.length))).toBeLessThan(440);
  expect(output).toContain('line 399');
});
