/** Independent measurements of the published geometry, not blueprint echoing.
 * Run: bun assets/ships/yamato/check-dimensions.ts
 */
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Box3, Mesh, Vector3 } from 'three';
import { resolve } from 'node:path';

const root = resolve(import.meta.dir, '../../..');
// Three's buffer loader reports progress through this browser event type.
if (!globalThis.ProgressEvent) Object.defineProperty(globalThis, 'ProgressEvent', {
  value: class extends Event { constructor(type: string, init: object) { super(type); Object.assign(this, init); } },
});
const bytes = await Bun.file(resolve(root, 'public/models/yamato.glb')).arrayBuffer();
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
  { id: 'length-overall', expectedM: 263, measuredM: bounds.max.z - bounds.min.z, source: 'kure-museum-data; usntmj-s062 p.10' },
  { id: 'extreme-beam', expectedM: 38.9, measuredM: bounds.max.x - bounds.min.x, source: 'kure-museum-data summary; tamiya-principal-dimensions p.2; S-06-2 differs by 0.1 m' },
  { id: 'trial-draft', expectedM: 10.4, measuredM: -bounds.min.y, source: 'usntmj-s062 p.10' },
  { id: 'waterline-length', expectedM: 256, measuredM: waterline.max.z - waterline.min.z, source: 'usntmj-s062 p.10' },
  { id: 'waterline-beam', expectedM: 36.9, measuredM: waterline.max.x - waterline.min.x, source: 'usntmj-s062 p.10' },
  { id: 'midship-depth', expectedM: 18.915, measuredM: midship.max.y - midship.min.y, source: 'tamiya-principal-dimensions p.2; moulded/outer-skin distinction unresolved' },
].map(m => ({ ...m, errorM: m.measuredM - m.expectedM, toleranceM: 0.025, passed: Math.abs(m.measuredM - m.expectedM) <= 0.025 }));
const report = {
  contentHash: gltf.scenes[gltf.scene ?? 0].extras.definitionHash,
  method: 'Triangle intersections of exported hull.surface at runtime Y=0 and Z=0; actual transformed vertices.',
  measures,
  historicalAccuracy: 'These six dimensions are checked. Hull lines, surface offsets and equipment details remain unverified; this is not 100 percent historical certification.',
};
await Bun.write(resolve(import.meta.dir, 'reports/dimensions.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (measures.some(m => !m.passed)) process.exitCode = 1;
