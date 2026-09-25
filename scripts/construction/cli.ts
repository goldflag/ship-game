import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createStarterSource, type ConstructionStarter } from '../../src/ships/constructionStarter';
import { decodeConstructionSource, solidPanels } from '../../src/ships/constructionEditor';
import { applyConstructionBatch, constructionDiffCommands, type ConstructionBatch } from '../../src/ships/constructionCommands';
import { DEFAULT_HULL_PRESET, HULL_PRESETS } from '../../src/ships/constructionHullPresets';
import { customHullPanels } from '../../src/ships/constructionPanels';
import { parseConstructionCatalog } from '../../src/ships/constructionEquipment';
import { catalogParts, compactJson } from '../../src/ships/constructionQuery';
import { effectiveConstructionCatalog } from '../../src/ships/constructionCustomFittings';
import { readSource, readCatalog, repositoryStore, constructionId, sourcePath } from './files';
import { compileConstruction, suggestConstruction } from './compiler';
import { REVIEW_VIEWS } from './views';
import { parseFlags, loadCommand, commandSummaries } from './command';
import { FLAGS, BUILTIN_SUMMARIES } from './builtins';
import { guardedBatch, unguardedCommands } from './transaction';
import { ConstructionCommandError } from '../../src/ships/constructionCommandSchema';

// Vite, Playwright and the asset pipeline load only for commands that need them, so reads,
// help and transactions work in a checkout without browser dependencies.
const browserTools = () => import('./browser');
const constructionPipeline = async (...input: Parameters<typeof import('./pipeline').constructionPipeline>) =>
  (await import('./pipeline')).constructionPipeline(...input);

const root = resolve(import.meta.dir, '../..');
const argv = process.argv.slice(2),
  action = argv[0];
const print = (value: unknown) => console.log(JSON.stringify(value, null, 2));
const help = { usage: 'bun scripts/construction/cli.ts <command> <ship-id> [options]', commands: BUILTIN_SUMMARIES };
if (!action || argv.includes('--help')) {
  print({ ...help, commands: { ...help.commands, ...(await commandSummaries()) } });
  process.exit(0);
}
try {
  const extension = FLAGS[action] ? undefined : await loadCommand(action);
  if (!FLAGS[action] && !extension) throw new Error('Unknown construction command. Use --help.');
  const parsed = parseFlags(argv.slice(1), extension ?? FLAGS[action]);
  const id = parsed.id,
    option = parsed.option,
    // Kept in the historical shape: args[2] is the first positional after the ship ID.
    args = { 2: parsed.positionals[0], includes: parsed.has } as { 2: string | undefined; includes(flag: string): boolean };
  if (extension) {
    if (extension.ship !== false) constructionId(id);
    const output = await extension.run({ root, id, positionals: parsed.positionals, option, has: parsed.has, print });
    if (output !== undefined) print(output);
    process.exit(process.exitCode ?? 0);
  }
  if (action === 'templates') {
    print({
      default: DEFAULT_HULL_PRESET,
      adjustableHulls: HULL_PRESETS.map(({ customHull, ...preset }) => ({ ...preset, sections: customHull.stations.length })),
      sandbox: ['blank', 'patrol', 'catamaran'],
    });
    process.exit(0);
  }
  constructionId(id);
  const store = repositoryStore(root);
  if (action === 'new') {
    if (existsSync(join(root, 'assets/ships', id))) throw new Error('Ship directory already exists. Choose a new ID.');
    if (args.includes('--legacy')) {
      if (option('--template')) throw new Error('--template picks a construction starter; a --legacy preset starts from its own recipe.');
      const { scaffoldLegacyShip, DEFAULT_LEGACY_PART } = await import('../ships/legacy');
      print(await scaffoldLegacyShip(root, id, option('--name') ?? id, option('--part') ?? DEFAULT_LEGACY_PART));
      process.exit(0);
    }
    if (option('--part')) throw new Error('--part applies to --legacy only.');
    const template = option('--template') ?? DEFAULT_HULL_PRESET;
    if (![...HULL_PRESETS.map((p) => p.id), 'blank', 'patrol', 'catamaran'].includes(template))
      throw new Error('Unknown construction template. Run ship:templates.');
    const catalog = parseConstructionCatalog(JSON.parse(await readFile(join(root, 'public/models/components/catalog.json'), 'utf8')));
    const source = createStarterSource(catalog, template as ConstructionStarter);
    source.id = id;
    source.name = option('--name') ?? id;
    source.revision = crypto.randomUUID();
    await store.save({
      designId: id,
      source,
      name: source.name,
      schemaVersion: 1,
      catalogRevision: source.construction.catalogRevision,
      expectedRevisionId: null,
    });
    await writeFile(
      join(root, 'assets/ships', id, 'README.md'),
      '# ' +
        source.name +
        '\n\nOriginal construction design; no historical fidelity claim. Ship geometry is authored in blueprint.json. Reusable components retain their original Blender recipes and exact catalog variants.\n\nEdit: `bun run ship:edit ' +
        id +
        '`\nBuild: `bun run ship:build ' +
        id +
        '`\nReview: `bun run ship:review ' +
        id +
        '`\n',
    );
    print({ id, path: sourcePath(root, id), revision: source.revision });
  } else if (['build', 'check', 'compile', 'review', 'thumbnail'].includes(action)) {
    print(await constructionPipeline(root, action, id, args.includes('--force')));
  } else if (action === 'edit') {
    await readSource(root, id);
    const port = Number(option('--port') ?? 0);
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Port must be 0–65535.');
    const { authoringServer, serverUrl } = await browserTools();
    const server = await authoringServer(root, port, 'live');
    print({ url: serverUrl(server) + '/tools/construction/editor.html?ship=' + id, source: sourcePath(root, id), ready: true });
    for (const signal of ['SIGINT', 'SIGTERM'] as const)
      process.on(signal, async () => {
        await server.close();
        process.exit(0);
      });
    await new Promise(() => {});
  } else if (action === 'import') {
    if (!args[2] || args[2].startsWith('--')) throw new Error('Provide a source JSON file.');
    const bytes = await readFile(resolve(args[2]));
    if (bytes.length > 16 * 1024 * 1024) throw new Error('Source exceeds 16 MB.');
    const source = decodeConstructionSource(JSON.parse(bytes.toString()));
    source.id = id;
    source.revision = crypto.randomUUID();
    const revision = await store.save({
      designId: id,
      source,
      name: source.name,
      schemaVersion: 1,
      catalogRevision: source.construction.catalogRevision,
      expectedRevisionId: option('--expect') ?? null,
    });
    print({ id, fileRevision: revision.id, revision: source.revision });
  } else if (action === 'register') {
    // A Blender-recipe preset (build.py and an authored hull) has no construction source to read.
    const legacy = await import('../ships/legacy');
    const recipe = await legacy.isLegacyShip(root, id);
    if (recipe) legacy.checkLegacyShip(root, id);
    else await constructionPipeline(root, 'check', id);
    const file = join(root, 'src/ships/presets.ts'),
      text = await readFile(file, 'utf8');
    if (text.includes('preset(' + JSON.stringify(id) + ')') || text.includes("preset('" + id + "')"))
      throw new Error('Ship is already imported. Check the existing roster entry.');
    const line = "  '" + id + "': preset('" + id + "'),\n";
    const next = text.replace('export const shipPresets = {\n', 'export const shipPresets = {\n' + line);
    if (next === text || !next.includes(line)) throw new Error('Roster declaration not found.');
    await writeFile(file, next);
    print({
      id,
      registered: true,
      // The smoke test requires a funnel mouth on every registered surface preset: say now if there is none.
      ...(recipe ? await legacy.funnelReport(root, id) : {}),
      next: 'Run bun run ship:hydrostatics and bun run multiplayer:content, then bun run build; registration does not certify visual acceptance.',
    });
  } else {
    const current = await readSource(root, id),
      { source } = current;
    if (action === 'catalog') {
      const catalog = await readCatalog(root, source.construction.catalogRevision);
      // A ship's own custom fittings list beside the published parts (`--query design:`).
      const equipment = catalogParts(effectiveConstructionCatalog(source.construction, catalog), {
        query: option('--query'),
        kind: option('--kind'),
        ids: option('--ids')?.split(',').map((part) => part.trim()).filter(Boolean),
        brief: args.includes('--brief'),
      });
      if (args.includes('--brief')) console.log(compactJson({ id, catalogRevision: catalog.revision, count: equipment.length, equipment }));
      else print({ id, catalogRevision: catalog.revision, equipment });
    } else if (action === 'suggest') {
      const partIds = option('--parts')
        ?.split(',')
        .map((id) => id.trim())
        .filter(Boolean);
      if (!partIds?.length || partIds.length > 16) throw new Error('Provide --parts with 1–16 exact retained catalog IDs.');
      const proposal = await suggestConstruction(root, source, partIds);
      const batch = {
        version: 1,
        expectedRevision: source.revision,
        expectedFileHash: current.hash,
        label: 'Apply native layout suggestion',
        commands: constructionDiffCommands(source, proposal.source),
      };
      const failed = proposal.diagnostics.some((d) => d.severity === 'error');
      if (option('--out') && !failed) await writeFile(resolve(option('--out')!), JSON.stringify(batch, null, 2) + '\n', { flag: 'wx' });
      print({ id, diagnostics: proposal.diagnostics, batch: failed ? null : batch });
      if (failed) process.exitCode = 1;
    } else if (action === 'inspect' && args.includes('--source-only')) {
      print({
        id,
        revision: source.revision,
        fileRevision: current.hash,
        sourcePath: sourcePath(root, id),
        catalogRevision: source.construction.catalogRevision,
        compiled: false,
        source,
        ...(args.includes('--panels')
          ? { panels: source.construction.primitives.map((p) => ({ id: p.id, panels: [...customHullPanels(p), ...solidPanels(p)] })) }
          : {}),
      });
    } else if (action === 'export') {
      if (!args[2] || args[2].startsWith('--')) throw new Error('Provide an output JSON filename.');
      const path = resolve(args[2]);
      await writeFile(path, current.json, { flag: 'wx' });
      print({ path, fileRevision: current.hash });
    } else if (action === 'apply') {
      const unguarded = option('--commands');
      if (unguarded && args[2]) throw new Error('Give either a guarded batch file or --commands, not both.');
      if (!unguarded && (!args[2] || args[2].startsWith('--'))) throw new Error('Provide a command batch JSON file, or --commands with a bare command list.');
      if (option('--label') && !unguarded) throw new Error('--label names a batch built by --commands; a guarded batch carries its own label.');
      const document = JSON.parse(await readFile(resolve(unguarded ?? args[2]!), 'utf8'));
      // --commands reads the current revisions here instead of asking the caller to copy them. The
      // transaction is unchanged: both checks still run and the save still fails if the file moved.
      let batch: ConstructionBatch & { expectedFileHash: string };
      if (unguarded) {
        const { label, commands } = unguardedCommands(document);
        batch = guardedBatch(current, option('--label') ?? label ?? 'Apply ' + commands.length + ' command' + (commands.length === 1 ? '' : 's'), commands);
      } else batch = document as ConstructionBatch & { expectedFileHash: string };
      if (batch.expectedFileHash !== current.hash)
        throw new Error('File revision changed. Inspect the source and update the batch before retrying.');
      const next = applyConstructionBatch(source, batch);
      if (args.includes('--dry-run')) {
        const result = await compileConstruction(root, next);
        print({
          id,
          dryRun: true,
          expectedRevision: source.revision,
          expectedFileHash: current.hash,
          launchable: !!result.definition,
          diagnostics: result.diagnostics,
          // Brief keeps the loading totals and drops the per-item mass contributions.
          loading: args.includes('--brief') && result.loading ? { ...result.loading, contributions: undefined } : result.loading,
        });
        if (!result.definition) process.exitCode = 1;
      } else {
        const revision = await store.save({
          designId: id,
          source: next,
          name: next.name,
          schemaVersion: 1,
          catalogRevision: next.construction.catalogRevision,
          expectedRevisionId: current.hash,
        });
        print({ id, revision: next.revision, fileRevision: revision.id });
      }
    } else {
      const result = await compileConstruction(root, source);
      if (action === 'inspect' && args.includes('--brief')) {
        if (args.includes('--source') || args.includes('--panels')) throw new Error('--brief cannot be combined with --source or --panels.');
        const { contributions, ...loading } = result.loading ?? { contributions: [] };
        const c = source.construction;
        console.log(
          compactJson({
            id,
            revision: source.revision,
            fileRevision: current.hash,
            catalogRevision: c.catalogRevision,
            launchable: !!result.definition,
            compiled: true,
            counts: { primitives: c.primitives.length, surfaces: c.surfaces.length, equipment: c.equipment.length, boundaries: c.boundaries.length, loads: c.loads.length, massContributions: contributions.length },
            loading: result.loading ? loading : undefined,
            diagnostics: result.diagnostics,
          }),
        );
      } else if (action === 'inspect') {
        print({
          id,
          revision: source.revision,
          fileRevision: current.hash,
          sourcePath: sourcePath(root, id),
          catalogRevision: source.construction.catalogRevision,
          launchable: !!result.definition,
          compiled: true,
          primitives: source.construction.primitives.length,
          equipment: source.construction.equipment,
          loading: result.loading,
          diagnostics: result.diagnostics,
          ...(args.includes('--source') ? { source } : {}),
          ...(args.includes('--panels')
            ? { panels: source.construction.primitives.map((p) => ({ id: p.id, panels: [...customHullPanels(p), ...solidPanels(p)] })) }
            : {}),
        });
      } else if (action === 'render' || action === 'trial') {
        const published = args.includes('--published');
        if (published) await constructionPipeline(root, 'check', id);
        const definition = published ? JSON.parse(await readFile(join(root, 'public/models', id + '.json'), 'utf8')) : undefined;
        const input = { source, result, definition, modelUrl: definition?.modelUrl };
        // Unique per call: concurrent agents never overwrite each other's evidence.
        const directory = resolve(
          option('--out') ??
            join(root, '.build/construction', id, action, current.hash.slice(0, 8) + '-' + new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15) + '-' + process.pid),
        );
        await mkdir(directory, { recursive: true });
        const { withConstructionBrowser } = await browserTools();
        const output = await withConstructionBrowser(root, input, async (page) => {
          if (action === 'trial')
            return await page.evaluate((seconds) => window.constructionReview!.trial(seconds), Number(option('--seconds') ?? 10));
          const poseFile = option('--pose');
          let posed;
          if (poseFile) {
            const values = JSON.parse(await readFile(resolve(poseFile), 'utf8')) as Record<
              string,
              { trainDeg: number; elevationDeg: number; recoil: number }
            >;
            const mounts = result.definition!.mounts;
            if (Object.keys(values).some((id) => !mounts.some((m) => m.id === id)))
              throw new Error('Pose references an unknown gun mount.');
            const requestedPoses = mounts.map((m) => {
              const value = values[m.id] ?? { trainDeg: 0, elevationDeg: 0, recoil: 0 };
              if (![value.trainDeg, value.elevationDeg, value.recoil].every(Number.isFinite) || value.recoil < 0 || value.recoil > 1)
                throw new Error('Poses require finite trainDeg/elevationDeg and recoil from 0 to 1.');
              return { train: (value.trainDeg * Math.PI) / 180, elevation: (value.elevationDeg * Math.PI) / 180, recoil: value.recoil };
            });
            posed = await page.evaluate((value) => window.constructionReview!.pose(value), requestedPoses);
          }
          const requested = option('--view');
          if (requested && !REVIEW_VIEWS.includes(requested as (typeof REVIEW_VIEWS)[number])) throw new Error('Unknown review view.');
          const cameras = [];
          for (const name of requested ? [requested as (typeof REVIEW_VIEWS)[number]] : REVIEW_VIEWS) {
            const frame = await page.evaluate(({ name, options }) => window.constructionReview!.render(name, options), {
              name,
              options: { id: option('--part'), isolate: args.includes('--isolate'), keepPose: !!poseFile },
            });
            await writeFile(join(directory, name + '.png'), Buffer.from(frame.png.split(',')[1], 'base64'));
            cameras.push(frame.camera);
          }
          return {
            posed,
            inspection: await page.evaluate(() => window.constructionReview!.inspect()),
            cameras,
            articulation: args.includes('--quick')
              ? { skipped: true, reason: 'Quick preview; run ship:review for acceptance.' }
              : await page.evaluate(() => window.constructionReview!.sweep()),
          };
        });
        await writeFile(join(directory, action + '.json'), JSON.stringify(output, null, 2) + '\n');
        print({ id, directory, output });
      } else throw new Error('Unknown construction command. Use --help.');
    }
  }
} catch (error) {
  // A malformed batch names its failing command: index, op, JSON path and close matches.
  const detail = error instanceof ConstructionCommandError ? error.toJSON() : {};
  console.error(JSON.stringify({ ...detail, error: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
}
