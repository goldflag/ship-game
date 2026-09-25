import { expect, test } from 'bun:test';
import { consoleProblem } from './diagnosticPage';

test('consoleProblem keeps errors (and warnings when asked) and names a failed resource', () => {
  const failed = 'Failed to load resource: the server responded with a status of 404 (Not Found)';
  expect(consoleProblem('error', failed, 'http://127.0.0.1:5000/missing.bin')).toBe(`${failed}: http://127.0.0.1:5000/missing.bin`);
  expect(consoleProblem('error', 'boom', 'http://127.0.0.1:5000/src/game/Game.ts')).toBe('boom');
  expect(consoleProblem('warning', 'slow')).toBeUndefined();
  expect(consoleProblem('warning', 'slow', undefined, true)).toBe('slow');
  expect(consoleProblem('log', 'hello', undefined, true)).toBeUndefined();
});
