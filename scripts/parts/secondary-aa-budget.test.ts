import { test, expect } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { inspectEquipmentModel } from './equipment';
import type { ConstructionCatalog } from '../../src/ships/blueprint';

// Complete highest-detail assemblies published at origin/master 13e3e07.
// Each limit includes every barrel, shield, mechanism, seat, sight and base.
const ceilings: Record<string, number> = {
  'us-20mm-oerlikon-mk4-hsienyang': 4456,
  'skc33-105-c31-twin': 3614,
  'flak-37-bismarck-1941': 2960,
  'flak38-m43u-20-twin': 2400,
  'flak38-20-single': 2924,
  'flak28-40-single': 2624,
  'us-11in75-quad': 1764,
  'us-3in50-single': 1308,
  'qf-2pdr-mkvi-octuple': 3024,
  'type96-25-triple': 4992,
  'type96-25-triple-shielded': 5852,
  'type96-25-mogami-2': 4116,
  'us-40mm-bofors-mk1-iowa': 6200,
  'us-20mm-oerlikon-mk24-hsienyang': 7092,
  'us-5in38-mk32-mod12': 2588,
  'type93-13-twin': 3496,
  'type93-13-single': 1796,
  'type3-155-triple': 4584,
  'qf-525-mki-twin': 2742,
  'sk-c28-150-twin': 2300,
  'flak-105-bismarck-1941': 3614,
  'type41-152-kongo-casemate': 2364,
  'type96-25-kongo-3': 4272,
  'type96-25-kongo-2': 3344,
  'type96-25-kongo-single': 1364,
  'type89-127-a1-twin': 5072,
  'type89-127-a1-mod2-twin': 5520,
};
const root = resolve(import.meta.dir, '../..');
const catalog = JSON.parse(await readFile(resolve(root, 'public/models/components/catalog.json'), 'utf8')) as ConstructionCatalog;
for (const [id, ceiling] of Object.entries(ceilings)) {
  test(`${id}: entire published secondary/AA assembly stays within its own ceiling`, async () => {
    const part = catalog.equipment.find(p => p.id === id)!;
    expect(part).toBeDefined();
    const weapon = catalog.weapons.parts.find(p => p.id === part.gunPartId)!;
    const model = await readFile(resolve(root, 'public', part.modelUrl.replace(/^\//, '')));
    const inspection = inspectEquipmentModel(model, part.contentHash, part, weapon);
    expect(inspection.triangles).toBeGreaterThan(0);
    expect(inspection.triangles).toBeLessThanOrEqual(ceiling);
  });
}
