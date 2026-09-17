import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from 'playwright';
import type { ConstructionCatalog, ConstructionResult, ShipDefinition } from '../../src/ships/blueprint';
import { createStarterSource } from '../../src/ships/constructionStarter';
import { constructionPipeline, inspectConstructionGlb } from './pipeline';
import { encodeGlb } from './artifacts';
import type { withConstructionBrowser } from './browser';
import catalogJson from '../../public/models/components/catalog.json';

let root: string, compiled: ConstructionResult, exports: number, renders: number;
let realWindow: typeof window, realFetch: typeof fetch;
const put = async (path: string, text: string | Buffer) => { await mkdir(join(root, path, '..'), { recursive: true }); await writeFile(join(root, path), text); };
const read = (path: string) => readFile(join(root, path));
const modelPath = 'public/models/test.glb', manifestPath = 'assets/ships/test/generated/build.json';
const source = createStarterSource(catalogJson as ConstructionCatalog, 'blank'); source.id = 'test';
const render = (definition: ShipDefinition) => async (name: string) => { renders++; return { png: 'data:image/png;base64,' + Buffer.from('image:' + name).toString('base64'), camera: { name, contentHash: definition.contentHash } }; };
const browser: typeof withConstructionBrowser = async (_root, input, work) => {
  const review = (definition: ShipDefinition) => ({
    exportGlb: async () => { exports++; return 'data:model/gltf-binary;base64,' + encodeGlb({ asset: { version: '2.0' }, scene: 0,
      scenes: [{ extras: { definitionHash: definition.contentHash }, nodes: [0] }], nodes: [{ mesh: 0, extras: { definitionHash: definition.contentHash } }], meshes: [{ primitives: [] }] }, []).toString('base64'); },
    sweep: () => ({ samples: 150, maxMuzzleErrorM: 0, blocked: [] }), render: render(definition), dispose() {},
  });
  (globalThis as any).window = { constructionReviewInput: input, constructionReview: review(input.definition!),
    constructionReviewModule: { openReview: async (next: typeof input) => {
      const bytes = await readFile(next.modelUrl!.replace('/@fs', ''));
      inspectConstructionGlb(bytes, next.definition!);
      return review(next.definition!);
    } },
  };
  globalThis.fetch = (async (url: string) => new Response(await readFile(url.replace('/@fs', '')))) as typeof fetch;
  return work({ evaluate: async (fn: Function, arg: unknown) => fn(arg) } as unknown as Page);
};
const run = (action = 'build', force = false) => constructionPipeline(root, action, 'test', force, { compileConstruction: async () => structuredClone(compiled), withConstructionBrowser: browser });
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'construction-pipeline-')); exports = renders = 0;
  realWindow = globalThis.window; realFetch = globalThis.fetch;
  compiled = { sourceId: 'test', revision: source.revision, contentHash: 'native-a', diagnostics: [], surfaces: [],
    definition: { id: 'local-test-a', name: 'Test', contentHash: 'native-a', mounts: [] } as unknown as ShipDefinition };
  await put('assets/ships/test/blueprint.json', JSON.stringify(source));
  await put('public/models/components/catalogs/' + catalogJson.revision + '/catalog.json', JSON.stringify(catalogJson));
  await put('package.json', '{"dependencies":{"three":"0.185.0"}}');
  for (const path of ['src/game/constructionModel.ts', 'src/game/ShipView.ts', 'tools/construction/export.ts', 'tools/construction/presentation.ts', 'tools/construction/pose.ts']) await put(path, 'export const value = 1;');
});
afterEach(async () => { (globalThis as any).window = realWindow; globalThis.fetch = realFetch; await rm(root, { recursive: true, force: true }); });

test('native-only identity and forced identical exports preserve all published bytes', async () => {
  await run(); const files = [modelPath, 'public/models/test.json', manifestPath, 'public/models/test-thumbnail.png', 'assets/ships/test/generated/review/cameras.json'];
  const before = await Promise.all(files.map(read));
  compiled.contentHash = 'native-b'; compiled.definition!.contentHash = 'native-b'; compiled.definition!.id = 'local-test-b';
  await run('check'); const reused = await run(); expect(reused.reused).toBe(true); expect(exports).toBe(1);
  await run('build', true); expect(exports).toBe(2);
  expect(await Promise.all(files.map(read))).toEqual(before);
});
test('presentation edits only rerender images; semantic model edits re-export and identical payload retains identity', async () => {
  await run(); const before = await read(modelPath);
  await put('tools/construction/presentation.ts', 'export const value = 2;');
  await expect(run('check')).rejects.toThrow('thumbnail is stale');
  await run('thumbnail'); await expect(run('check')).rejects.toThrow('review is stale');
  await run('review'); await run('check'); expect(exports).toBe(1); expect(await read(modelPath)).toEqual(before);
  await put('src/game/constructionModel.ts', 'export const value = 2;');
  await expect(run('check')).rejects.toThrow('ship is stale');
  const beforeRenders = renders; await run(); expect(exports).toBe(2); expect(renders).toBe(beforeRenders); expect(await read(modelPath)).toEqual(before);
});
test('real definition changes refresh identity; corrupted model and image bytes never pass or get blessed by review', async () => {
  await run(); const before = await read(modelPath);
  compiled.definition!.name = 'Changed'; await expect(run('check')).rejects.toThrow('ship is stale'); await run();
  expect(await read(modelPath)).not.toEqual(before);
  await put(modelPath, Buffer.from('broken')); await expect(run('check')).rejects.toThrow('output changed'); await run(); await run('check');
  await put('public/models/test-thumbnail.png', 'broken'); await run('review');
  await expect(run('check')).rejects.toThrow('thumbnail is stale'); await run(); await run('check');
  await put('assets/ships/test/generated/review/plan.png', 'broken'); await run('thumbnail');
  await expect(run('check')).rejects.toThrow('review is stale'); await run(); await run('check');
});
test('failed articulation never publishes a candidate', async () => {
  await run(); const before = await read(modelPath);
  const failing: typeof withConstructionBrowser = async (root, input, work) => browser(root, input, async page => {
    window.constructionReview!.sweep = () => ({ samples: 1, torpedoSamples: 0, maxMuzzleErrorM: 1, blocked: [], scope: 'test' });
    // Fail before export as well as after reopen.
    window.constructionReviewModule!.openReview = async () => window.constructionReview!;
    return work(page);
  });
  await expect(constructionPipeline(root, 'build', 'test', true, { compileConstruction: async () => compiled, withConstructionBrowser: failing })).rejects.toThrow('articulation');
  expect(await read(modelPath)).toEqual(before);
});
