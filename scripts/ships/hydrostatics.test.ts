import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, rm, writeFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { refreshHydrostatics } from './hydrostatics';
import { refreshRuntime } from './refresh';

const repo = resolve(import.meta.dir, '../..');

const nodes = (text: string) => new Float32Array(Uint8Array.from(atob(text), c => c.charCodeAt(0)).buffer);
/** The same solve, to float32 rounding. The committed table may come from another platform: libm sin and cos
 * round differently on macOS and Linux, which moves about 2% of the nodes by one float32 unit, so compare
 * values, not bytes. */
function expectSameSolve(solved: { nodes: string; fullVolume: number; fullCenter: number[] }, committed: typeof solved) {
  const { nodes: a, fullVolume: av, fullCenter: ac, ...rest } = solved, { nodes: b, fullVolume: bv, fullCenter: bc, ...expected } = committed;
  expect(rest).toEqual(expected);
  expect(Math.abs(av - bv)).toBeLessThanOrEqual(1e-9 * bv);
  ac.forEach((v, i) => expect(Math.abs(v - bc[i])).toBeLessThanOrEqual(1e-9));
  const [x, y] = [nodes(a), nodes(b)];
  expect(x.length).toBe(y.length);
  let worst = 0;
  for (let i = 0; i < x.length; i++) worst = Math.max(worst, Math.abs(x[i] - y[i]) / Math.max(Math.abs(y[i]), 1));
  expect(worst).toBeLessThan(1e-6);
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'hydrostatics-'));
  await mkdir(join(root, 'src/ships'), { recursive: true });
  await mkdir(join(root, 'public/models'), { recursive: true });
  await mkdir(join(root, 'assets/gameplay'), { recursive: true });
  await writeFile(join(root, 'src/ships/presets.ts'), "export const shipPresets = {\n  'gleaves': preset('gleaves'),\n  fubuki: preset('fubuki'),\n};\n");
  for (const id of ['gleaves', 'fubuki']) await copyFile(join(repo, 'public/models', id + '.json'), join(root, 'public/models', id + '.json'));
  const committed = JSON.parse(await readFile(join(repo, 'assets/gameplay/hydrostatics.v1.json'), 'utf8')).ships;
  await writeFile(join(root, 'assets/gameplay/hydrostatics.v1.json'), JSON.stringify({ version: 1, ships: {
    retired: committed.fubuki, fubuki: committed.fubuki, gleaves: { ...committed.gleaves, contentHash: 'stale', nodes: '' },
  } }) + '\n');
  return { root, committed };
}

test('one ship re-solves its stale table and keeps the others in roster order', async () => {
  const { root, committed } = await fixture();
  const path = join(root, 'assets/gameplay/hydrostatics.v1.json');
  try {
    expect(await refreshHydrostatics(root, ['gleaves'], () => {})).toEqual(['gleaves']);
    const written = await readFile(path, 'utf8');
    const { ships } = JSON.parse(written);
    expect(Object.keys(ships)).toEqual(['gleaves', 'fubuki']);
    expectSameSolve(ships.gleaves, committed.gleaves);
    expect(ships.fubuki).toEqual(committed.fubuki);
    expect(await refreshHydrostatics(root, ['gleaves'], () => {})).toEqual([]);
    expect(await readFile(path, 'utf8')).toBe(written);
    await expect(refreshHydrostatics(root, ['iowa'], () => {})).rejects.toThrow('Not in src/ships/presets.ts: iowa');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a build of an unregistered ship skips the refresh and says what to run', async () => {
  const { root } = await fixture();
  const lines: string[] = [];
  await refreshRuntime(root, ['draft'], line => lines.push(line)).finally(() => rm(root, { recursive: true, force: true }));
  expect(lines).toEqual(['Not in src/ships/presets.ts: draft. After registering, run bun run ship:hydrostatics draft and bun run multiplayer:content.']);
});
