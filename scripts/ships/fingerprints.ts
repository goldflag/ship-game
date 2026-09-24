import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ShipDefinition } from '../../src/ships/blueprint';

export const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const fileHash = async (path: string) => createHash('sha256').update(await readFile(path)).digest('hex');

// This is the input contract exposed to original geometry recipes. Gameplay-only
// properties stay in the runtime definition. A recipe needing a new property must
// add it here, so its dependency cannot silently escape the geometry fingerprint.
const geometryFields = ['schemaVersion', 'id', 'name', 'configuration', 'coordinates', 'modelUrl',
  'hull', 'mounts', 'armor', 'modules', 'compartments', 'obstructions', 'structures', 'rig',
  'torpedoTubes', 'torpedoLaunchers', 'depthChargeLaunchers', 'submarine'] as const;
export function geometryDefinition(definition: ShipDefinition) {
  return Object.fromEntries(geometryFields.filter(key => key in definition).map(key => [key, definition[key as keyof ShipDefinition]]));
}

type Records = { [key: string]: unknown };
const recordList = (value: unknown): value is Records[] => Array.isArray(value) && value.every(item =>
  item !== null && typeof item === 'object' && typeof ((item as Records).id ?? (item as Records).partId) === 'string');
const recordMap = (value: unknown): value is Record<string, Records> => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  Object.values(value).every(item => item !== null && typeof item === 'object' && !Array.isArray(item));

/** A parts catalog cut to the records a recipe declares: each top-level list of ID'd records and each map of
 * records keeps only those IDs; other fields stay whole. A declared ID that no collection holds is an error. */
export function catalogRecords(catalog: Records, ids: readonly string[]): Records {
  const found = new Set<string>();
  const keep = (id: string) => ids.includes(id) && !!found.add(id);
  const cut = Object.fromEntries(Object.entries(catalog).map(([key, value]) => [key,
    recordList(value) ? value.filter(item => keep(String(item.id ?? item.partId)))
      : recordMap(value) ? Object.fromEntries(Object.entries(value).filter(([id]) => keep(id)))
        : value]));
  const missing = ids.filter(id => !found.has(id));
  if (missing.length) throw new Error(`Declared catalog records not found: ${missing.join(', ')}`);
  return cut;
}

const inputPath = (p: unknown): p is string =>
  typeof p === 'string' && /^assets\/[a-zA-Z0-9_./-]+$/.test(p) && !p.split('/').includes('..') && !/\/(baseline|references)\//.test(p);

export async function fingerprints(root: string, id: string, definition: ShipDefinition) {
  const registerPath = `assets/ships/${id}/recipe-inputs.json`;
  const files = [`assets/ships/${id}/build.py`];
  // Catalogs declared by record: the build reads trimmed copies (catalog_records.py), so only those records count.
  let records: Record<string, string[]> = {};
  if (existsSync(join(root, registerPath))) {
    const register = JSON.parse(await readFile(join(root, registerPath), 'utf8'));
    records = register.records ?? {};
    if (register.version !== 1 || !Array.isArray(register.files) || !register.files.every(inputPath)
      || records === null || typeof records !== 'object' || Array.isArray(records) || !Object.entries(records).every(([path, ids]) => inputPath(path) && path.endsWith('.json') && !register.files.includes(path)
        && Array.isArray(ids) && ids.length > 0 && ids.every(id => typeof id === 'string' && id)))
      throw new Error('Invalid original recipe input register');
    files.push(registerPath, ...register.files, ...Object.keys(records));
  }
  const exporter = 'scripts/ships/export.py', thumbnail = 'assets/ships/thumbnail.py';
  const child = Bun.spawn(['python3', join(root, 'scripts/ships/fingerprints.py'), root], { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
  child.stdin.write(JSON.stringify([...files, exporter, thumbnail]));
  child.stdin.end();
  const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (code) throw new Error(`Cannot fingerprint recipes: ${err}`);
  const graph = JSON.parse(out) as { sources: Record<string, string>; dependencies: Record<string, string[]> };
  const closure = (entries: string[]) => {
    const visited = new Set<string>();
    const visit = (path: string) => {
      if (visited.has(path)) return;
      visited.add(path);
      graph.dependencies[path]?.forEach(visit);
    };
    entries.forEach(visit);
    return Object.fromEntries([...visited].sort().map(path => [path, graph.sources[path]]));
  };
  const sources = closure(files);
  // The mount library selects builders by fitted part ID; discovery labels and
  // unrelated variants cannot affect a ship's original geometry.
  const libraryPath = 'assets/parts/library.json';
  if (sources[libraryPath]) {
    const library = JSON.parse(sources[libraryPath]);
    const fitted = new Set(definition.mounts.map(mount => mount.partId));
    const components = library.components.filter((entry: { partId: string }) => fitted.has(entry.partId));
    sources[libraryPath] = JSON.stringify({ ...library, components,
      builders: Object.fromEntries(components.filter((entry: { builder?: string }) => entry.builder)
        .map((entry: { builder: string }) => [entry.builder, library.builders[entry.builder]])) });
  }
  for (const [path, ids] of Object.entries(records)) sources[path] = JSON.stringify(catalogRecords(JSON.parse(sources[path]), ids));
  const exportRecipe = closure([exporter]), thumbnailRecipe = closure([thumbnail]);
  const geometry = hash([geometryDefinition(definition), sources]);
  const model = hash([geometry, exportRecipe]);
  const content = hash([definition, model]);
  return { geometry, model, content, thumbnail: hash([model, thumbnailRecipe]), sources, records };
}

export async function validFile(path: string, expected?: string) {
  if (!expected) return false;
  try { return await fileHash(path) === expected; } catch { return false; }
}
