import { afterAll, expect, spyOn, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSteps } from './steps';

const logs = mkdtempSync(join(tmpdir(), 'steps-'));
afterAll(() => rmSync(logs, { recursive: true, force: true }));
const step = (label: string, code: number, required = false) => ({ label, required, command: [process.execPath, '-e', `console.log('${label} ran'); process.exit(${code})`] });

async function run(steps: ReturnType<typeof step>[]) {
  const printed: string[] = [], log = spyOn(console, 'log').mockImplementation((...parts) => { printed.push(parts.join(' ')); });
  const write = spyOn(process.stdout, 'write').mockImplementation(() => true);
  try { return { code: await runSteps('Gate', steps, logs, { stream: false }), printed: printed.join('\n') }; } finally { log.mockRestore(); write.mockRestore(); }
}

test('a failing step does not stop the ones after it, and the gate still fails', async () => {
  const { code, printed } = await run([step('first', 0), step('second', 3), step('third', 0)]);
  expect(code).toBe(1);
  expect(printed).toContain('FAILED');
  expect(printed).toContain('  | second ran');
  expect(readFileSync(join(logs, 'third.log'), 'utf8')).toBe('third ran\n');
  expect(printed).toContain('Gate: 1 of 3 steps failed (second)');
});

test('a required step that fails ends the run and names what did not run', async () => {
  const { code, printed } = await run([step('prepare', 1, true), step('check', 0)]);
  expect(code).toBe(1);
  expect(printed).toContain('not run: check');
});
