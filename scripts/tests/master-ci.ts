/** What master's CI already fails, so a local failure can be told apart from one the change caused without
 * re-running it on master. Reads the Validate workflow's runs through `gh`: the nearest completed run at or before a
 * commit on master's first-parent line whose step ran. Parsed runs are cached in the main checkout's
 * `.build/master-ci/`, shared by every worktree.
 *
 *   bun run master:red              what master's latest completed CI run fails (TypeScript tests and cargo tests)
 *   bun run master:red -- <ref>     at or before that commit */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { mainCheckout } from '../browser/designs';

const WORKFLOW = 'validate.yml', TEST_STEP = 'Run bun run test', RUST_STEP = 'Run bun run multiplayer:check';
/** How far back along master to look for a completed run whose step ran. */
const DEPTH = 60;

/** One run's failures: `file > test` from `bun run test`, `binary > test` from cargo, and failed check steps. */
export interface RunFailures { tests: string[]; cargo: string[]; checks: string[] }
interface CachedRun extends RunFailures { id: number; sha: string; url: string; steps: Record<string, string> }
/** Failures from the nearest run in which that step ran; `behind` counts master commits between it and the base. */
export interface StepResult { sha: string; url: string; behind: number; conclusion: string; failures: string[] }
export type MasterStatus = { tests?: StepResult; rust?: StepResult; checks: string[] } | { unavailable: string };

const run = (command: string, args: string[], cwd: string) => {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 60_000, maxBuffer: 64 * 1024 * 1024 });
  return result.status === 0 ? result.stdout : undefined;
};

/** Failures in a `gh run view --log-failed` log. Each line is `job<TAB>step<TAB>timestamp text`. */
export function parseLog(log: string): RunFailures {
  const tests = new Set<string>(), cargo = new Set<string>(), checks = new Set<string>();
  let section = false, binary = '';
  for (const raw of log.split('\n')) {
    const line = raw.replace(/^[^\t]*\t[^\t]*\t\S+Z ?/, '');
    // scripts/tests/run.ts's summary lists every failure, ledger or not, as `  file > test`.
    if (/^(New failures, not in|Known failures, already red on master)/.test(line)) { section = true; continue; }
    if (section && /^ {2}\S.* > /.test(line)) { tests.add(line.trim()); continue; }
    section = false;
    const running = line.match(/^\s*Running (?:tests\/(\S+)\.rs|unittests \S+ \(\S*\/deps\/(\w+?)-[0-9a-f]+\))/);
    if (running) binary = running[1] ?? running[2];
    const failed = line.match(/^test (\S+) \.\.\. FAILED$/);
    if (failed) cargo.add(`${binary} > ${failed[1]}`);
    const step = line.match(/^<== (.+?): FAILED/);
    if (step) checks.add(step[1]);
  }
  return { tests: [...tests].sort(), cargo: [...cargo].sort(), checks: [...checks].sort() };
}

function cachedRun(root: string, cache: string, entry: { databaseId: number; headSha: string; url: string }): CachedRun | undefined {
  const path = join(cache, `${entry.databaseId}.json`);
  if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf8'));
  const jobs = run('gh', ['run', 'view', String(entry.databaseId), '--json', 'jobs'], root);
  if (!jobs) return undefined;
  const steps: Record<string, string> = {};
  for (const job of JSON.parse(jobs).jobs) for (const step of job.steps) steps[step.name] = step.conclusion;
  const failed = Object.values(steps).includes('failure');
  const log = failed ? run('gh', ['run', 'view', String(entry.databaseId), '--log-failed'], root) : '';
  if (log === undefined) return undefined;
  const result: CachedRun = { id: entry.databaseId, sha: entry.headSha, url: entry.url, steps, ...parseLog(log) };
  mkdirSync(cache, { recursive: true });
  writeFileSync(path, `${JSON.stringify(result)}\n`);
  return result;
}

/** Master CI's failures at or before `base` (a commit on master, usually the merge base). */
export function masterStatus(root: string, base = 'origin/master'): MasterStatus {
  if (process.env.CI) return { unavailable: 'running in CI' };
  if (!run('gh', ['--version'], root)) return { unavailable: 'gh is not installed' };
  const listed = run('gh', ['run', 'list', '--workflow', WORKFLOW, '--branch', 'master', '--limit', '100',
    '--json', 'databaseId,headSha,status,conclusion,url'], root);
  if (!listed) return { unavailable: 'gh run list failed (not signed in, or offline)' };
  const runs = (JSON.parse(listed) as { databaseId: number; headSha: string; status: string; conclusion: string; url: string }[])
    .filter(entry => entry.status === 'completed' && ['success', 'failure'].includes(entry.conclusion));
  const ancestors = (run('git', ['rev-list', '--first-parent', '-n', String(DEPTH), base], root) ?? '').split('\n').filter(Boolean);
  const cache = join(mainCheckout(root), '.build/master-ci');
  const status: { tests?: StepResult; rust?: StepResult; checks: string[] } = { checks: [] };
  for (const [behind, sha] of ancestors.entries()) {
    const entry = runs.find(candidate => candidate.headSha === sha);
    const parsed = entry && cachedRun(root, cache, entry);
    if (!parsed) continue;
    const result = (step: string, failures: string[]): StepResult | undefined => {
      const conclusion = parsed.steps[step];
      return conclusion === 'success' || conclusion === 'failure' ? { sha, url: parsed.url, behind, conclusion, failures: conclusion === 'success' ? [] : failures } : undefined;
    };
    status.tests ??= result(TEST_STEP, parsed.tests);
    if (!status.rust) {
      status.rust = result(RUST_STEP, parsed.cargo);
      if (status.rust) status.checks = parsed.checks;
    }
    if (status.tests && status.rust) break;
  }
  return status;
}

export const describeRun = (result: StepResult) =>
  `${result.sha.slice(0, 9)}${result.behind ? `, ${result.behind} master commit${result.behind > 1 ? 's' : ''} before the base` : ''}: ${result.url}`;

if (import.meta.main) {
  const root = resolve(import.meta.dir, '../..'), ref = process.argv.slice(2).find(arg => arg !== '--') ?? 'origin/master';
  const status = masterStatus(root, ref);
  if ('unavailable' in status) { console.log(`Master CI unavailable: ${status.unavailable}`); process.exit(1); }
  const show = (label: string, result: StepResult | undefined) => {
    if (!result) return console.log(`${label}: no completed run within ${DEPTH} commits of ${ref}`);
    console.log(`${label} (${describeRun(result)}): ${result.failures.length ? `${result.failures.length} failing` : result.conclusion === 'success' ? 'passing' : 'failed outside a test'}`);
    for (const failure of result.failures) console.log(`  ${failure}`);
  };
  show('bun run test', status.tests);
  show('cargo tests (multiplayer:check)', status.rust);
  const others = status.checks.filter(check => !check.startsWith('cargo test'));
  if (others.length) console.log(`Other multiplayer:check steps failing: ${others.join(', ')}`);
}
