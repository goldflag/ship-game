import { createHash } from 'node:crypto';
import type { ShipDefinition } from '../../src/ships/blueprint';

/** Stable keys, exact numbers and array order: never round gameplay geometry. */
export function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, entry) => entry && typeof entry === 'object' && !Array.isArray(entry)
    ? Object.fromEntries(Object.keys(entry).sort().map(key => [key, entry[key]])) : entry);
}
export const hash = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
type Chunk = { type: number; bytes: Buffer };
function decodeGlb(bytes: Buffer) {
  if (bytes.length < 20 || bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) throw new Error('Invalid construction GLB header');
  const chunks: Chunk[] = [];
  for (let offset = 12; offset < bytes.length;) {
    if (offset + 8 > bytes.length) throw new Error('Truncated GLB chunk');
    const length = bytes.readUInt32LE(offset), type = bytes.readUInt32LE(offset + 4);
    if (length % 4 || offset + 8 + length > bytes.length) throw new Error('Invalid GLB chunk length');
    chunks.push({ type, bytes: bytes.subarray(offset + 8, offset + 8 + length) }); offset += 8 + length;
  }
  if (chunks[0]?.type !== 0x4e4f534a || chunks.slice(1).some(c => c.type === 0x4e4f534a)) throw new Error('Missing or duplicate GLB JSON');
  return { gltf: JSON.parse(chunks[0].bytes.toString()), chunks: chunks.slice(1) };
}
export function encodeGlb(gltf: unknown, chunks: Chunk[]) {
  const json = Buffer.from(canonical(gltf)), padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 0x20); json.copy(padded);
  const all = [{ type: 0x4e4f534a, bytes: padded }, ...chunks];
  const bytes = Buffer.alloc(12 + all.reduce((n, c) => n + 8 + c.bytes.length, 0));
  bytes.writeUInt32LE(0x46546c67, 0); bytes.writeUInt32LE(2, 4); bytes.writeUInt32LE(bytes.length, 8);
  let offset = 12;
  for (const chunk of all) { bytes.writeUInt32LE(chunk.bytes.length, offset); bytes.writeUInt32LE(chunk.type, offset + 4); chunk.bytes.copy(bytes, offset + 8); offset += 8 + chunk.bytes.length; }
  return bytes;
}
function setIdentity(gltf: any, identity: string) {
  const scene = gltf.scenes?.[gltf.scene ?? 0];
  if (!scene?.extras || typeof scene.extras.definitionHash !== 'string' || !Array.isArray(scene.nodes)) throw new Error('Missing construction scene identity');
  scene.extras.definitionHash = identity;
  // Only the exported scene and its immediate model root carry the preset
  // identity. Retained component identities deeper in the graph stay intact.
  for (const index of scene.nodes) {
    const node = gltf.nodes?.[index];
    if (!node) throw new Error('Missing construction model root');
    if (typeof node.extras?.definitionHash === 'string') node.extras.definitionHash = identity;
  }
}
export function sealModel(candidate: Buffer, contentHash: string) {
  const { gltf, chunks } = decodeGlb(candidate); setIdentity(gltf, contentHash);
  return encodeGlb(gltf, chunks);
}
export const modelPayloadHash = (bytes: Buffer) => createHash('sha256').update(sealModel(bytes, '')).digest('hex');
export function definitionData(definition: ShipDefinition, id: string) {
  const { contentHash: _nativeBuildIdentity, ...data } = definition;
  return { ...data, id, modelUrl: '/models/' + id + '.glb' };
}
/** The draft's native build identity remains untouched; presets identify output. */
export function publishedDefinition(definition: ShipDefinition, id: string, model: Buffer): ShipDefinition {
  const data = definitionData(definition, id);
  return { ...data, contentHash: hash([data, modelPayloadHash(model)]) };
}
