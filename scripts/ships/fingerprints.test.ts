import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, mkdir, writeFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compileShip } from '../../src/ships/blueprint';
import { fingerprints, fileHash, validFile } from './fingerprints';
import blueprint from '../../assets/ships/fletcher/blueprint.json';
import catalog from '../../assets/parts/guns.json';

let root: string;
const definition = compileShip(blueprint, catalog);
async function put(path: string, text: string) {
  await mkdir(join(root, path, '..'), { recursive: true });
  await writeFile(join(root, path), text);
}
const get = (def = definition) => fingerprints(root, 'fletcher', def);
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'ship-fingerprints-'));
  await put('assets/ships/fletcher/build.py', 'from blender_components import mount\nmount()\n');
  await put('scripts/ships/blender_components.py', 'from blender_barrels import size\ndef mount(): return size\n');
  await put('scripts/ships/blender_barrels.py', 'size = 1\n');
  await put('scripts/ships/export.py', 'export = 1\n');
  await put('assets/ships/thumbnail.py', 'lighting = 1\n');
  await copyFile(join(import.meta.dir, 'fingerprints.py'), join(root, 'scripts/ships/fingerprints.py'));
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

test('comments, UI, type-only compiler changes and unrelated Python do not invalidate models', async () => {
  const before = await get();
  await put('scripts/ships/blender_barrels.py', '# edited comment\nsize = 1 # meters\n');
  await put('src/ships/blueprint.ts', 'interface Editor { selection: string }');
  await put('src/ui/Panel.tsx', 'export const Panel = () => null;');
  await put('scripts/ships/review.py', 'lighting = 2\n');
  expect(await get()).toEqual(before);
});
test('transitive shared geometry changes invalidate all downstream stages', async () => {
  const before = await get();
  await put('scripts/ships/blender_barrels.py', 'size = 2\n');
  const after = await get();
  for (const stage of ['geometry', 'model', 'content', 'thumbnail'] as const) expect(after[stage]).not.toBe(before[stage]);
});
test('declared appearance changes invalidate consumers, missing inputs fail closed', async () => {
  await put('assets/ships/fletcher/recipe-inputs.json', JSON.stringify({ version: 1, files: ['assets/parts/paint.json'] }));
  await put('assets/parts/paint.json', '{"roughness":0.6}');
  const before = await get();
  await put('assets/parts/paint.json', '{"roughness":0.7}');
  expect((await get()).geometry).not.toBe(before.geometry);
  await rm(join(root, 'assets/parts/paint.json'));
  await expect(get()).rejects.toThrow('Cannot fingerprint');
});
test('export and thumbnail changes stop at their stage boundaries', async () => {
  const before = await get();
  await put('scripts/ships/export.py', 'export = 2\n');
  const exported = await get();
  expect(exported.geometry).toBe(before.geometry);
  expect(exported.content).not.toBe(before.content);
  await put('assets/ships/thumbnail.py', 'lighting = 2\n');
  const thumbnail = await get();
  expect(thumbnail.content).toBe(exported.content);
  expect(thumbnail.thumbnail).not.toBe(exported.thumbnail);
});
test('runtime values refresh the definition/export; hull and equipment values regenerate geometry', async () => {
  const before = await get();
  const runtime = structuredClone(definition);
  runtime.handling.forwardSpeed += 1;
  const after = await get(runtime);
  expect(after.geometry).toBe(before.geometry);
  expect(after.content).not.toBe(before.content);
  const hull = structuredClone(definition); hull.hull.length += 1;
  expect((await get(hull)).geometry).not.toBe(before.geometry);
  const guns = structuredClone(definition); guns.mounts[0].weapon.muzzleForward += 1;
  expect((await get(guns)).geometry).not.toBe(before.geometry);
});
test('cache reuse requires bytes: deletion, corruption and absent metadata are misses', async () => {
  await put('cache/model.glb', 'complete output');
  const path = join(root, 'cache/model.glb'), digest = await fileHash(path);
  expect(await validFile(path, digest)).toBe(true);
  expect(await validFile(path)).toBe(false);
  await put('cache/model.glb', 'partial output');
  expect(await validFile(path, digest)).toBe(false);
  await rm(path);
  expect(await validFile(path, digest)).toBe(false);
});

test('library entries affect only ships fitting those variants', async () => {
  await put('assets/ships/fletcher/recipe-inputs.json', JSON.stringify({ version: 1, files: ['assets/parts/library.json'] }));
  const library = { version: 1, components: [{ partId: definition.mounts[0].partId, builder: 'fitted' }, { partId: 'unused', builder: 'unused' }],
    builders: { fitted: { path: 'assets/fitted.py', function: 'build' }, unused: { path: 'assets/unused.py', function: 'build' } } };
  await put('assets/parts/library.json', JSON.stringify(library));
  const before = await get();
  library.builders.unused.function = 'revised';
  await put('assets/parts/library.json', JSON.stringify(library));
  expect((await get()).geometry).toBe(before.geometry);
  library.builders.fitted.function = 'revised';
  await put('assets/parts/library.json', JSON.stringify(library));
  expect((await get()).geometry).not.toBe(before.geometry);
});
test('thumbnail helper imports never enter the geometry or export stage', async () => {
  await put('assets/ships/thumbnail.py', 'import lighting\n');
  await put('assets/ships/lighting.py', 'power = 1\n');
  const before = await get();
  await put('assets/ships/lighting.py', 'power = 2\n');
  const after = await get();
  expect(after.geometry).toBe(before.geometry);
  expect(after.content).toBe(before.content);
  expect(after.thumbnail).not.toBe(before.thumbnail);
});


test('declared binary textures are hashed by bytes and deletion fails closed', async () => {
  await put('assets/ships/fletcher/recipe-inputs.json', JSON.stringify({ version: 1, files: ['assets/parts/paint.png'] }));
  await mkdir(join(root, 'assets/parts'), { recursive: true });
  await writeFile(join(root, 'assets/parts/paint.png'), new Uint8Array([137, 80, 78, 71, 255]));
  const before = await get();
  await writeFile(join(root, 'assets/parts/paint.png'), new Uint8Array([137, 80, 78, 71, 254]));
  expect((await get()).geometry).not.toBe(before.geometry);
  await rm(join(root, 'assets/parts/paint.png'));
  await expect(get()).rejects.toThrow('Cannot fingerprint');
});
