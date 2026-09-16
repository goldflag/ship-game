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

export async function fingerprints(root: string, id: string, definition: ShipDefinition) {
  const registerPath = `assets/ships/${id}/recipe-inputs.json`;
  const files = [`assets/ships/${id}/build.py`];
  if (existsSync(join(root, registerPath))) {
    const register = JSON.parse(await readFile(join(root, registerPath), 'utf8'));
    if (register.version !== 1 || !Array.isArray(register.files) || register.files.some((p: unknown) =>
      typeof p !== 'string' || !/^assets\/[a-zA-Z0-9_./-]+$/.test(p) || p.split('/').includes('..') || /\/(baseline|references)\//.test(p))) throw new Error('Invalid original recipe input register');
    files.push(registerPath, ...register.files);
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
  const exportRecipe = closure([exporter]), thumbnailRecipe = closure([thumbnail]);
  const geometry = hash([geometryDefinition(definition), sources]);
  const model = hash([geometry, exportRecipe]);
  const content = hash([definition, model]);
  return { geometry, model, content, thumbnail: hash([model, thumbnailRecipe]), sources };
}

export async function validFile(path: string, expected?: string) {
  if (!expected) return false;
  try { return await fileHash(path) === expected; } catch { return false; }
}
