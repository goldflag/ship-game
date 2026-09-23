/** Blender as an optional authoring front end: `ship:blender-import` writes a scratch scene, and
 * `ship:blender-export` turns an edited scene into a revision-guarded batch. Nothing here saves a
 * source; builds never run Blender; `blueprint.json` stays the only durable source. */
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { ConstructionResult } from '../../src/ships/blueprint';
import { applyConstructionBatch, constructionDiffCommands } from '../../src/ships/constructionCommands';
import { runBlender } from '../build/blender';
import { blenderEdits, blenderScene, type ExportOptions, type SceneDump } from './blenderScene';
import { compileConstruction } from './compiler';
import { readCatalog } from './files';
import { guardedBatch, type CurrentSource, type GuardedBatch } from './transaction';

const scripts = join(import.meta.dir, 'blender');
export const sceneDirectory = (root: string, id: string) => join(root, '.build/construction-blender', id);
/** Scene builds read source data only: no published models, glTF files or reference caches. */
const audit = (root: string) => ({ root, forbid: 'published' as const });

export interface ImportResult {
  blend: string;
  scene: string;
  objects: Record<string, number>;
  diagnostics: ConstructionResult['diagnostics'];
  blenderVersion: string;
}

/** Compile the source, write `scene.json` beside the `.blend`, and build the `.blend` in Blender. */
export async function blenderImport(root: string, current: CurrentSource, options: { out?: string; replace?: boolean } = {}): Promise<ImportResult> {
  const blend = resolve(options.out ?? join(sceneDirectory(root, current.source.id), 'scene.blend'));
  if (!blend.endsWith('.blend')) throw new Error('The scene file must end in .blend.');
  if (existsSync(blend) && !options.replace)
    throw new Error(`${blend} already exists and may hold unexported work. Export it first, then pass --replace, or choose another --out.`);
  const directory = dirname(blend),
    sceneFile = blend.replace(/\.blend$/, '.json');
  await mkdir(directory, { recursive: true });
  const catalog = await readCatalog(root, current.source.construction.catalogRevision);
  const result = await compileConstruction(root, current.source);
  const scene = blenderScene(current, result, catalog);
  await writeFile(sceneFile, JSON.stringify(scene));
  if (options.replace) await rm(blend, { force: true });
  const run = await runBlender(join(scripts, 'import_scene.py'), { CONSTRUCTION_SCENE: sceneFile, CONSTRUCTION_BLEND: blend }, {
    cwd: root,
    audit: audit(root),
    log: blend.replace(/\.blend$/, '.import.log'),
  });
  const objects: Record<string, number> = {};
  for (const o of scene.objects) objects[o.role] = (objects[o.role] ?? 0) + 1;
  return { blend, scene: sceneFile, objects, diagnostics: result.diagnostics, blenderVersion: run.version };
}

/** Read every object of a scene through Blender, without changing the file. */
export async function dumpBlenderScene(root: string, id: string, blend: string): Promise<SceneDump> {
  const path = resolve(blend);
  if (!existsSync(path)) throw new Error(`No scene at ${path}.`);
  const directory = sceneDirectory(root, id);
  await mkdir(directory, { recursive: true });
  const dump = join(directory, `export-${crypto.randomUUID()}.json`);
  try {
    await runBlender(join(scripts, 'export_scene.py'), { CONSTRUCTION_BLEND: path, CONSTRUCTION_DUMP: dump }, {
      cwd: root,
      audit: audit(root),
      log: join(directory, 'export.log'),
    });
    return JSON.parse(await readFile(dump, 'utf8')) as SceneDump;
  } finally {
    await rm(dump, { force: true });
  }
}

export interface ExportResult {
  report: ReturnType<typeof blenderEdits>['report'];
  seating: { id: string; status: string; position: number[]; gapM?: number; message?: string }[];
  batch?: GuardedBatch;
  candidate?: ConstructionResult;
}

/** The scene's edits as a guarded batch, checked by a native compile of the exact candidate. */
export async function blenderExport(root: string, current: CurrentSource, blend: string, options: ExportOptions = {}): Promise<ExportResult> {
  const dump = await dumpBlenderScene(root, current.source.id, blend);
  const catalog = await readCatalog(root, current.source.construction.catalogRevision);
  const { after, report, seat } = blenderEdits(current.source, dump, catalog, options);
  if (report.failures.length) return { report, seating: [] };
  const seating: ExportResult['seating'] = [];
  if (seat.length) {
    const { resolvePlacement } = await import('./placement');
    const resolved = await resolvePlacement(root, after, seat);
    for (const placement of resolved.placements) {
      const row = after.construction.equipment.find((e) => e.id === placement.id);
      if (row && placement.status !== 'unsupported') row.position = placement.position;
      seating.push({
        id: placement.id,
        status: placement.status,
        position: placement.position,
        ...(placement.gapM !== undefined ? { gapM: placement.gapM } : {}),
        ...(placement.message ? { message: placement.message } : {}),
      });
    }
    for (const d of resolved.diagnostics) if (d.severity === 'error') report.warnings.push(`seat: ${d.message}`);
  }
  const commands = constructionDiffCommands(current.source, after);
  if (!commands.length) return { report, seating };
  const batch = guardedBatch(current, 'Blender export', commands);
  const candidate = await compileConstruction(root, applyConstructionBatch(current.source, batch));
  return { report, seating, batch, candidate };
}
