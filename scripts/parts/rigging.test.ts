import { expect, test } from 'bun:test';
import { inflateSync } from 'node:zlib';
import type { AuthoredSurface, ConstructionCatalog } from '../../src/ships/blueprint';
import catalogJson from '../../public/models/components/catalog.json';
import { inspectEquipmentModel } from './equipment';
import { riggingSurface } from './rigging';

test('published attachment surfaces retain every original triangle and component transform', async () => {
  const catalog = catalogJson as ConstructionCatalog;
  expect(JSON.stringify(catalog).length).toBeLessThan(4_000_000);
  for (const part of catalog.equipment.filter(p => p.kind === 'mast' || p.id === 'generic-twin-bitts')) {
    const bytes = Buffer.from(await Bun.file(`public${part.modelUrl}`).arrayBuffer());
    const surface: AuthoredSurface = { vertices: [], triangles: [] };
    inspectEquipmentModel(bytes, part.contentHash, part, undefined, surface);
    expect(riggingSurface(bytes, part.contentHash, part)).toEqual(part.riggingSurface);
    const packed = inflateSync(Buffer.from(part.riggingSurface!.data, 'base64'));
    const count = packed.readUInt32LE(0), triangles = packed.readUInt32LE(4);
    expect(triangles).toBe(surface.triangles.length);
    expect(packed.length).toBe(8 + 12 * (count + triangles));
    for (let t = 0; t < triangles; t++) for (let corner = 0; corner < 3; corner++) {
      const index = packed.readUInt32LE(8 + count * 12 + t * 12 + corner * 4);
      for (let axis = 0; axis < 3; axis++) expect(packed.readFloatLE(8 + index * 12 + axis * 4)).toBe(Math.fround(surface.vertices[surface.triangles[t][corner]][axis]));
    }
  }
  expect(catalog.equipment.filter(p => p.path || p.kind === 'gun' || p.placement === 'internal').every(p => !p.riggingSurface)).toBe(true);
});
