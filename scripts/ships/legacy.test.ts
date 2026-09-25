import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { compileShip } from '../../src/ships/blueprint';
import { funnelReport, isLegacyShip, scaffoldLegacyShip } from './legacy';

const root = resolve(import.meta.dir, '../..');

test('a scaffolded Blender-recipe preset compiles, is recognised and smokes from its funnel', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'legacy-scaffold-'));
  try {
    await mkdir(join(temp, 'assets/ships'), { recursive: true });
    await symlink(join(root, 'assets/parts'), join(temp, 'assets/parts'));
    const result = await scaffoldLegacyShip(temp, 'starter-cruiser', 'Starter Cruiser', 'us-6in47-mk16-cleveland');
    expect(result.files).toContain('blueprint.json');
    const dir = join(temp, 'assets/ships/starter-cruiser');
    const inputs = JSON.parse(await readFile(join(dir, 'recipe-inputs.json'), 'utf8'));
    expect(inputs.files).toContain('assets/parts/us-6in47-mk16/geometry.py');
    expect(inputs.files).toContain('assets/ships/starter-cruiser/appearance.json');
    expect(await readFile(join(dir, 'README.md'), 'utf8')).toContain('## Approved brief');
    expect(await readFile(join(dir, 'build.py'), 'utf8')).not.toContain('__SHIP_');

    const blueprint = JSON.parse(await readFile(join(dir, 'blueprint.json'), 'utf8'));
    const definition = compileShip(blueprint, JSON.parse(await readFile(join(root, 'assets/parts/guns.json'), 'utf8')));
    expect(definition.id).toBe('starter-cruiser');
    expect(definition.mounts.map((m) => m.partId)).toEqual(['us-6in47-mk16-cleveland', 'us-6in47-mk16-cleveland']);
    expect(await isLegacyShip(temp, 'starter-cruiser')).toBe(true);

    await mkdir(join(temp, 'public/models'), { recursive: true });
    await writeFile(join(temp, 'public/models/starter-cruiser.json'), JSON.stringify(definition));
    expect(await funnelReport(temp, 'starter-cruiser')).toEqual({ funnels: 1 });
    await writeFile(join(temp, 'public/models/starter-cruiser.json'), JSON.stringify({ ...definition, structures: [] }));
    expect(await funnelReport(temp, 'starter-cruiser')).toMatchObject({ funnels: 0, funnelWarning: expect.stringContaining('No funnel smoke') });
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}, 30_000);

test('scaffolding refuses an unbuildable part or a quoted name before writing anything', async () => {
  await expect(scaffoldLegacyShip(root, 'never-written', 'Name', 'no-such-part')).rejects.toThrow('Unknown or preview-only gun part');
  await expect(scaffoldLegacyShip(root, 'never-written', "Ship's", 'us-6in47-mk16-cleveland')).rejects.toThrow('without quotes');
  expect(await isLegacyShip(root, 'never-written')).toBe(false);
  expect(await isLegacyShip(root, 'alaska')).toBe(true);
  expect(await isLegacyShip(root, 'valiant')).toBe(false);
});
