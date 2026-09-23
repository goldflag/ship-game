/** Runs a gate's steps in order without stopping at the first failure, so one red check cannot hide the others. Each
 * step's output goes to `<logs>/<step>.log` and a failing step prints its tail; under CI or `--verbose` it streams instead. */
import { closeSync, mkdirSync, openSync, readFileSync, rmSync } from 'node:fs';
import { relative, resolve } from 'node:path';

/** `required`: the steps after it cannot run without it, so its failure ends the run. */
export interface Step { label: string; command: string[]; required?: boolean }

const TAIL = 60;
const seconds = (since: number) => `${((performance.now() - since) / 1000).toFixed(1)} s`;

export async function runSteps(title: string, steps: Step[], logs: string, options: { root?: string; stream?: boolean } = {}): Promise<number> {
  const { root = resolve(import.meta.dir, '../..'), stream = !!process.env.CI || process.argv.includes('--verbose') } = options;
  const started = performance.now(), failed: string[] = [];
  let skipped: string[] = [];
  rmSync(logs, { recursive: true, force: true });
  mkdirSync(logs, { recursive: true });
  let child: ReturnType<typeof Bun.spawn> | undefined;
  const interrupt = (signal: NodeJS.Signals) => { child?.kill(signal); process.exit(130); };
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  for (const [index, step] of steps.entries()) {
    const log = resolve(logs, `${step.label.replace(/[^\w.]+/g, '-').replace(/^-|-$/g, '')}.log`), begin = performance.now();
    let code: number;
    if (stream) {
      console.log(`\n==> ${step.label}`);
      child = Bun.spawn(step.command, { cwd: root, stdio: ['inherit', 'inherit', 'inherit'] });
      code = await child.exited;
    } else {
      process.stdout.write(`${step.label} … `);
      // One descriptor for both streams keeps their lines in order in the log.
      const fd = openSync(log, 'w');
      try {
        child = Bun.spawn(step.command, { cwd: root, stdin: 'ignore', stdout: fd, stderr: fd });
        code = await child.exited;
      } finally { closeSync(fd); }
    }
    child = undefined;
    if (!code) { console.log(stream ? `<== ${step.label}: ok (${seconds(begin)})` : `ok (${seconds(begin)})`); continue; }
    failed.push(step.label);
    if (stream) console.log(`<== ${step.label}: FAILED (${seconds(begin)}, exit ${code})`);
    else {
      // Some tools (rustfmt) colour even a file; the tail drops the escapes.
      const lines = readFileSync(log, 'utf8').replace(/\x1b(\[[\d;]*m|\(B)/g, '').trimEnd().split('\n');
      console.log(`FAILED (${seconds(begin)}, exit ${code}); ${lines.length > TAIL ? `last ${TAIL} of ${lines.length} lines` : 'output'} of ${relative(root, log)}:`);
      console.log(lines.slice(-TAIL).map(line => `  | ${line}`).join('\n'));
    }
    if (step.required && index < steps.length - 1) {
      skipped = steps.slice(index + 1).map(next => next.label);
      console.log(`${step.label} failed and the remaining steps need it, so they did not run.`);
      break;
    }
  }
  process.removeListener('SIGINT', interrupt);
  process.removeListener('SIGTERM', interrupt);
  const outcome = failed.length ? `${failed.length} of ${steps.length} steps failed (${failed.join(', ')})` : `all ${steps.length} steps passed`;
  const notRun = skipped.length ? `; not run: ${skipped.join(', ')}` : '', where = stream ? '' : `; logs in ${relative(root, logs)}/`;
  console.log(`\n${title}: ${outcome}${notRun}; ${seconds(started)}${where}`);
  return failed.length ? 1 : 0;
}
