/** Prefetch public geometry-only comparison references into the ignored local cache. */
import { resolve } from 'node:path';
import { catalogComparison, loadComponentReference } from '../../tools/ship-overlay/catalog-reference';
const root = resolve(import.meta.dir, '../..');
const selected = new Set(process.argv.slice(2));
const catalog = await catalogComparison(root);
const items = catalog.items.filter(item => !selected.size || selected.has(item.id));
for (const id of selected) if (!items.some(item => item.id === id)) throw new Error(`Unknown comparison component: ${id}`);
for (const item of items) {
  if (item.reference?.referenceGlb || !item.reference?.resource || item.reference.match === 'missing') {
    console.log(`${item.id}: ${item.reference?.referenceGlb ? 'extracted GLB; run python3 scripts/parts/extract-comparison-equipment.py' : 'no raw reference available'}`);
    continue;
  }
  try {
    const pack = await loadComponentReference(root, item.id);
    const triangles = Object.values(pack.models).reduce((sum, model) => sum + Object.values(model.geometry).reduce((sum, geometry) => sum + geometry.index.length / 3, 0), 0);
    console.log(`${item.id}: ${triangles} source triangles cached`);
  } catch (error) {
    console.error(`${item.id}: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
