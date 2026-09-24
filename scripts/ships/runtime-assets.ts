import { readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import hydrostatics from '../../assets/gameplay/hydrostatics.v1.json';
import type { ShipDefinition } from '../../src/ships/blueprint';
import { runtimeProjection } from '../../src/ships/runtimeProjection';
import { encodeRuntimeDefinition } from '../../src/ships/runtimeEncoding';
import { perRecordJson } from '../git/json-format';
const hash = (s: string | Uint8Array) => createHash('sha256').update(s).digest('hex');
/** Read the canonical roster without evaluating/loading its definitions. */
export async function presetIds(root = process.cwd()): Promise<string[]> {
  const text = await readFile(join(root, 'src/ships/presets.ts'), 'utf8');
  const body = text.split('export const shipPresets = {')[1]?.split('\n};')[0];
  if (!body) throw new Error('Missing canonical preset roster');
  return [...body.matchAll(/^\s*(?:['"]([^'"]+)['"]|(\w+))\s*[:,]/gm)].map(m => m[1] ?? m[2]);
}
export async function runtimeAssets(root = process.cwd(), check = false) {
  const summaries: Record<string, unknown> = {}, ships = [];
  await mkdir(join(root, 'public/models/runtime'), { recursive: true });
  for (const id of await presetIds(root)) {
    const source = await readFile(join(root, 'public/models', id + '.json'), 'utf8');
    const definition = JSON.parse(source) as ShipDefinition;
    if (id !== definition.id || !definition.contentHash) throw new Error('Invalid published definition ' + id);
    const bytes = encodeRuntimeDefinition(runtimeProjection(definition)), sha256 = hash(bytes), url = '/models/runtime/' + id + '.nsd';
    const path = join(root, 'public', url);
    if (check) { if (hash(await readFile(path)) !== sha256) throw new Error('Stale runtime definition: ' + id); }
    else await Bun.write(path, bytes);
    // Menus use complete light fields. Omitted runtime fields fail closed until loaded.
    const { armor, compartments, connections, mountClearance, construction, loading, ...summary } = definition;
    const { volume, sections, ...hull } = definition.hull;
    const table = (hydrostatics.ships as Record<string, { contentHash: string }>)[id];
    let hydro: { url: string; sha256: string } | undefined;
    if (definition.hull.kind !== 'constructed-volume-v1') {
      if (table?.contentHash !== definition.contentHash) throw new Error('Stale hydrostatic table: ' + id);
      const text = JSON.stringify(table), url = '/models/runtime/' + id + '.hydro.json';
      hydro = { url, sha256: hash(text) };
      if (check) { if (hash(await readFile(join(root, 'public', url))) !== hydro.sha256) throw new Error('Stale runtime hydrostatics: ' + id); }
      else await Bun.write(join(root, 'public', url), text);
    }
    // The port rates every design against the historical fleet without loading its plates.
    const armorMaxMm = armor.reduce((n, a) => Math.max(n, a.thicknessMm), 0);
    summaries[id] = { ...summary, hull, armorMaxMm, ...(construction ? { construction: { catalogRevision: construction.catalogRevision } } : {}), runtime: { url, sha256, hydro, sourceSha256: hash(source), bytes: bytes.length } };
    ships.push({ id, contentHash: definition.contentHash, sha256, encoding: 'nsd1-base64', json: Buffer.from(bytes).toString('base64') });
  }
  // One generated record per ship, each after its own key line, so independent ship rebuilds merge as
  // separate hunks (and the git:setup driver merges the rest). Preserve hashes: they detect stale published inputs.
  const metadata = perRecordJson(summaries);
  const path = join(root, 'src/ships/presetCatalog.json');
  if (check) { if (await readFile(path, 'utf8') !== metadata) throw new Error('Stale preset metadata'); }
  else await Bun.write(path, metadata);
  return { ships, summaries };
}
if (import.meta.main) { await runtimeAssets(process.cwd(), process.argv.includes('--check')); console.log('Runtime definitions verified.'); }
