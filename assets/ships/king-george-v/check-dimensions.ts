/** Independent measurements of the published geometry, not blueprint echoing.
 * Run: bun assets/ships/king-george-v/check-dimensions.ts
 */
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Box3, Mesh, Vector3 } from 'three';
import { resolve } from 'node:path';

const root = resolve(import.meta.dir, '../../..');
// Three's buffer loader reports progress through this browser event type.
if (!globalThis.ProgressEvent) Object.defineProperty(globalThis, 'ProgressEvent', {
  value: class extends Event { constructor(type: string, init: object) { super(type); Object.assign(this, init); } },
});
const bytes = await Bun.file(resolve(root, 'public/models/king-george-v.glb')).arrayBuffer();
const view = new DataView(bytes), jsonLength = view.getUint32(12, true);
const gltf = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, jsonLength)));
const binaryOffset = 20 + jsonLength + 8;
gltf.buffers[0].uri = `data:application/octet-stream;base64,${Buffer.from(bytes, binaryOffset).toString('base64')}`;
// Geometry-only loading avoids browser image APIs. Materials do not affect dimensions.
delete gltf.images; delete gltf.textures; delete gltf.materials;
for (const mesh of gltf.meshes) for (const primitive of mesh.primitives) delete primitive.material;
const loaded = await new GLTFLoader().parseAsync(JSON.stringify(gltf), '');
loaded.scene.updateMatrixWorld(true);
const triangles: Vector3[][] = [];
loaded.scene.traverse(object => {
  if (object.userData.nodeId !== 'hull.surface') return;
  object.traverse(child => {
    if (!(child instanceof Mesh)) return;
    const geometry = child.geometry, positions = geometry.getAttribute('position');
    const count = geometry.index?.count ?? positions.count;
    for (let i = 0; i < count; i += 3) triangles.push([0, 1, 2].map(j =>
      new Vector3().fromBufferAttribute(positions, geometry.index?.getX(i + j) ?? i + j).applyMatrix4(child.matrixWorld)));
  });
});
if (!triangles.length) throw new Error('Published hull.surface has no geometry');
const bounds = new Box3().setFromPoints(triangles.flat());
function section(axis: 'y' | 'z', value: number) {
  const points: Vector3[] = [];
  for (const triangle of triangles) for (let i = 0; i < 3; i++) {
    const a = triangle[i], b = triangle[(i + 1) % 3], da = a[axis] - value, db = b[axis] - value;
    if (Math.abs(da) < 1e-6) points.push(a.clone());
    if (da * db < 0) points.push(a.clone().lerp(b, da / (da - db)));
  }
  if (!points.length) throw new Error(`No hull intersection at ${axis}=${value}`);
  return new Box3().setFromPoints(points);
}
const waterline = section('y', 0), midship = section('z', 0);
const measures = [
  { id: 'length-overall', expectedM: 227.08, measuredM: bounds.max.z - bounds.min.z, source: 'rmg-b9, 745 ft 0.13 in rounded to cm' },
  { id: 'hull-beam', expectedM: 31.3944, measuredM: bounds.max.x - bounds.min.x, source: 'rmg-slr1553, 103 ft; B9 lists a conflicting extreme envelope' },
  { id: 'standard-mean-draft', expectedM: 8.8392, measuredM: -bounds.min.y, source: 'rmg-b9, 1940 standard mean 29 ft; not a May 1941 deep-load claim' },
  { id: 'waterline-length', expectedM: 225.6, measuredM: waterline.max.z - waterline.min.z, source: 'rmg-b9, 740 ft 0.25 in rounded to dm; datum uncertainty recorded' },
  { id: 'midship-depth', expectedM: 15.5773, measuredM: midship.max.y - midship.min.y, source: 'rmg-b9, depth at side 51 ft 1.31 in' },
].map(m => ({ ...m, errorM: m.measuredM - m.expectedM, toleranceM: 0.025, passed: Math.abs(m.measuredM - m.expectedM) <= 0.025 }));
const report = {
  contentHash: gltf.scenes[gltf.scene ?? 0].extras.definitionHash,
  method: 'Triangle intersections of exported hull.surface at runtime Y=0 and Z=0; actual transformed vertices.',
  measures,
  historicalAccuracy: 'These five dimensions are checked. Hull lines, surface offsets and equipment details remain unverified; this is not historical certification.',
};
await Bun.write(resolve(import.meta.dir, '../../../.build/ships/king-george-v/dimensions.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (measures.some(m => !m.passed)) process.exitCode = 1;
