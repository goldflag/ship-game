import { availableParallelism } from 'node:os';
import { resolve } from 'node:path';

const roots = ['src', 'scripts'];
const cwd = resolve(import.meta.dir, '../..');
// Scheduling hints from full-suite measurements, not a test roster. Discovery
// below still runs every file, including new tests without an estimate.
const seconds: Record<string, number> = {
  'src/simulation/machinery.test.ts': 13,
  'src/game/ShipDetail.test.ts': 10,
  'src/simulation/stability.test.ts': 9,
  'src/simulation/aircraft.test.ts': 9,
  'src/simulation/aiLevels.test.ts': 9,
  'src/simulation/combat.test.ts': 9,
  'src/simulation/bots.test.ts': 9,
  'src/simulation/battle.test.ts': 9,
  'src/simulation/airOperations.test.ts': 6,
  'src/simulation/submarine.test.ts': 6,
  'src/game/CombatEffects.test.ts': 6,
  'src/simulation/sinking.test.ts': 5,
  'src/ships/inspection.test.ts': 5,
  'src/simulation/aircraftAccuracy.test.ts': 5,
  'src/simulation/damageControl.test.ts': 4,
};

/** Isolate files while limiting simultaneous CPU and model-loading work. */
export async function runTestFiles(files: string[], concurrency: number): Promise<number> {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('Concurrency must be a positive integer');
  const pending = [...files].sort((a, b) =>
    (seconds[b.replace(/^\.\//, '')] ?? 1) - (seconds[a.replace(/^\.\//, '')] ?? 1) || a.localeCompare(b));
  const children = new Set<ReturnType<typeof Bun.spawn>>();
  let failures = 0;
  const interrupt = () => {
    for (const child of children) child.kill('SIGTERM');
    process.exit(130);
  };
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  const start = performance.now();
  try {
    await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, async () => {
      for (let file = pending.shift(); file; file = pending.shift()) {
        const child = Bun.spawn([process.execPath, 'test', file], { cwd, stdout: 'pipe', stderr: 'pipe' });
        children.add(child);
        // Drain both pipes while running; retain each file's output together.
        const [stdout, stderr, code] = await Promise.all([
          new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
        ]);
        children.delete(child);
        if (code !== 0) failures++;
        process.stdout.write(stdout);
        process.stderr.write(stderr);
      }
    }));
  } finally {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
    for (const child of children) child.kill('SIGTERM');
  }
  console.log(`\n${files.length} test files, ${failures} failed; ${(performance.now() - start).toFixed(0)} ms (${concurrency} workers)`);
  return failures ? 1 : 0;
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
  const concurrency = Math.min(8, availableParallelism());
  const glob = new Bun.Glob('**/*.{test,spec}.{js,jsx,ts,tsx,mjs,mts,cjs,cts}');
  const files = roots.flatMap(root => [...glob.scanSync({ cwd: resolve(cwd, root) })].map(file => `./${root}/${file}`)).sort();
  if (!files.length) throw new Error('No test files found');
  process.exit(await runTestFiles(files, concurrency));
}
