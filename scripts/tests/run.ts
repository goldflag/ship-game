import { availableParallelism } from 'node:os';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const roots = ['src', 'scripts'];
const cwd = resolve(import.meta.dir, '../..');
// Scheduling hints from September 2026 warm-suite measurements, not a roster. Discovery
// below still runs every file, including new tests without an estimate.
const seconds: Record<string, number> = {
  'scripts/construction/authoring.test.ts': 20,
  'src/game/Game.test.ts': 16,
  'src/game/session/LocalBattleSession.test.ts': 11,
  'src/game/session/ReconSnapshot.test.ts': 11,
  'src/ships/customHullCompilation.test.ts': 10,
  'src/game/session/SnapshotSession.test.ts': 10,
  'src/ships/constructionGunCatalog.test.ts': 9,
  'src/ui/shipbuilding/primitiveGeometry.test.ts': 7,
  'src/ui/shipbuilding/customHullAttachment.test.ts': 7,
  'src/game/session/frameDelta.test.ts': 7,
  'src/game/ShipDetail.test.ts': 6,
  'src/ships/constructionMesh.test.ts': 6,
  'src/game/ShipBatching.test.ts': 6,
  'scripts/tests/construction-model.test.ts': 6,
  'src/game/GameFrame.test.ts': 5,
  'src/game/session/RemoteBattleSession.test.ts': 5,
  'src/ships/constructionWallFittings.test.ts': 4,
  'src/ships/inspection.test.ts': 4,
  'src/game/ShipRenderAssemblies.test.ts': 3,
  'scripts/parts/publication.test.ts': 3,
  'src/game/CombatEffects.test.ts': 3,
  'src/game/ShipPoseMatrices.test.ts': 3,
  'src/game/ShipView.test.ts': 3,
  'src/game/session/PveDraft.test.ts': 3,
};

// Keep long independent scenarios from serializing the end of a run. A final
// complementary filter always runs every other test, including renamed/new
// tests, so these are scheduling hints rather than a second test roster.
const scenarios: Record<string, [prefix: string, seconds: number][]> = {};

/** Literal prefixes form disjoint groups; the last group covers all other names. */
export function testNamePatterns(prefixes: string[]): string[] {
  const escaped = prefixes.map(prefix => prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return [...escaped.map((prefix, i) => `^${i ? `(?!(?:${escaped.slice(0, i).join('|')}))` : ''}${prefix}`),
    escaped.length ? `^(?!(?:${escaped.join('|')}))` : '^'];
}

/** A test already failing on master. `test` is the full name Bun prints after `(fail)`; `*` covers a file that
 * fails without reaching its tests. `flaky` entries may pass without being reported as fixed. */
export interface KnownFailure { file: string; test: string; since: string; note?: string; flaky?: boolean }
export const KNOWN_FAILURES = resolve(import.meta.dir, 'known-failures.json');
export const readKnownFailures = (path = KNOWN_FAILURES): KnownFailure[] => JSON.parse(readFileSync(path, 'utf8'));

/** Names from Bun's `(fail) suite > test [12.3ms]` lines. */
export function failedTests(output: string): string[] {
  return [...new Set([...output.matchAll(/^\(fail\) (.*?)(?: \[[\d.]+m?s\])?$/gm)].map(match => match[1]))];
}

const NOISE = /GLTFLoader: Couldn't load texture|^bun test v\d/;
/** A failing file's output, bounded: asserting on rendered markup or a model can otherwise print tens of kilobytes. */
export function boundedOutput(output: string, maxLines = 160, maxColumns = 400): string {
  const lines = output.split('\n').filter(line => !NOISE.test(line)).map(line => line.length > maxColumns ? `${line.slice(0, maxColumns)}… (+${line.length - maxColumns} chars)` : line);
  return lines.length > maxLines ? [...lines.slice(0, maxLines - 40), `… ${lines.length - maxLines} lines omitted; rerun this file with bun test for all of it …`, ...lines.slice(-40)].join('\n') : lines.join('\n');
}

export interface RunOptions { verbose?: boolean; known?: KnownFailure[]; record?: boolean }

/** Isolate files while limiting simultaneous CPU and model-loading work. Passing files print nothing; the exit
 * status reflects only failures that are not in the known-failures ledger. */
export async function runTestFiles(files: string[], concurrency: number, options: RunOptions = {}): Promise<number> {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('Concurrency must be a positive integer');
  const pending = files.flatMap(file => {
    const key = file.replace(/^\.\//, ''), groups = scenarios[key];
    if (!groups) return [{ file, pattern: undefined, seconds: seconds[key] ?? 1 }];
    const weights = [...groups.map(([, weight]) => weight), Math.max(1, seconds[key] - groups.reduce((sum, [, weight]) => sum + weight, 0))];
    return testNamePatterns(groups.map(([prefix]) => prefix)).map((pattern, i) => ({ file, pattern, seconds: weights[i] }));
  }).sort((a, b) => b.seconds - a.seconds || a.file.localeCompare(b.file));
  const children = new Set<ReturnType<typeof Bun.spawn>>();
  const failed = new Map<string, Set<string>>();
  const known = options.known ?? [], isKnown = (file: string, test: string) => known.some(entry => entry.file === file && (entry.test === test || entry.test === '*'));
  const interrupt = () => {
    for (const child of children) child.kill('SIGTERM');
    process.exit(130);
  };
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  const start = performance.now();
  try {
    await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, async () => {
      for (let job = pending.shift(); job; job = pending.shift()) {
        // Long fleet simulations can exceed Bun's 5 s default when test files
        // share the CPU. Retain a finite deadline without treating contention
        // as a behavioral failure.
        const child = Bun.spawn([process.execPath, '--smol', 'test', '--timeout', '30000',
          ...(job.pattern ? ['--test-name-pattern', job.pattern] : []), job.file], { cwd, stdout: 'pipe', stderr: 'pipe' });
        children.add(child);
        // Drain both pipes while running; retain each file's output together.
        const [stdout, stderr, code] = await Promise.all([
          new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
        ]);
        children.delete(child);
        const file = job.file.replace(/^\.\//, '');
        if (code !== 0) {
          const names = failedTests(stdout + stderr), tests = failed.get(file) ?? new Set<string>();
          for (const name of names.length ? names : ['*']) tests.add(name);
          failed.set(file, tests);
        }
        if (options.verbose) { process.stdout.write(stdout); process.stderr.write(stderr); }
        else if (code !== 0 && !options.record && ![...failed.get(file)!].every(test => isKnown(file, test))) console.log(`\n${file}:\n${boundedOutput(stdout + stderr)}`);
      }
    }));
  } finally {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
    for (const child of children) child.kill('SIGTERM');
  }
  const failures = [...failed].flatMap(([file, tests]) => [...tests].map(test => ({ file, test }))).sort((a, b) => a.file.localeCompare(b.file) || a.test.localeCompare(b.test));
  if (options.record) {
    const today = new Date().toISOString().slice(0, 10);
    const entries = failures.map(failure => known.find(entry => entry.file === failure.file && entry.test === failure.test) ?? { ...failure, since: today });
    writeFileSync(KNOWN_FAILURES, `${JSON.stringify(entries, null, 2)}\n`);
    console.log(`Recorded ${entries.length} known failures in scripts/tests/known-failures.json`);
    return 0;
  }
  const fresh = failures.filter(failure => !isKnown(failure.file, failure.test));
  const ran = new Set(files.map(file => file.replace(/^\.\//, '')));
  const fixed = known.filter(entry => !entry.flaky && ran.has(entry.file) && !failures.some(failure => failure.file === entry.file && (entry.test === '*' || failure.test === entry.test)));
  if (fresh.length) console.log(`\nNew failures:\n${fresh.map(failure => `  ${failure.file} > ${failure.test}`).join('\n')}`);
  if (fixed.length) console.log(`\nNo longer failing; remove from scripts/tests/known-failures.json:\n${fixed.map(entry => `  ${entry.file} > ${entry.test}`).join('\n')}`);
  console.log(`\n${files.length} test files: ${fresh.length} new failures, ${failures.length - fresh.length} known (scripts/tests/known-failures.json); ${((performance.now() - start) / 1000).toFixed(0)} s (${concurrency} workers)`);
  return fresh.length ? 1 : 0;
}

if (import.meta.main) {
  // `--verbose` prints every file's output, `--record-known` rewrites the ledger from this run, and
  // `--known` lists it. Anything else is handed to Bun, which owns filtering, watch mode and coverage.
  const own = new Set(['--verbose', '--record-known', '--known']);
  const args = process.argv.slice(2), passthrough = args.filter(arg => !own.has(arg));
  if (args.includes('--known')) {
    for (const entry of readKnownFailures()) console.log(`${entry.file} > ${entry.test}  (since ${entry.since}${entry.flaky ? ', flaky' : ''}${entry.note ? `; ${entry.note}` : ''})`);
    process.exit(0);
  }
  if (passthrough.length) {
    const child = Bun.spawn([process.execPath, 'test', ...roots, ...passthrough], {
      cwd, stdin: 'inherit', stdout: 'inherit', stderr: 'inherit',
    });
    process.exit(await child.exited);
  }
  const concurrency = Math.min(16, availableParallelism());
  const glob = new Bun.Glob('**/*.{test,spec}.{js,jsx,ts,tsx,mjs,mts,cjs,cts}');
  const files = roots.flatMap(root => [...glob.scanSync({ cwd: resolve(cwd, root) })].map(file => `./${root}/${file}`)).sort();
  if (!files.length) throw new Error('No test files found');
  process.exit(await runTestFiles(files, concurrency, { verbose: args.includes('--verbose'), record: args.includes('--record-known'), known: readKnownFailures() }));
}
