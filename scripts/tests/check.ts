/** `bun run check`: the cheap loop while iterating. Typechecks incrementally, then runs only the tests a change can
 * plausibly affect, against the known-failures ledger and master's CI (a failure master's latest completed run at or
 * before the merge base also has is reported, not counted). `bun run build` remains the gate before a PR. `--all` runs every
 * test; `--base <ref>` changes the comparison point (default origin/master). */
import { existsSync, readFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { resolve } from 'node:path';
import { requireBootstrapped } from '../build/ready';
import { affectedTests, testFiles } from './affected';
import { masterBaseline, readKnownFailures, runTestFiles } from './run';

const cwd = resolve(import.meta.dir, '../..'), args = process.argv.slice(2);
requireBootstrapped(cwd);
const git = (...command: string[]) => Bun.spawnSync(['git', ...command], { cwd }).stdout.toString().split('\n').filter(Boolean);
const baseRef = args.includes('--base') ? args[args.indexOf('--base') + 1] : 'origin/master';
const base = git('merge-base', 'HEAD', baseRef)[0] ?? 'HEAD';
const touched = [...new Set([...git('diff', '--name-only', base), ...git('ls-files', '--others', '--exclude-standard')])];
const changed = touched.filter(file => existsSync(resolve(cwd, file)));

/** Quiet unless it fails, except that a WASM rebuild or replacement is announced as it starts: it can take minutes. */
const quiet = async (label: string, command: string[]) => {
  const started = performance.now(), child = Bun.spawn(command, { cwd, stdout: 'pipe', stderr: 'pipe' });
  const announce = async (stream: ReadableStream<Uint8Array>) => {
    let text = '';
    for await (const chunk of stream.pipeThrough(new TextDecoderStream())) {
      const lines = (text.slice(text.lastIndexOf('\n') + 1) + chunk).split('\n').slice(0, -1);
      for (const line of lines) if (/^(Rebuilding|Building|Replacing) /.test(line)) console.log(`${label}: ${line}`);
      text += chunk;
    }
    return text;
  };
  const [stdout, stderr, code] = await Promise.all([announce(child.stdout), new Response(child.stderr).text(), child.exited]);
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  if (code === 0) { console.log(`${label}: ok (${seconds} s)`); return true; }
  console.log(`${label}: FAILED (${seconds} s)\n${(stdout + stderr).split('\n').slice(0, 80).join('\n')}`);
  return false;
};

let ok = await quiet('Simulation content and dev WASM', [process.execPath, 'run', 'multiplayer:prepare:dev']);
// Each project keeps its own incremental state under ignored .build/, so a warm typecheck is a few seconds. The local
// binary, never bunx: in a worktree without node_modules bunx installs packages and rewrites bun.lock.
const projects: [label: string, config: string, applies: boolean][] = [
  ['Typecheck src', 'tsconfig.json', true],
  ['Typecheck construction, browser and harness scripts', 'tsconfig.construction.json', changed.some(file =>
    /^(scripts\/(construction|browser|diagnostics)|tools\/construction)\//.test(file) || /^scripts\/ships\/(overlay|sweep\w*|floating)\.ts$/.test(file))],
  ['Typecheck model viewer', 'tsconfig.overlay.json', changed.some(file => /^(tools\/ship-overlay|scripts\/parts)\//.test(file))],
  ['Typecheck services', 'services/tsconfig.json', changed.some(file => file.startsWith('services/'))],
];
const tsc = resolve(cwd, 'node_modules/.bin/tsc');
for (const [label, config, applies] of projects) if (applies) ok = await quiet(label, [tsc, '--project', config, '--noEmit', '--incremental', '--tsBuildInfoFile', `.build/tsc/${config.replace(/\W+/g, '-')}.tsbuildinfo`]) && ok;

/** A package.json change confined to "scripts" adds or edits a command, which no test imports: it selects no tests. */
const scriptsOnly = (file: string) => {
  if (file !== 'package.json') return false;
  try {
    const { scripts: _before, ...before } = JSON.parse(Bun.spawnSync(['git', 'show', `${base}:package.json`], { cwd }).stdout.toString());
    const { scripts: _after, ...after } = JSON.parse(readFileSync(resolve(cwd, file), 'utf8'));
    return JSON.stringify(before) === JSON.stringify(after);
  } catch { return false; }
};
const tests = testFiles(cwd), { everything, reasons } = affectedTests(cwd, touched.filter(file => !scriptsOnly(file)), tests);
const shared = args.includes('--all') ? '--all' : everything && `${everything} changed`;
const affected = shared ? tests : [...reasons.keys()], SHOWN = 40;
const selection = shared ? `running every test (${shared})` : `${affected.length} of ${tests.length} test files affected`;
console.log(`${touched.length} changed files since ${baseRef}; ${selection}${!shared && affected.length ? ':' : ''}`);
for (const test of shared ? [] : affected.slice(0, SHOWN)) console.log(`  ${test}: ${reasons.get(test)}`);
if (!shared && affected.length > SHOWN) console.log(`  … and ${affected.length - SHOWN} more`);
if (affected.length) ok = (await runTestFiles(affected.map(file => `./${file}`), Math.min(16, availableParallelism()), { known: readKnownFailures(), baseline: masterBaseline(cwd, base) })) === 0 && ok;
if (touched.some(file => file.startsWith('crates/'))) console.log('Rust changed: run the affected crate tests too (see crates/README.md); bun run master:red lists the cargo tests master CI already fails.');
process.exit(ok ? 0 : 1);
