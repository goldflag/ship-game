/** Read-only proof that a pipeline-only rebuild preserves the reviewed convoy.
 * Run from the repo root: bun assets/ships/convoy/verify-merge-continuity.ts <reviewed-commit>
 * Prints evidence; does not rewrite hashes or relabel earlier screenshots.
 */
import { createHash } from 'node:crypto';

const base = process.argv[2];
if (!base || !/^[0-9a-f]{7,40}$/.test(base)) throw new Error('Supply the reviewed Git commit hash');
const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
function previous(path: string) {
  const result = Bun.spawnSync(['git', 'show', `${base}:${path}`]);
  if (result.exitCode) throw new Error(`Cannot read ${path} at ${base}`);
  return Buffer.from(result.stdout);
}
function glb(bytes: Buffer) {
  if (bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) throw new Error('Invalid GLB');
  const jsonLength = bytes.readUInt32LE(12);
  const document = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
  const hashes = document.scenes.map((scene: { extras?: { definitionHash?: string } }) => scene.extras?.definitionHash);
  // Scene metadata is the only permitted JSON change. Geometry, materials,
  // transforms, sockets, and animations must still compare exactly.
  for (const scene of document.scenes) if (scene.extras) delete scene.extras.definitionHash;
  const binary = bytes.subarray(28 + jsonLength);
  return { document, binary, hashes, sceneHash: sha(JSON.stringify(document)), binaryHash: sha(binary) };
}

function compareBinary(before: ReturnType<typeof glb>, after: ReturnType<typeof glb>) {
  // Blender's UV generator can round a coordinate by one float32 ULP on rebuild.
  // Permit at most 1e-7 in UVs only. All positions, normals, indices, embedded
  // images and other binary bytes remain subject to exact equality.
  const normalized = Buffer.from(after.binary);
  const uvAccessors = new Set<number>();
  for (const mesh of before.document.meshes) for (const primitive of mesh.primitives) {
    for (const [name, index] of Object.entries(primitive.attributes)) if (/^TEXCOORD_\d+$/.test(name)) uvAccessors.add(index as number);
  }
  let roundedUvComponents = 0, maximumUvDelta = 0;
  for (const index of uvAccessors) {
    const accessor = before.document.accessors[index];
    if (accessor.componentType !== 5126 || accessor.type !== 'VEC2' || accessor.sparse) throw new Error('Unsupported UV accessor');
    const view = before.document.bufferViews[accessor.bufferView];
    for (let vertex = 0; vertex < accessor.count; vertex++) for (let component = 0; component < 2; component++) {
      const offset = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0) + vertex * (view.byteStride ?? 8) + component * 4;
      const delta = Math.abs(before.binary.readFloatLE(offset) - after.binary.readFloatLE(offset));
      if (delta > 0 && delta <= 1e-7) {
        before.binary.copy(normalized, offset, offset, offset + 4);
        roundedUvComponents++; maximumUvDelta = Math.max(maximumUvDelta, delta);
      }
    }
  }
  return { equivalent: before.binary.equals(normalized), rawBytesIdentical: before.binary.equals(after.binary), roundedUvComponents, maximumUvDelta };
}

const ships = [];
for (const id of ['liberty-cargo', 'liberty-collier', 'victory-cargo', 'flower-corvette']) {
  const path = `public/models/${id}`;
  const before = JSON.parse(previous(`${path}.json`).toString());
  const after = await Bun.file(`${path}.json`).json();
  const { contentHash: beforeHash, ...beforeDefinition } = before;
  const { contentHash: afterHash, ...afterDefinition } = after;
  const oldGlb = glb(previous(`${path}.glb`));
  const newGlb = glb(Buffer.from(await Bun.file(`${path}.glb`).arrayBuffer()));
  const binary = compareBinary(oldGlb, newGlb);
  const checks = {
    simulationDefinitionUnchanged: JSON.stringify(beforeDefinition) === JSON.stringify(afterDefinition),
    sceneUnchangedExceptDefinitionHash: oldGlb.sceneHash === newGlb.sceneHash,
    binaryUnchangedExceptUvFloatRounding: binary.equivalent,
    definitionHashesMatchExports: oldGlb.hashes.every((h: string) => h === beforeHash) && newGlb.hashes.every((h: string) => h === afterHash),
  };
  if (!Object.values(checks).every(Boolean)) throw new Error(`${id}: continuity failed: ${JSON.stringify(checks)}`);
  ships.push({ id, beforeHash, afterHash, checks, binary, sceneHash: newGlb.sceneHash, binaryHash: newGlb.binaryHash });
}
console.log(JSON.stringify({ schemaVersion: 1, reviewedCommit: base, ships, note: 'Exact geometry/scene continuity with up to 1e-7 UV float rounding, not a new historical or live-browser review.' }, null, 2));
