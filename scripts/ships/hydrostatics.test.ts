import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, rm, writeFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { refreshHydrostatics } from './hydrostatics';
import { refreshRuntime } from './refresh';

const repo = resolve(import.meta.dir, '../..');

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
    expect(ships.gleaves).toEqual(committed.gleaves);
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
