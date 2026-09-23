import { availableParallelism, cpus, totalmem, platform, arch } from 'node:os';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { shipPresets } from '../../src/ships/presets';

/** The runtime roster also owns fleet validation; adding a preset needs no build-script edit. */
export async function runFleet(action: string): Promise<number> {
  const failed: string[] = [];
  const started = performance.now();
  const queue = Object.keys(shipPresets);
  const concurrency = Number(process.env.SHIP_JOBS ?? (action === 'build' ? Math.min(18, availableParallelism(), Math.max(1, Math.floor((totalmem() - 4 * 1024 ** 3) / (2 * 1024 ** 3)))) : 1));
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 18) throw new Error('SHIP_JOBS must be an integer from 1 to 18');
  console.log(`Fleet ${action}: jobs=${concurrency}, force=${process.argv.includes('--force')}`);
  await Promise.all(Array.from({ length: concurrency }, async () => {
  while (queue.length) {
    const id = queue.shift()!;
    const child = Bun.spawn([process.execPath, `${import.meta.dir}/pipeline.ts`, action, id, ...process.argv.slice(4)], {
      stdout: 'pipe', stderr: 'pipe',
    });
    const [out, err, code] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    if (code) {
      failed.push(id);
      // A failed check prints its reason (Bun's `error:` line, or the construction pipeline's JSON) rather than a stack.
      const reason = action === 'check' ? (out + err).match(/^error: (.*)$/m)?.[1] ?? (out + err).match(/^\{"error":(".*")\}$/m)?.[1] : undefined;
      if (reason) console.error(`${id}: check failed: ${reason.startsWith('"') ? JSON.parse(reason) : reason} (bun run ship:check ${id} shows the rest)`);
      else console.error(`${id}: ${action} failed\n${out}${err}`);
    } else console.log(`${id}: ${action} passed`);
  }
  }));
  const seconds = (performance.now() - started) / 1000;
  if (process.env.SHIP_TIMINGS_DIR) {
    const root = resolve(import.meta.dir, '../..'), directory = resolve(root, process.env.SHIP_TIMINGS_DIR);
    if (!directory.startsWith(join(root, '.build') + '/')) throw new Error('SHIP_TIMINGS_DIR must be below .build/');
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'fleet.json'), JSON.stringify({ action, seconds, concurrency,
      force: process.argv.includes('--force'), failed, cpu: cpus()[0]?.model, logicalCpus: availableParallelism(), memoryBytes: totalmem(), platform: platform(), arch: arch() }, null, 2) + '\n');
  }
  console.log(`Fleet ${action}: ${seconds.toFixed(3)} seconds`);
  if (failed.length) console.error(`Failed ships: ${failed.join(', ')}`);
  return failed.length ? 1 : 0;
}
