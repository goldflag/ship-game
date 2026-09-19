import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { inspectEquipmentModel, readEquipment } from './equipment';
import catalog from '../../public/models/components/catalog.json';

test('published ship doors keep a small geometry budget and their wall attachment datums', async () => {
  const root = resolve(import.meta.dir, '../..'), { equipment } = await readEquipment(root);
  for (const id of ['generic-utility-door', 'generic-watertight-door', 'generic-windowed-door']) {
    const source = equipment.find(part => part.id === id)!;
    const part = catalog.equipment.find(part => part.id === id)!;
    const bytes = await readFile(join(root, 'public', part.modelUrl));
    const model = inspectEquipmentModel(bytes, part.contentHash, source);
    expect(model.triangles, id).toBeLessThanOrEqual(id === 'generic-watertight-door' ? 900 : 1200);
    const socket = model.nodes.find(node => node.id === 'component.socket.attachment')!;
    expect(socket.worldMatrix.slice(12, 15), id).toEqual([0, 0, 0]);
  }
});
