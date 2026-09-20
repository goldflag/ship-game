import { test, expect } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { inspectEquipmentModel } from './equipment';
import type { ConstructionCatalog } from '../../src/ships/blueprint';

// Whole highest-detail published assemblies at origin/master 13e3e07.
// Budgets are individual: shields, canvas, mechanisms and bearings all count.
const ceilings: Record<string, number> = {
  'us-5in38-mk30-mod0-single': 3372,
  'us-6in47-mk16-cleveland': 2224,
  'skc34-203-twin': 1756,
  'skc34-203-twin-rf': 1876,
  'us-5in38-mk21-single': 1308,
  'type3-127-typec-twin': 6460,
  'type3-203-mogami-e3-twin': 3406,
  'type3-203-mogami-e-twin': 3666,
  'us-8in55-mk12-triple': 3756,
};
const root = resolve(import.meta.dir, '../..');
const catalog = JSON.parse(await readFile(resolve(root, 'public/models/components/catalog.json'), 'utf8')) as ConstructionCatalog;
for (const [id, ceiling] of Object.entries(ceilings)) {
  test(`${id}: entire published main battery remains within its triangle ceiling`, async () => {
    const part = catalog.equipment.find(p => p.id === id)!;
    expect(part).toBeDefined();
    const weapon = catalog.weapons.parts.find(p => p.id === part.gunPartId)!;
    const model = await readFile(resolve(root, 'public', part.modelUrl.replace(/^\//, '')));
    const inspection = inspectEquipmentModel(model, part.contentHash, part, weapon);
    expect(inspection.triangles).toBeGreaterThan(0);
    expect(inspection.triangles).toBeLessThanOrEqual(ceiling);
  });
}
