import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { inspectEquipmentModel } from './equipment';
import baseline from '../../tools/ship-overlay/component-before.json';
import catalog from '../../public/models/components/catalog.json';

const root = resolve(import.meta.dir, '../..');
async function inspect(url: string) {
  const bytes = await readFile(resolve(root, 'public', url.slice(1)));
  const doc = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  return inspectEquipmentModel(bytes, doc.scenes[doc.scene ?? 0].extras.definitionHash);
}
for (const gun of catalog.weapons.parts.filter(gun => gun.caliberM >= .3048)) {
  const part = catalog.equipment.find(part => 'gunPartId' in part && part.gunPartId === gun.id);
  if (!part) continue;
  test(`${gun.id}: complete published geometry stays within its merged baseline and retains the rig`, async () => {
    const before = baseline[gun.id as keyof typeof baseline];
    expect(before).toBeDefined();
    const [oldModel, model] = await Promise.all([inspect(before.modelUrl), inspect(part.modelUrl)]);
    // The inspection visits every mesh instance and primitive, including covers
    // and fittings. Morph targets do not multiply a surface's triangle count.
    expect(oldModel.triangles).toBe(before.triangles);
    expect(model.triangles).toBeLessThanOrEqual(before.triangles);
    const rig = (nodes: typeof model.nodes) => nodes.filter(node => /\.(yaw|elevation|recoil|muzzle)$/.test(node.id));
    expect(rig(model.nodes)).toEqual(rig(oldModel.nodes));
  });
}
