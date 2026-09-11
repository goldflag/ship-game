/** Explicit maintenance command. Solves the per-class hydrostatic lookup from
 * the compiled hulls and publishes it as content both simulations read. Rerun
 * after any hull geometry change; multiplayer:content refuses a stale table. */
import { writeFile } from 'node:fs/promises';
import { shipPresets } from '../../src/ships/presets';
import { buildHydrostaticTable } from '../../src/simulation/hydrostaticTable';
import type { ShipDefinition } from '../../src/ships/blueprint';
const ships = Object.fromEntries(Object.entries(shipPresets).map(([id, definition]) => {
  const started = performance.now();
  const table = buildHydrostaticTable((definition as unknown as ShipDefinition).hull);
  console.log(`${id}: ${((performance.now() - started) / 1000).toFixed(1)} s, ${(table.nodes.length / 1024).toFixed(0)} KiB`);
  return [id, { contentHash: (definition as { contentHash: string }).contentHash, ...table }];
}));
await writeFile('assets/gameplay/hydrostatics.v1.json', JSON.stringify({ version: 1, ships }) + '\n');
