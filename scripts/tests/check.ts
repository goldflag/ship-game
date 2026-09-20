/** `bun run check`: the cheap loop while iterating. Typechecks incrementally, then runs only the tests
 * a change can plausibly affect, against the known-failures ledger. `bun run build` remains the gate
 * before a PR. `--all` runs every test; `--base <ref>` changes the comparison point (default origin/master). */
import { existsSync, readFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import { readKnownFailures, runTestFiles } from './run';

const cwd = resolve(import.meta.dir, '../..'), args = process.argv.slice(2);
const git = (...command: string[]) => Bun.spawnSync(['git', ...command], { cwd }).stdout.toString().split('\n').filter(Boolean);
const baseRef = args.includes('--base') ? args[args.indexOf('--base') + 1] : 'origin/master';
const base = git('merge-base', 'HEAD', baseRef)[0] ?? 'HEAD';
const changed = [...new Set([...git('diff', '--name-only', base), ...git('ls-files', '--others', '--exclude-standard')])].filter(file => existsSync(resolve(cwd, file)));

const quiet = (label: string, command: string[]) => {
  const started = performance.now(), result = Bun.spawnSync(command, { cwd, stdout: 'pipe', stderr: 'pipe' });
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  if (result.exitCode === 0) { console.log(`${label}: ok (${seconds} s)`); return true; }
  console.log(`${label}: FAILED (${seconds} s)\n${(result.stdout.toString() + result.stderr.toString()).split('\n').slice(0, 80).join('\n')}`);
  return false;
};

let ok = quiet('Simulation content and dev WASM', [process.execPath, 'run', 'multiplayer:prepare:dev']);
// Each project keeps its own incremental state under ignored .build/, so a warm typecheck is a few seconds.
const projects: [label: string, config: string, applies: boolean][] = [
  ['Typecheck src', 'tsconfig.json', true],
  ['Typecheck construction, browser and harness scripts', 'tsconfig.construction.json', changed.some(file => /^(scripts\/(construction|browser|diagnostics)|tools\/construction)\//.test(file))],
  ['Typecheck model viewer', 'tsconfig.overlay.json', changed.some(file => /^(tools\/ship-overlay|scripts\/parts)\//.test(file))],
  ['Typecheck services', 'services/tsconfig.json', changed.some(file => file.startsWith('services/'))],
];
for (const [label, config, applies] of projects) if (applies) ok = quiet(label, ['bunx', 'tsc', '--project', config, '--noEmit', '--incremental', '--tsBuildInfoFile', `.build/tsc/${config.replace(/\W+/g, '-')}.tsbuildinfo`]) && ok;

const glob = new Bun.Glob('**/*.{test,spec}.{js,jsx,ts,tsx,mjs,mts,cjs,cts}');
const tests = ['src', 'scripts'].flatMap(root => [...glob.scanSync({ cwd: resolve(cwd, root) })].map(file => `${root}/${file}`)).sort();
// Shared roots reach every test; so does the simulation, which the client tests run as WASM.
const everything = args.includes('--all') || changed.some(file => /^(package\.json|bun\.lock|tsconfig.*\.json|vite\.config\.ts|scripts\/tests\/run\.ts|Cargo\.(toml|lock)|crates\/)/.test(file));
const sources = changed.filter(file => /\.(tsx?|mjs|js|css|json)$/.test(file) && /^(src|scripts)\//.test(file));
const affected = everything ? tests : tests.filter(test => {
  if (changed.includes(test)) return true;
  const text = readFileSync(resolve(cwd, test), 'utf8');
  // A test is affected by a changed module it names in an import, or that sits beside it under the same stem.
  return sources.some(file => {
    const stem = basename(file).replace(/\.(tsx?|mjs|js|css|json)$/, '');
    return (dirname(file) === dirname(test) && basename(test).startsWith(`${stem}.`)) || new RegExp(`from ['"][^'"]*/${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\.\\w+)?['"]`).test(text);
  });
});
console.log(`${changed.length} changed files since ${baseRef}; ${everything ? 'running every test' : `${affected.length} of ${tests.length} test files affected`}`);
if (affected.length) ok = (await runTestFiles(affected.map(file => `./${file}`), Math.min(16, availableParallelism()), { known: readKnownFailures() })) === 0 && ok;
if (changed.some(file => file.startsWith('crates/'))) console.log('Rust changed: run the affected crate tests too (see crates/README.md).');
process.exit(ok ? 0 : 1);
