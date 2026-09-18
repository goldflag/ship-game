import { deflateSync } from 'node:zlib';
import type { AuthoredSurface, ConstructionEquipmentPart, Vec3 } from '../../src/ships/blueprint';
import { inspectEquipmentModel, type EquipmentSource } from './equipment';

/** Retain every exported triangle, including holes and separate members. Packed
 * float32 coordinates match GLB precision without swelling every catalog load. */
export function riggingSurface(bytes: Buffer, hash: string, part: EquipmentSource): ConstructionEquipmentPart['riggingSurface'] {
  if (part.placement !== 'deck' || part.path || part.wallMount || !['mast', 'director', 'funnel', 'deck-fitting'].includes(part.kind)) return;
  const surface: AuthoredSurface = { vertices: [], triangles: [] };
  inspectEquipmentModel(bytes, hash, part, undefined, surface);
  const vertices: Vec3[] = [], byPosition = new Map<string, number>();
  const remap = surface.vertices.map(point => {
    const vertex = point.map(Math.fround) as Vec3, key = vertex.join(',');
    let index = byPosition.get(key);
    if (index === undefined) { index = vertices.length; vertices.push(vertex); byPosition.set(key, index); }
    return index;
  });
  const packed = Buffer.alloc(8 + vertices.length * 12 + surface.triangles.length * 12);
  packed.writeUInt32LE(vertices.length, 0); packed.writeUInt32LE(surface.triangles.length, 4);
  let offset = 8;
  for (const vertex of vertices) for (const v of vertex) { packed.writeFloatLE(v, offset); offset += 4; }
  for (const triangle of surface.triangles) for (const i of triangle) { packed.writeUInt32LE(remap[i], offset); offset += 4; }
  return { encoding: 'deflate-f32-u32-v1', data: deflateSync(packed, { level: 9 }).toString('base64') };
}
