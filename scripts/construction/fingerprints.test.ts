import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { constructionFingerprints, recipeHash } from './fingerprints';
import type { ConstructionResult, ConstructionSource } from '../../src/ships/blueprint';
let root: string;
const put = async (path: string, text: string) => { await mkdir(join(root, path, '..'), { recursive: true }); await writeFile(join(root, path), text); };
const source = { id: 'test', revision: 'one', construction: { equipment: [] } } as unknown as ConstructionSource;
const result = { contentHash: 'native-a', surfaces: [], definition: { id: 'local-test-a', contentHash: 'native-a', name: 'Test', mounts: [] } } as unknown as ConstructionResult;
const get = (compiled = result) => constructionFingerprints(root, source, compiled);
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'construction-fingerprints-'));
  await put('package.json', '{"dependencies":{"three":"0.185.0"}}');
  await put('src/game/constructionModel.ts', "import { size } from './helper'; export const model = () => size;");
  await put('src/game/helper.ts', 'export const size: number = 1;');
  await put('src/game/ShipView.ts', 'export const pose = 0;');
  await put('tools/construction/export.ts', 'export const exporter = 1;');
  await put('tools/construction/pose.ts', 'export const neutral = 0;');
  await put('tools/construction/presentation.ts', 'export const light = 1;');
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
test('unrelated Rust/build identity, comments, type-only edits and orchestration do not invalidate assets', async () => {
  const before = await get();
  await put('crates/naval-sim/src/unrelated.rs', '// another simulation build');
  await put('scripts/construction/pipeline.ts', 'export const orchestration = 2;');
  await put('tools/construction/review.ts', 'export const diagnostics = 2;');
  await put('src/game/helper.ts', '// size in meters\ninterface Tool { editorOnly: string }\nexport const size: number = 1;');
  const native = structuredClone(result); native.contentHash = 'native-b'; native.definition!.contentHash = 'native-b'; native.definition!.id = 'local-test-b';
  expect(await get(native)).toEqual(before);
});
test('presentation edits invalidate only images; export and transitive geometry edits invalidate the model', async () => {
  const before = await get();
  await put('tools/construction/presentation.ts', 'export const light = 2;');
  const presentation = await get();
  expect(presentation.definition).toBe(before.definition); expect(presentation.model).toBe(before.model); expect(presentation.presentation).not.toBe(before.presentation);
  await put('src/game/helper.ts', 'export const size = 2;');
  const geometry = await get(); expect(geometry.model).not.toBe(presentation.model); expect(geometry.definition).toBe(before.definition);
  await put('tools/construction/export.ts', 'export const exporter = 2;');
  expect((await get()).model).not.toBe(geometry.model);
});
test('native geometry and gameplay outputs invalidate the appropriate stage even with the same source', async () => {
  const before = await get();
  const simulation = structuredClone(result); simulation.definition!.name = 'Different';
  expect((await get(simulation)).definition).not.toBe(before.definition);
  expect((await get(simulation)).model).toBe(before.model);
  const geometry = structuredClone(result); geometry.propellerSupports = [{ equipmentId: 'screw', members: [] }];
  expect((await get(geometry)).model).not.toBe(before.model);
});
test('missing transitive inputs fail closed and key/file order remains stable', async () => {
  const before = await recipeHash(root, ['src/game/ShipView.ts', 'src/game/constructionModel.ts']);
  expect(await recipeHash(root, ['src/game/constructionModel.ts', 'src/game/ShipView.ts'])).toBe(before);
  await rm(join(root, 'src/game/helper.ts'));
  await expect(get()).rejects.toThrow('Missing recipe dependency');
});
