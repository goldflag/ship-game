import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { readEquipment, inspectEquipmentModel } from './equipment';
import catalog from '../../public/models/components/catalog.json';

const root = resolve(import.meta.dir, '../..');

test('plain utility fittings stay within 500 exported triangles and retain their attachment sockets', async () => {
  const { equipment, registry } = await readEquipment(root);
  const utility = equipment.filter(part => {
    const entry = registry.components.find(entry => entry.partId === part.id);
    return entry && registry.builders[entry.builder].path.endsWith('/utility_fittings.py');
  });
  expect(utility.length).toBeGreaterThan(0);
  for (const source of utility) {
    const part = catalog.equipment.find(part => part.id === source.id)!;
    const bytes = await readFile(join(root, 'public', part.modelUrl));
    const model = inspectEquipmentModel(bytes, part.contentHash, source);
    expect(model.triangles, source.id).toBeLessThanOrEqual(500);
    for (const socket of source.sockets ?? []) {
      const node = model.nodes.find(node => node.id === `component.socket.${socket.id}`)!;
      socket.position.forEach((value, axis) =>
        expect(node.worldMatrix[12 + axis], `${source.id}/${socket.id}`).toBeCloseTo(value, 6));
    }
  }
});
