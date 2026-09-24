/** Explicit maintenance command. Solves the per-class hydrostatic lookup from
 * the compiled hulls and publishes it as content both simulations read. Rerun
 * after any hull geometry change; multiplayer:content refuses a stale table.
 * `ship:hydrostatics <id…>` re-solves only those ships' stale tables and keeps
 * the rest, which is what `ship:build <id>` does after publishing. */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { presetIds } from './runtime-assets';
import { buildHydrostaticTable } from './hydrostaticTable';
import { perRecordJson } from '../git/json-format';
import type { ShipDefinition } from '../../src/ships/blueprint';

const TABLES = 'assets/gameplay/hydrostatics.v1.json';

/** Rewrites the table file in roster order, as the full command does. Returns the re-solved ships. */
export async function refreshHydrostatics(root: string, only?: string[], log = console.log): Promise<string[]> {
  const roster = await presetIds(root);
  const unknown = only?.filter(id => !roster.includes(id)) ?? [];
  if (unknown.length) throw new Error(`Not in src/ships/presets.ts: ${unknown.join(', ')}`);
  const current = only ? (JSON.parse(await readFile(join(root, TABLES), 'utf8')) as { ships: Record<string, { contentHash: string }> }).ships : {};
  const ships: Record<string, unknown> = {}, solved: string[] = [];
  for (const id of roster) {
    if (only && !only.includes(id)) { if (current[id]) ships[id] = current[id]; continue; }
    // Maintenance must read published definitions directly: runtime admission rejects
    // the stale lookup that this command is responsible for rebuilding.
    const definition = JSON.parse(await readFile(join(root, 'public/models', id + '.json'), 'utf8')) as ShipDefinition & { contentHash: string };
    if (definition.hull.kind === 'constructed-volume-v1') continue;
    if (only && current[id]?.contentHash === definition.contentHash) { ships[id] = current[id]; continue; }
    const started = performance.now();
    const table = buildHydrostaticTable(definition.hull);
    log(`${id}: ${((performance.now() - started) / 1000).toFixed(1)} s, ${(table.nodes.length / 1024).toFixed(0)} KiB`);
    ships[id] = { contentHash: definition.contentHash, ...table };
    solved.push(id);
  }
  // One ship per line, as in presetCatalog.json, so rebuilds of different ships merge.
  if (!only || solved.length) await writeFile(join(root, TABLES), perRecordJson({ version: 1, ships }, ['ships']));
  return solved;
}

if (import.meta.main) {
  const ids = process.argv.slice(2);
  await refreshHydrostatics(process.cwd(), ids.length ? ids : undefined);
}
