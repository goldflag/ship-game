import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createStarterSource, type ConstructionStarter } from '../../src/ships/constructionStarter';
import { decodeConstructionSource } from '../../src/ships/constructionEditor';
import { applyConstructionBatch, type ConstructionBatch } from '../../src/ships/constructionCommands';
import { parseConstructionCatalog } from '../../src/ships/constructionEquipment';
import { readSource, repositoryStore, constructionId, sourcePath } from './files';
import { compileConstruction } from './compiler';
import { authoringServer, serverUrl, withConstructionBrowser } from './browser';
import { constructionPipeline, REVIEW_VIEWS } from './pipeline';

const root = resolve(import.meta.dir, '../..');
const args = process.argv.slice(2), [action, id] = args;
const option = (flag: string) => { const i = args.indexOf(flag); return i < 0 ? undefined : args[i + 1]; };
const print = (value: unknown) => console.log(JSON.stringify(value, null, 2));
const help = {
  usage: 'bun scripts/construction/cli.ts <command> <ship-id> [options]',
  commands: {
    new: '[--template blank|patrol|catamaran] [--name name]',
    edit: '[--port 5173] — serve the repository source in the game editor',
    inspect: '[--source] — source/file revisions, native diagnostics and loading',
    apply: '<batch.json> — version, expectedRevision, expectedFileHash, label, commands',
    import: '<source.json> [--expect file-hash] — create or explicitly replace a construction source',
    export: '<output.json> — exact source backup',
    render: '[--view profile|plan|bow|stern|quarter] [--part id] [--isolate] [--out directory] [--published] [--pose poses.json]',
    trial: '[--seconds 10] — real local native/WASM combat and reset',
    register: '— add an already built ship to src/ships/presets.ts',
    compile: 'native definition; also available through ship:compile',
    build: 'GLB, native definition, thumbnail and fixed review views',
    check: 'source, catalog and published artifact integrity',
    review: 'fixed views and articulation of the exact published GLB',
    thumbnail: 'refresh the published thumbnail',
  },
};
if (!action || args.includes('--help')) { print(help); process.exit(0); }
try {
  constructionId(id);
  const store = repositoryStore(root);
  if (action === 'new') {
    if (existsSync(join(root, 'assets/ships', id))) throw new Error('Ship directory already exists. Choose a new ID.');
    const template = option('--template') ?? 'blank';
    if (!['blank', 'patrol', 'catamaran'].includes(template)) throw new Error('Unknown construction template.');
    const catalog = parseConstructionCatalog(JSON.parse(await readFile(join(root, 'public/models/components/catalog.json'), 'utf8')));
    const source = createStarterSource(catalog, template as ConstructionStarter);
    source.id = id; source.name = option('--name') ?? id; source.revision = crypto.randomUUID();
    await store.save({ designId: id, source, name: source.name, schemaVersion: 1, catalogRevision: source.construction.catalogRevision, expectedRevisionId: null });
    await writeFile(join(root, 'assets/ships', id, 'README.md'), '# ' + source.name + '\n\nOriginal construction design; no historical fidelity claim. Ship geometry is authored in blueprint.json. Reusable components retain their original Blender recipes and exact catalog variants.\n\nEdit: `bun run ship:edit ' + id + '`\nBuild: `bun run ship:build ' + id + '`\nReview: `bun run ship:review ' + id + '`\n');
    print({ id, path: sourcePath(root, id), revision: source.revision });
  } else if (['build', 'check', 'compile', 'review', 'thumbnail'].includes(action)) {
    print(await constructionPipeline(root, action, id, args.includes('--force')));
  } else if (action === 'edit') {
    await readSource(root, id);
    const port = Number(option('--port') ?? 0);
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Port must be 0–65535.');
    const server = await authoringServer(root, port, true);
    print({ url: serverUrl(server) + '/tools/construction/editor.html?ship=' + id, source: sourcePath(root, id), ready: true });
    for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, async () => { await server.close(); process.exit(0); });
    await new Promise(() => {});
  } else if (action === 'import') {
    if (!args[2] || args[2].startsWith('--')) throw new Error('Provide a source JSON file.');
    const bytes = await readFile(resolve(args[2]));
    if (bytes.length > 16 * 1024 * 1024) throw new Error('Source exceeds 16 MB.');
    const source = decodeConstructionSource(JSON.parse(bytes.toString()));
    source.id = id; source.revision = crypto.randomUUID();
    const revision = await store.save({ designId: id, source, name: source.name, schemaVersion: 1, catalogRevision: source.construction.catalogRevision, expectedRevisionId: option('--expect') ?? null });
    print({ id, fileRevision: revision.id, revision: source.revision });
  } else {
    const current = await readSource(root, id), { source } = current;
    if (action === 'export') {
      if (!args[2] || args[2].startsWith('--')) throw new Error('Provide an output JSON filename.');
      const path = resolve(args[2]); await writeFile(path, current.json, { flag: 'wx' }); print({ path, fileRevision: current.hash });
    } else if (action === 'apply') {
      if (!args[2] || args[2].startsWith('--')) throw new Error('Provide a command batch JSON file.');
      const batch = JSON.parse(await readFile(resolve(args[2]), 'utf8')) as ConstructionBatch & { expectedFileHash: string };
      if (batch.expectedFileHash !== current.hash) throw new Error('File revision changed. Inspect the source and update the batch before retrying.');
      const next = applyConstructionBatch(source, batch);
      const revision = await store.save({ designId: id, source: next, name: next.name, schemaVersion: 1, catalogRevision: next.construction.catalogRevision, expectedRevisionId: current.hash });
      print({ id, revision: next.revision, fileRevision: revision.id });
    } else if (action === 'register') {
      await constructionPipeline(root, 'check', id);
      const file = join(root, 'src/ships/presets.ts'), text = await readFile(file, 'utf8');
      if (text.includes("from '../../public/models/" + id + ".json")) throw new Error('Ship is already imported. Check the existing roster entry.');
      const variable = 'constructed' + id.split('-').map(s => s[0].toUpperCase() + s.slice(1)).join('');
      const line = '  ' + JSON.stringify(id) + ': ' + variable + ',\n';
      // Native definitions can contain tens of MB of derived convex geometry.
      // They are validated above; avoid inferring a TypeScript type per JSON leaf.
      const declaration = 'const ' + variable + ' = JSON.parse(' + variable + 'Json) as ShipDefinition;\n';
      const next = "import " + variable + "Json from '../../public/models/" + id + ".json?raw';\n" + text.replace('export const shipPresets = {\n', declaration + 'export const shipPresets = {\n' + line);
      if (next === text || !next.includes(line)) throw new Error('Roster declaration not found.');
      await writeFile(file, next);
      print({ id, registered: true, next: 'Run bun run build; registration does not certify visual acceptance.' });
    } else {
      const result = await compileConstruction(root, source);
      if (action === 'inspect') {
        print({ id, revision: source.revision, fileRevision: current.hash, sourcePath: sourcePath(root, id), catalogRevision: source.construction.catalogRevision, launchable: !!result.definition,
          primitives: source.construction.primitives.length, equipment: source.construction.equipment, loading: result.loading, diagnostics: result.diagnostics, ...(args.includes('--source') ? { source } : {}) });
      } else if (action === 'render' || action === 'trial') {
        const published = args.includes('--published');
        if (published) await constructionPipeline(root, 'check', id);
        const definition = published ? JSON.parse(await readFile(join(root, 'public/models', id + '.json'), 'utf8')) : undefined;
        const input = { source, result, definition, modelUrl: definition?.modelUrl };
        const directory = resolve(option('--out') ?? join(root, '.build/construction', id, action));
        await mkdir(directory, { recursive: true });
        const output = await withConstructionBrowser(root, input, async page => {
          if (action === 'trial') return await page.evaluate(seconds => window.constructionReview!.trial(seconds), Number(option('--seconds') ?? 10));
          const poseFile = option('--pose');
          let posed;
          if (poseFile) {
            const values = JSON.parse(await readFile(resolve(poseFile), 'utf8')) as Record<string, { trainDeg: number; elevationDeg: number; recoil: number }>;
            const mounts = result.definition!.mounts;
            if (Object.keys(values).some(id => !mounts.some(m => m.id === id))) throw new Error('Pose references an unknown gun mount.');
            const requestedPoses = mounts.map(m => {
              const value = values[m.id] ?? { trainDeg: 0, elevationDeg: 0, recoil: 0 };
              if (![value.trainDeg, value.elevationDeg, value.recoil].every(Number.isFinite) || value.recoil < 0 || value.recoil > 1) throw new Error('Poses require finite trainDeg/elevationDeg and recoil from 0 to 1.');
              return { train: value.trainDeg * Math.PI / 180, elevation: value.elevationDeg * Math.PI / 180, recoil: value.recoil };
            });
            posed = await page.evaluate(value => window.constructionReview!.pose(value), requestedPoses);
          }
          const requested = option('--view');
          if (requested && !REVIEW_VIEWS.includes(requested as typeof REVIEW_VIEWS[number])) throw new Error('Unknown review view.');
          const cameras = [];
          for (const name of requested ? [requested as typeof REVIEW_VIEWS[number]] : REVIEW_VIEWS) {
            const frame = await page.evaluate(({ name, options }) => window.constructionReview!.render(name, options), { name, options: { id: option('--part'), isolate: args.includes('--isolate'), keepPose: !!poseFile } });
            await writeFile(join(directory, name + '.png'), Buffer.from(frame.png.split(',')[1], 'base64'));
            cameras.push(frame.camera);
          }
          return { posed, inspection: await page.evaluate(() => window.constructionReview!.inspect()), cameras, articulation: await page.evaluate(() => window.constructionReview!.sweep()) };
        });
        await writeFile(join(directory, action + '.json'), JSON.stringify(output, null, 2) + '\n');
        print({ id, directory, output });
      } else throw new Error('Unknown construction command. Use --help.');
    }
  }
} catch (error) {
  console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error) })); process.exitCode = 1;
}
