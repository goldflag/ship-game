/** Master-against-branch A/B for browser diagnostics.
 *
 * `prepareBaseline('origin/master')` checks the ref out as a detached worktree under `.build/baseline/<sha>` and bootstraps it
 * (seconds, with the shared WASM cache), so its `src/generated`, `public/models`, simulation content and dev WASM are the ref's
 * own; half-copied trees fail in ways that look like the code (the port never loads, "Battle setup requires an idle, loaded
 * port"). `diagnosticTargets` serves it and this checkout each on their own port, without hot reloads. Measurements then
 * alternate between the two, A B A B A B (`interleave`), and are compared by median (`compareSamples`): GPU timings of
 * identical code differ by a quarter from one run to the next (8.8 against 11.3 ms), so one run of each proves nothing. */
import type { Server } from 'node:http';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { ViteDevServer } from 'vite';
import { authoringServer, serverUrl } from '../construction/browser';
import { ROOT } from './harness';

export interface Baseline { ref: string; sha: string; root: string }
export interface Target { label: 'baseline' | 'branch'; /** What it is: `origin/master 1a2b3c4d5e6f`, or this checkout's branch. */ name: string; root: string; url: string }

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** Where the baseline worktree for `sha` lives in the checkout at `root`: one per commit, reused across runs. */
export const baselineDir = (root: string, sha: string) => join(root, '.build/baseline', sha.slice(0, 12));

/** A bootstrapped detached worktree of `ref` under `.build/baseline/`, created on first use and reused while the ref stays on
 * the same commit. Remove one with `git worktree remove --force .build/baseline/<sha>`. */
export function prepareBaseline(ref: string, options: { root?: string; log?: (line: string) => void } = {}): Baseline {
  const root = options.root ?? ROOT, log = options.log ?? ((line: string) => console.error(line));
  let sha: string;
  try { sha = git(root, 'rev-parse', '--verify', `${ref}^{commit}`); } catch { throw new Error(`--baseline ${ref}: not a commit in this repository (fetch first?).`); }
  const dir = baselineDir(root, sha), started = performance.now();
  if (!existsSync(join(dir, '.git'))) {
    mkdirSync(join(root, '.build/baseline'), { recursive: true });
    git(root, 'worktree', 'prune');
    log(`baseline: adding a worktree of ${ref} (${sha.slice(0, 12)}) at ${relative(root, dir)}`);
    git(root, 'worktree', 'add', '--detach', dir, sha);
  } else if (git(dir, 'rev-parse', 'HEAD') !== sha) throw new Error(`${relative(root, dir)} is not at ${sha}; remove it with git worktree remove --force ${relative(root, dir)}`);
  // Bootstrap is idempotent and fast when current; it installs, prepares content and the dev WASM, and copies .env.local.
  const result = spawnSync(process.execPath, ['run', 'bootstrap'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const logFile = `${dir}.bootstrap.log`;
  writeFileSync(logFile, `${result.stdout}\n${result.stderr}`);
  if (result.status !== 0) throw new Error(`baseline: bootstrap of ${ref} failed; see ${relative(root, logFile)}:\n${`${result.stdout}\n${result.stderr}`.trim().split('\n').slice(-15).join('\n')}`);
  log(`baseline: ${ref} at ${sha.slice(0, 12)} ready in ${((performance.now() - started) / 1000).toFixed(1)} s`);
  return { ref, sha, root: dir };
}

/** This checkout's branch and commit, marked when it has uncommitted changes (the runs serve the working tree). */
export function describeCheckout(root = ROOT): string {
  const branch = git(root, 'branch', '--show-current') || 'detached', sha = git(root, 'rev-parse', 'HEAD').slice(0, 12);
  const dirty = git(root, 'status', '--porcelain', '--untracked-files=no').length > 0;
  return `${branch} ${sha}${dirty ? ' + uncommitted changes' : ''}`;
}

/** The pages a diagnostics script drives: this checkout (served on a free port, or at `url`), and with `baseline` a
 * worktree of that ref on another port, baseline first. Neither server reloads a page when a source changes. */
export async function diagnosticTargets(options: { baseline?: string; url?: string; log?: (line: string) => void } = {}): Promise<{ targets: Target[]; close(): Promise<void> }> {
  const servers: ViteDevServer[] = [], targets: Target[] = [];
  const close = async () => { for (const server of servers) { (server.httpServer as Server | null)?.closeAllConnections(); await server.close().catch(() => undefined); } };
  try {
    if (options.baseline) {
      const baseline = prepareBaseline(options.baseline, { log: options.log });
      const server = await authoringServer(baseline.root, 0, true); servers.push(server);
      targets.push({ label: 'baseline', name: `${baseline.ref} ${baseline.sha.slice(0, 12)}`, root: baseline.root, url: serverUrl(server) });
    }
    let url = options.url?.replace(/\/$/, '');
    if (!url) { const server = await authoringServer(ROOT, 0, true); servers.push(server); url = serverUrl(server); }
    targets.push({ label: 'branch', name: describeCheckout(), root: ROOT, url });
    return { targets, close };
  } catch (error) { await close(); throw error; }
}

/** `rounds` passes over `targets` in order: A B A B A B for two. A drift in machine load then falls on both sides alike. */
export function interleave<T>(targets: readonly T[], rounds: number): { round: number; target: T }[] {
  return Array.from({ length: Math.max(0, rounds) }, (_, round) => targets.map(target => ({ round, target }))).flat();
}

export function median(values: readonly number[]): number {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b), middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export interface Comparison { baseline: number; branch: number; delta: number; percent: number; baselineRuns: number[]; branchRuns: number[] }

/** Medians of each side's runs and the branch's difference from the baseline. */
export function compareSamples(baselineRuns: readonly number[], branchRuns: readonly number[]): Comparison {
  const baseline = median(baselineRuns), branch = median(branchRuns), delta = branch - baseline;
  return { baseline, branch, delta, percent: baseline ? delta / baseline * 100 : NaN, baselineRuns: [...baselineRuns], branchRuns: [...branchRuns] };
}

/** A fixed-width table: one row per measurement, baseline and branch medians with every run in brackets, and the change. */
export function comparisonTable(rows: readonly { label: string; comparison: Comparison }[], unit = 'ms', digits = 2): string {
  const f = (value: number) => Number.isFinite(value) ? value.toFixed(digits) : '-';
  const runs = (values: number[]) => `[${values.map(f).join(' ')}]`;
  const cells = rows.map(({ label, comparison: c }) => [label, `${f(c.baseline)} ${runs(c.baselineRuns)}`, `${f(c.branch)} ${runs(c.branchRuns)}`,
    `${c.delta >= 0 ? '+' : ''}${f(c.delta)} ${unit} (${c.percent >= 0 ? '+' : ''}${Number.isFinite(c.percent) ? c.percent.toFixed(1) : '-'}%)`]);
  const header = ['measurement', `baseline median ${unit} [runs]`, `branch median ${unit} [runs]`, 'branch - baseline'];
  const widths = header.map((title, column) => Math.max(title.length, ...cells.map(row => row[column].length)));
  return [header, ...cells].map(row => row.map((cell, column) => cell.padEnd(widths[column])).join('  ').trimEnd()).join('\n');
}
