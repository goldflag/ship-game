import { availableParallelism } from 'node:os';
import { resolve } from 'node:path';

const roots = ['src', 'scripts'];
const cwd = resolve(import.meta.dir, '../..');
// Scheduling hints from full-suite measurements, not a test roster. Discovery
// below still runs every file, including new tests without an estimate.
const seconds: Record<string, number> = {
  'src/simulation/antiAircraft.test.ts': 5,
  'src/simulation/machinery.test.ts': 12,
  'src/game/ShipDetail.test.ts': 6,
  'src/simulation/stability.test.ts': 5,
  'src/simulation/aircraft.test.ts': 7,
  'src/simulation/aiLevels.test.ts': 8,
  'src/simulation/combat.test.ts': 7,
  'src/simulation/bots.test.ts': 6,
  'src/simulation/battle.test.ts': 15,
  'src/simulation/airOperations.test.ts': 8,
  'src/simulation/submarine.test.ts': 15,
  'src/game/CombatEffects.test.ts': 6,
  'src/simulation/sinking.test.ts': 7,
  'src/ships/inspection.test.ts': 6,
  'src/simulation/aircraftAccuracy.test.ts': 10,
  'src/simulation/damageControl.test.ts': 4,
  'src/simulation/sea.test.ts': 9,
  'src/game/GameFrame.test.ts': 6,
  'src/game/ShipBatching.test.ts': 5,
  'src/simulation/shokaku.test.ts': 4,
  'src/simulation/weaponGroups.test.ts': 4,
  'src/game/ShipPoseMatrices.test.ts': 3,
  'src/game/ShipRenderAssemblies.test.ts': 3,
  'src/game/Game.test.ts': 5,
  'src/game/session/localSnapshotDelta.test.ts': 5,
  'src/game/session/SnapshotSession.test.ts': 3,
  'src/simulation/aircraftFlight.test.ts': 4,
  'src/simulation/collisions.test.ts': 3,
  'src/game/ShipView.test.ts': 3,
  'src/simulation/convoy.test.ts': 3,
};

// Keep long independent scenarios from serializing the end of a run. A final
// complementary filter always runs every other test, including renamed/new
// tests, so these are scheduling hints rather than a second test roster.
const scenarios: Record<string, [prefix: string, seconds: number][]> = {
  'src/simulation/machinery.test.ts': [['Yamato wing', 6]],
  'src/simulation/stability.test.ts': [['asymmetric water', 2], ['yamato:', 1]],
  'src/simulation/submarine.test.ts': [['ballast takes', 5], ['submerged guns', 4], ['combat submarine bots', 2]],
  'src/simulation/battle.test.ts': [['every bot maneuvers', 9], ['bot combat produces', 3]],
  'src/simulation/aircraftAccuracy.test.ts': [['vb-6 ', 4], ['vt-6 ', 4]],
};

/** Literal prefixes form disjoint groups; the last group covers all other names. */
export function testNamePatterns(prefixes: string[]): string[] {
  const escaped = prefixes.map(prefix => prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return [...escaped.map((prefix, i) => `^${i ? `(?!(?:${escaped.slice(0, i).join('|')}))` : ''}${prefix}`),
    escaped.length ? `^(?!(?:${escaped.join('|')}))` : '^'];
}

/** Isolate files while limiting simultaneous CPU and model-loading work. */
export async function runTestFiles(files: string[], concurrency: number): Promise<number> {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('Concurrency must be a positive integer');
  const pending = files.flatMap(file => {
    const key = file.replace(/^\.\//, ''), groups = scenarios[key];
    if (!groups) return [{ file, pattern: undefined, seconds: seconds[key] ?? 1 }];
    const weights = [...groups.map(([, weight]) => weight), Math.max(1, seconds[key] - groups.reduce((sum, [, weight]) => sum + weight, 0))];
    return testNamePatterns(groups.map(([prefix]) => prefix)).map((pattern, i) => ({ file, pattern, seconds: weights[i] }));
  }).sort((a, b) => b.seconds - a.seconds || a.file.localeCompare(b.file));
  const children = new Set<ReturnType<typeof Bun.spawn>>();
  const failures = new Set<string>();
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
        if (code !== 0) failures.add(job.file);
        process.stdout.write(stdout);
        process.stderr.write(stderr);
      }
    }));
  } finally {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
    for (const child of children) child.kill('SIGTERM');
  }
  console.log(`\n${files.length} test files, ${failures.size} failed; ${(performance.now() - start).toFixed(0)} ms (${concurrency} workers)`);
  return failures.size ? 1 : 0;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.length) {
    // Let Bun own filtering, watch mode, coverage and other native options.
    const child = Bun.spawn([process.execPath, 'test', ...roots, ...args], {
      cwd, stdin: 'inherit', stdout: 'inherit', stderr: 'inherit',
    });
    process.exit(await child.exited);
  }
  const concurrency = Math.min(16, availableParallelism());
  const glob = new Bun.Glob('**/*.{test,spec}.{js,jsx,ts,tsx,mjs,mts,cjs,cts}');
  const files = roots.flatMap(root => [...glob.scanSync({ cwd: resolve(cwd, root) })].map(file => `./${root}/${file}`)).sort();
  if (!files.length) throw new Error('No test files found');
  process.exit(await runTestFiles(files, concurrency));
}
