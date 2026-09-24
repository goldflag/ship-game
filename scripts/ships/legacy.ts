/** Blender-recipe (legacy) presets in the construction CLI: `ship:new --legacy` and `ship:register`. */
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readLibrary, recipeInputs } from '../parts/library';

const TEMPLATE = join(import.meta.dir, 'legacy-template');
const TEMPLATE_FILES = ['author-blueprint.py', 'build.py', 'appearance.json', 'README.md'];
export const DEFAULT_LEGACY_PART = 'us-6in47-mk16-cleveland';

/** A Blender-recipe preset: a build.py recipe and a blueprint with an authored hull. */
export async function isLegacyShip(root: string, id: string) {
  const dir = join(root, 'assets/ships', id);
  if (!existsSync(join(dir, 'build.py')) || !existsSync(join(dir, 'blueprint.json'))) return false;
  const blueprint = JSON.parse(await readFile(join(dir, 'blueprint.json'), 'utf8'));
  return !!blueprint.hull && !blueprint.construction;
}

/** Write the Alaska-style layout and a starter blueprint that compiles and builds. */
export async function scaffoldLegacyShip(root: string, id: string, name: string, partId: string) {
  // The name lands inside Python string literals and the README.
  if (!name.trim() || name.length > 80 || /['"\\\p{Cc}]/u.test(name)) throw new Error('Name must be 1–80 characters without quotes or backslashes.');
  const { library, catalog } = await readLibrary(root);
  const entry = library.components.find((e) => e.partId === partId);
  if (!entry?.builder || !catalog.parts.some((p) => p.id === partId))
    throw new Error('Unknown or preview-only gun part ' + JSON.stringify(partId) + '. Run bun run part:list and pick a reusable recipe.');
  const dir = join(root, 'assets/ships', id);
  await mkdir(dir);
  for (const file of TEMPLATE_FILES) {
    const text = await readFile(join(TEMPLATE, file), 'utf8');
    await writeFile(join(dir, file), text.replaceAll('__SHIP_ID__', id).replaceAll('__SHIP_NAME__', name).replaceAll('__MAIN_PART__', partId));
  }
  const files = [
    ...recipeInputs(library, entry),
    `assets/ships/${id}/appearance.json`,
    'assets/ships/appearance/surface.py',
    'assets/ships/appearance/finishes.json',
  ];
  await writeFile(join(dir, 'recipe-inputs.json'), JSON.stringify({ version: 1, files: [...new Set(files)] }, null, 2) + '\n');
  const author = Bun.spawnSync(['python3', join(dir, 'author-blueprint.py')], { cwd: root, stdout: 'pipe', stderr: 'pipe' });
  if (author.exitCode !== 0) throw new Error('author-blueprint.py failed:\n' + author.stderr.toString());
  return {
    id,
    path: dir,
    files: [...TEMPLATE_FILES, 'recipe-inputs.json', 'blueprint.json'],
    authored: author.stdout.toString().trim(),
    next: [
      'Write the approved brief into README.md.',
      'Replace the placeholder tables in author-blueprint.py with measured values and rerun it; add geometry to build.py.',
      `bun run ship:build ${id}`,
      `bun -e "import { writeLocalDamage } from './assets/ships/author-local-damage.ts'; await writeLocalDamage(['${id}'])"`,
      `bun assets/ships/author-flood-spaces.ts ${id} && bun assets/ships/author-stability.ts ${id} && bun assets/ships/author-damage-control.ts ${id}`,
      `bun run ship:build ${id} && bun run ship:register ${id}`,
      'bun run ship:hydrostatics && bun run multiplayer:content',
    ],
  };
}

/** Published outputs must match the recipe before a Blender-recipe preset joins the roster. */
export function checkLegacyShip(root: string, id: string) {
  const check = Bun.spawnSync(['bun', 'scripts/ships/pipeline.ts', 'check', id], { cwd: root, stdout: 'pipe', stderr: 'pipe' });
  if (check.exitCode !== 0)
    throw new Error(`ship:check ${id} failed; run bun run ship:build ${id} first.\n` + (check.stderr.toString() || check.stdout.toString()).trim().slice(-2000));
}

/** Add the ship's funnel count to the smoke test's table of registered presets. */
export async function addFunnelCount(root: string, id: string) {
  const { funnelOutlets } = await import('../../src/game/ShipFunnelSmoke');
  const definition = JSON.parse(await readFile(join(root, 'public/models', id + '.json'), 'utf8'));
  const count = funnelOutlets(definition).length;
  const file = join(root, 'src/game/ShipFunnelSmoke.test.ts'),
    text = await readFile(file, 'utf8');
  const table = /(const counts: Record<string, number> = \{)([\s\S]*?)( \};)/.exec(text);
  const key = /^[a-z][a-z0-9]*$/.test(id) ? id : `'${id}'`;
  if (!table) return { funnels: count, testRow: 'counts table not found; add it by hand' };
  if (new RegExp(`[{,\\s]${key}:`).test(table[2])) return { funnels: count, testRow: 'already present' };
  // Wrap onto a fresh row rather than growing the last one past the source line width.
  const last = (text.slice(0, table.index) + table[1] + table[2]).split('\n').pop()!, entry = `${key}: ${count}`;
  const row = last.length + entry.length > 170 ? ',\n    ' + entry : ', ' + entry;
  await writeFile(file, text.slice(0, table.index) + table[1] + table[2] + row + table[3] + text.slice(table.index + table[0].length));
  return { funnels: count, testRow: 'added' };
}
