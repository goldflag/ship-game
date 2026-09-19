import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { readEquipment, inspectEquipmentModel } from './equipment';
import catalog from '../../public/models/components/catalog.json';

test('published lifesaving props retain their wall relief, rear attachment and low-poly budget', async () => {
  const { equipment, registry } = await readEquipment(resolve(import.meta.dir, '../..'));
  const fittings = equipment.filter(part => {
    const entry = registry.components.find(entry => entry.partId === part.id);
    return entry && registry.builders[entry.builder].path.endsWith('/life_saving.py');
  });
  expect(fittings.length).toBe(3);
  for (const source of fittings) {
    const part = catalog.equipment.find(part => part.id === source.id)!;
    const bytes = await readFile('public' + part.modelUrl);
    const model = inspectEquipmentModel(bytes, part.contentHash, source);
    expect(model.triangles, source.id).toBeLessThan(1000);
    expect(bytes.length, source.id).toBeLessThan(100_000);
    expect(model.textureCount, source.id).toBe(0);
    const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
    expect(gltf.nodes.some((node: { extras?: { wallRelief?: boolean } }) => node.extras?.wallRelief), source.id).toBe(true);
    const socket = model.nodes.find(node => node.id === 'component.socket.attachment')!;
    expect(socket.worldMatrix.slice(12, 15)).toEqual([0, 0, 0]);
    // Brackets touch the wall plane and all visible geometry projects outward.
    expect(model.boundsCenter[2] + model.size[2] / 2).toBeCloseTo(0, 6);
    expect(model.size[2]).toBeGreaterThan(.2);
  }
});
