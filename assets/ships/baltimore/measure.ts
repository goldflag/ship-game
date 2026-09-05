/** Independent measurements of actual exported vertices at the documented datum.
 * Run after ship:build: bun assets/ships/baltimore/measure.ts
 * A matched envelope is not evidence that the intervening hull form is correct.
 */
import { Matrix4, Quaternion, Vector3 } from 'three';
import { createHash } from 'node:crypto';

const bytes = await Bun.file(new URL('../../../public/models/baltimore.glb', import.meta.url)).arrayBuffer();
const data = new DataView(bytes);
if (data.getUint32(0, true) !== 0x46546c67 || data.getUint32(4, true) !== 2) throw new Error('Expected GLB 2');
const jsonLength = data.getUint32(12, true);
const gltf = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, jsonLength)));
const binaryOffset = 20 + jsonLength + 8;
const worlds = new Map<number, Matrix4>();
function walk(index: number, parent: Matrix4) {
  const n = gltf.nodes[index];
  const local = n.matrix ? new Matrix4().fromArray(n.matrix) : new Matrix4().compose(
    new Vector3().fromArray(n.translation ?? [0, 0, 0]),
    new Quaternion().fromArray(n.rotation ?? [0, 0, 0, 1]),
    new Vector3().fromArray(n.scale ?? [1, 1, 1]),
  );
  const world = parent.clone().multiply(local);
  worlds.set(index, world);
  n.children?.forEach((child: number) => walk(child, world));
}
gltf.scenes[gltf.scene ?? 0].nodes.forEach((index: number) => walk(index, new Matrix4()));
function accessor(index: number): number[][] {
  const a = gltf.accessors[index], v = gltf.bufferViews[a.bufferView];
  if (v.buffer !== 0 || a.sparse) throw new Error('Unsupported external or sparse accessor');
  const components = ({ SCALAR: 1, VEC3: 3 } as Record<string, number>)[a.type];
  const size = ({ 5121: 1, 5123: 2, 5125: 4, 5126: 4 } as Record<number, number>)[a.componentType];
  if (!components || !size) throw new Error('Unsupported accessor type');
  const start = binaryOffset + (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
  return Array.from({ length: a.count }, (_, i) => Array.from({ length: components }, (_, j) => {
    const offset = start + i * (v.byteStride ?? components * size) + j * size;
    switch (a.componentType) {
      case 5121: return data.getUint8(offset);
      case 5123: return data.getUint16(offset, true);
      case 5125: return data.getUint32(offset, true);
      default: return data.getFloat32(offset, true);
    }
  }));
}
const index = gltf.nodes.findIndex((n: { extras?: { nodeId?: string } }) => n.extras?.nodeId === 'hull.surface');
if (index < 0) throw new Error('Missing hull.surface');
const positions: Vector3[] = [], waterline: Vector3[] = [];
for (const primitive of gltf.meshes[gltf.nodes[index].mesh].primitives) {
  if ((primitive.mode ?? 4) !== 4) throw new Error('Expected triangle primitive');
  const points = accessor(primitive.attributes.POSITION).map(p => new Vector3().fromArray(p).applyMatrix4(worlds.get(index)!));
  positions.push(...points);
  const indices = primitive.indices === undefined ? points.map((_, i) => i) : accessor(primitive.indices).flat();
  for (let i = 0; i < indices.length; i += 3) {
    const triangle = indices.slice(i, i + 3).map((j: number) => points[j]);
    for (let edge = 0; edge < 3; edge++) {
      const a = triangle[edge], b = triangle[(edge + 1) % 3];
      if (Math.abs(a.y) < 1e-6) waterline.push(a);
      if (a.y * b.y < 0) waterline.push(a.clone().lerp(b, -a.y / (b.y - a.y)));
    }
  }
}
function bounds(points: Vector3[]) {
  if (!points.length) throw new Error('No measured points');
  const min = new Vector3(Infinity, Infinity, Infinity), max = min.clone().negate();
  points.forEach(p => { min.min(p); max.max(p); });
  return { min: min.toArray(), max: max.toArray(), size: max.clone().sub(min).toArray() };
}
const envelope = bounds(positions), waterlineBounds = bounds(waterline);
const reference = await Bun.file(new URL('./references/measurements.json', import.meta.url)).json();
const measured: Record<string, number> = {
  'length-overall': envelope.size[2],
  'beam-extreme': envelope.size[0],
  'limiting-keel-draft': -envelope.min[1],
  'length-waterline': waterlineBounds.size[2],
};
const comparisons = reference.dimensions.filter((d: { id: string }) => d.id in measured).map((d: { id: string; value: number; source: string }) => ({
  id: d.id, measuredM: measured[d.id], documentedM: d.value,
  errorM: measured[d.id] - d.value, toleranceM: .005,
  pass: Math.abs(measured[d.id] - d.value) <= .005, source: d.source,
}));
const report = {
  definitionHash: gltf.scenes[gltf.scene ?? 0].extras?.definitionHash,
  glbSha256: createHash('sha256').update(new Uint8Array(bytes)).digest('hex'),
  method: 'Decode GLB POSITION and index buffers, apply full scene transforms, intersect hull triangles with runtime Y=0. No accessor bounding-box metadata used.',
  units: 'meters', envelope, waterlineBounds, comparisons,
  historicalAccuracy: 'Envelope and waterline length only; body-plan offsets and waterline endpoint stations remain unresolved.',
};
await Bun.write(new URL('./reports/dimensions.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (comparisons.some((c: { pass: boolean }) => !c.pass)) process.exitCode = 1;
