/** Explicit maintenance command. Solves the per-class hydrostatic lookup from
 * the compiled hulls and publishes it as content both simulations read. Rerun
 * after any hull geometry change; multiplayer:content refuses a stale table. */
import { writeFile } from 'node:fs/promises';
import { presetIds } from './runtime-assets';
import { buildHydrostaticTable } from './hydrostaticTable';
import type { ShipDefinition } from '../../src/ships/blueprint';
// Maintenance must read published definitions directly: runtime admission rejects
// the stale lookup that this command is responsible for rebuilding.
const definitions = await Promise.all((await presetIds()).map(async id =>
  [id, await Bun.file(`public/models/${id}.json`).json() as ShipDefinition] as const));
const ships = Object.fromEntries(definitions.filter(([, definition]) => definition.hull.kind !== 'constructed-volume-v1').map(([id, definition]) => {
  const started = performance.now();
  const table = buildHydrostaticTable((definition as unknown as ShipDefinition).hull);
  console.log(`${id}: ${((performance.now() - started) / 1000).toFixed(1)} s, ${(table.nodes.length / 1024).toFixed(0)} KiB`);
  return [id, { contentHash: (definition as { contentHash: string }).contentHash, ...table }];
}));
await writeFile('assets/gameplay/hydrostatics.v1.json', JSON.stringify({ version: 1, ships }) + '\n');
