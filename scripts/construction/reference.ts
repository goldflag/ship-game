import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ReferenceNode, ReferencePack } from '../../tools/ship-overlay/reference';

/** A reference mesh cache in ship coordinates: +X starboard, +Y up with y = 0 the waterline, −Z bow, metres.
 * Raw World of Warships units convert at 15 m per unit with source +Z reflected to runtime −Z, the same
 * conversion the model viewer uses. Caches live in ignored `.build/references/<name>/` and are never committed. */
export const REFERENCE_FORMAT = 2;
export const METRES_PER_UNIT = 15;
export const REFERENCE_ROOT = '.build/references';
export type Vec3 = [number, number, number];
export interface Box {
  min: Vec3;
  max: Vec3;
}
/** One source visual instance. `first`/`count` index into the cached triangle list; hull parts come first. */
export interface ReferencePart {
  key: string;
  path: string;
  visual: string;
  group: string;
  first: number;
  count: number;
  bounds: Box;
}
/** A composed `HP_*` node. `bearingDeg` is the compass bearing of its local +Z in ship axes (0 bow, 90 starboard). */
export interface ReferenceHardpoint {
  id: string;
  path: string;
  parent?: string;
  /** True when an ancestor hardpoint carries a mounted part, so this one rides on that mount, not on the ship. */
  nested?: true;
  visual?: string;
  position: Vec3;
  bearingDeg: number;
  /** Column-major 4×4 in ship metres, as three.js `matrix.fromArray` reads it. */
  matrix: number[];
}
export interface ReferenceMeta {
  format: number;
  name: string;
  kind: 'gamemodels3d' | 'file';
  source: string;
  vehicle?: string;
  vehicleName?: string;
  fetchedAt: string;
  hull?: string;
  components?: string[];
  frame: { metresPerUnit: number; reflectedZ: boolean; waterlineY: number; axes: string };
  bounds: Box;
  vertices: number;
  triangles: number;
  hullTriangles: number;
  groups: Record<string, number>;
  parts: ReferencePart[];
  hardpoints: ReferenceHardpoint[];
  omitted: string[];
}
export interface ReferenceMesh {
  meta: ReferenceMeta;
  positions: Float32Array;
  index: Uint32Array;
}

/** Column-major 4×4 product, matching three.js element order. */
export function multiply(a: readonly number[], b: readonly number[]): number[] {
  const out = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return out;
}
export const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
export const applyPoint = (m: readonly number[], v: Vec3): Vec3 => [0, 1, 2].map((r) => m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r]) as Vec3;
/** The node's own matrix. Source rows are columns, as `Matrix4.fromArray(matrix.flat())` reads them. */
export const nodeMatrix = (node: ReferenceNode): number[] => {
  const rows = node.transform?.matrix;
  if (!Array.isArray(rows) || rows.length !== 4 || rows.some((row) => !Array.isArray(row) || row.length !== 4 || row.some((v) => !Number.isFinite(v)))) return IDENTITY;
  return rows.flat();
};
export interface WalkedNode {
  path: string[];
  node: ReferenceNode;
  matrix: number[];
}
/** Every named descendant with its world matrix, depth first, parents before children. */
export function walkScheme(root: ReferenceNode, parent: readonly number[] = IDENTITY, path: string[] = []): WalkedNode[] {
  const children = root.nodes;
  const entries: [string, ReferenceNode][] = Array.isArray(children)
    ? children.map((child, i) => [`[${i}]`, child] as [string, ReferenceNode])
    : Object.entries(children ?? {});
  const out: WalkedNode[] = [];
  for (const [name, child] of entries) {
    const matrix = multiply(parent, nodeMatrix(child));
    out.push({ path: [...path, name], node: child, matrix });
    out.push(...walkScheme(child, matrix, [...path, name]));
  }
  return out;
}
/** Source units to ship metres: scale by 15 and reflect +Z to −Z. Triangle winding flips with the reflection. */
export const toShipFrame = (p: Vec3, metresPerUnit = METRES_PER_UNIT): Vec3 => [p[0] * metresPerUnit, p[1] * metresPerUnit, -p[2] * metresPerUnit];
/** Compass bearing of the node's local +Z once reflected: 0 is the bow (−Z), 90 starboard (+X). */
export function bearingOfMatrix(m: readonly number[]): number {
  const forward: Vec3 = [m[8], m[9], -m[10]];
  const degrees = (Math.atan2(forward[0], -forward[2]) * 180) / Math.PI;
  return Math.abs(degrees) < 1e-9 ? 0 : degrees;
}
/** Coarse family from the source path, so a slice or comparison can keep the hull and drop deck clutter. */
export function visualGroup(path: string): string {
  const parts = path.toLowerCase().split('/');
  if (parts.includes('ship')) return 'hull';
  const gun = parts.indexOf('gun');
  if (gun >= 0 && parts[gun + 1]) return parts[gun + 1] === 'torpedo' ? 'torpedo' : 'gun-' + parts[gun + 1].replace(/^aaircraft$/, 'aa');
  const known = ['artillery', 'atba', 'torpedo', 'director', 'finder', 'misc', 'engine', 'plane', 'aircraft'];
  return parts.find((part) => known.includes(part)) ?? 'other';
}

export const emptyBox = (): Box => ({ min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] });
export function expandBox(box: Box, p: Vec3) {
  for (let i = 0; i < 3; i++) {
    if (p[i] < box.min[i]) box.min[i] = p[i];
    if (p[i] > box.max[i]) box.max[i] = p[i];
  }
}
const round3 = (value: number) => Math.round(value * 1000) / 1000;
export const roundBox = (box: Box): Box => ({ min: box.min.map(round3) as Vec3, max: box.max.map(round3) as Vec3 });

export interface RawPart {
  key: string;
  path: string;
  visual: string;
  group: string;
  /** Triangle-soup positions already in ship metres. */
  positions: number[];
  index: number[];
}
export interface AssembledReference {
  parts: RawPart[];
  hardpoints: ReferenceHardpoint[];
  omitted: string[];
}
/** The composed node tree to positioned per-visual meshes plus hardpoint transforms, all in ship metres. */
export function assembleParts(root: ReferenceNode, models: ReferencePack['models'], metresPerUnit = METRES_PER_UNIT): AssembledReference {
  const parts: RawPart[] = [];
  const hardpoints: ReferenceHardpoint[] = [];
  const omitted: string[] = [];
  const used = new Map<string, number>();
  for (const { path, node, matrix } of walkScheme(root)) {
    const name = path[path.length - 1];
    if (name.startsWith('HP_')) {
      const ancestors = path.slice(0, -1).filter((part) => part.startsWith('HP_'));
      const translation = toShipFrame([matrix[12], matrix[13], matrix[14]], metresPerUnit);
      const scaled = [...matrix];
      scaled[12] = translation[0];
      scaled[13] = translation[1];
      scaled[14] = translation[2];
      hardpoints.push({
        id: name,
        path: path.join('/'),
        ...(ancestors.length ? { parent: ancestors[ancestors.length - 1] } : {}),
        ...(node.visual ? { visual: node.visual } : {}),
        position: translation.map(round3) as Vec3,
        bearingDeg: round3(bearingOfMatrix(matrix)),
        matrix: scaled.map((value) => round3(value)),
      });
    }
    const visual = node.visual;
    if (typeof visual !== 'string') continue;
    const model = models[visual];
    if (!model) {
      omitted.push(visual);
      continue;
    }
    const positions: number[] = [];
    const index: number[] = [];
    for (const geometry of Object.values(model.geometry)) {
      const count = geometry.position.length / 3;
      if (geometry.position.length % 3 || geometry.index.length % 3 || geometry.position.some((v) => !Number.isFinite(v)) || geometry.index.some((i) => !Number.isInteger(i) || i < 0 || i >= count))
        throw new Error('Invalid reference geometry in ' + visual + '.');
      const base = positions.length / 3;
      for (let i = 0; i < count; i++) {
        const local = applyPoint(matrix, [geometry.position[i * 3], geometry.position[i * 3 + 1], geometry.position[i * 3 + 2]]);
        positions.push(...toShipFrame(local, metresPerUnit));
      }
      // The reflection mirrors the mesh, so the winding flips to keep outward faces outward.
      for (let i = 0; i < geometry.index.length; i += 3) index.push(base + geometry.index[i], base + geometry.index[i + 2], base + geometry.index[i + 1]);
    }
    if (!index.length) continue;
    const short = name.replace(/^(HP_|MP_)/, '');
    const seen = (used.get(short) ?? 0) + 1;
    used.set(short, seen);
    parts.push({ key: seen > 1 ? `${short}#${seen}` : short, path: path.join('/'), visual, group: visualGroup(visual), positions, index });
  }
  // A hardpoint under a mounted part (a gun's own muzzle or AA points) rides on that mount, not on a deck.
  const mounted = new Set(hardpoints.filter((hp) => hp.visual && visualGroup(hp.visual) !== 'hull').map((hp) => hp.path));
  for (const hardpoint of hardpoints) {
    const segments = hardpoint.path.split('/');
    // Either a real ancestor carries the mount, or the source flattened the chain into one `HP_mount_HP_point` name.
    if (/_HP_/.test(hardpoint.id) || segments.some((_, i) => i < segments.length - 1 && mounted.has(segments.slice(0, i + 1).join('/')))) hardpoint.nested = true;
  }
  return { parts, hardpoints, omitted: [...new Set(omitted)] };
}

export const MAX_REFERENCE_TRIANGLES = 4_000_000;
/** Concatenate the parts into one triangle list with the hull first, so a hull-only read is a contiguous range. */
export function packReference(assembled: AssembledReference, meta: Omit<ReferenceMeta, 'format' | 'bounds' | 'vertices' | 'triangles' | 'hullTriangles' | 'groups' | 'parts' | 'hardpoints' | 'omitted'>): ReferenceMesh {
  const ordered = [...assembled.parts].sort((a, b) => (a.group === b.group ? 0 : a.group === 'hull' ? -1 : b.group === 'hull' ? 1 : a.group.localeCompare(b.group)));
  const vertices = ordered.reduce((sum, part) => sum + part.positions.length / 3, 0);
  const triangles = ordered.reduce((sum, part) => sum + part.index.length / 3, 0);
  if (!triangles) throw new Error('The reference has no geometry. Check the hull configuration or load a local GLB.');
  if (triangles > MAX_REFERENCE_TRIANGLES) throw new Error(`The reference has ${triangles} triangles, over the ${MAX_REFERENCE_TRIANGLES} cache limit.`);
  const positions = new Float32Array(vertices * 3);
  const index = new Uint32Array(triangles * 3);
  const bounds = emptyBox();
  const groups: Record<string, number> = {};
  const parts: ReferencePart[] = [];
  let vertexAt = 0;
  let indexAt = 0;
  for (const part of ordered) {
    const partBounds = emptyBox();
    for (let i = 0; i < part.positions.length; i += 3) {
      const p: Vec3 = [part.positions[i], part.positions[i + 1], part.positions[i + 2]];
      positions.set(p, vertexAt * 3 + i);
      expandBox(partBounds, p);
      expandBox(bounds, p);
    }
    for (let i = 0; i < part.index.length; i++) index[indexAt + i] = vertexAt + part.index[i];
    parts.push({ key: part.key, path: part.path, visual: part.visual, group: part.group, first: indexAt / 3, count: part.index.length / 3, bounds: roundBox(partBounds) });
    groups[part.group] = (groups[part.group] ?? 0) + part.index.length / 3;
    vertexAt += part.positions.length / 3;
    indexAt += part.index.length;
  }
  return {
    meta: { format: REFERENCE_FORMAT, ...meta, bounds: roundBox(bounds), vertices, triangles, hullTriangles: groups.hull ?? 0, groups, parts, hardpoints: assembled.hardpoints, omitted: assembled.omitted },
    positions,
    index,
  };
}

const MAGIC = 0x3146524e; // 'NRF1'
/** `mesh.bin`: a 16-byte header, float32 positions, then uint32 triangle indices. */
export function encodeMesh(positions: Float32Array, index: Uint32Array): Buffer {
  const buffer = Buffer.allocUnsafe(16 + positions.byteLength + index.byteLength);
  buffer.writeUInt32LE(MAGIC, 0);
  buffer.writeUInt32LE(REFERENCE_FORMAT, 4);
  buffer.writeUInt32LE(positions.length / 3, 8);
  buffer.writeUInt32LE(index.length, 12);
  Buffer.from(positions.buffer, positions.byteOffset, positions.byteLength).copy(buffer, 16);
  Buffer.from(index.buffer, index.byteOffset, index.byteLength).copy(buffer, 16 + positions.byteLength);
  return buffer;
}
export function decodeMesh(buffer: Buffer): { positions: Float32Array; index: Uint32Array } {
  if (buffer.length < 16 || buffer.readUInt32LE(0) !== MAGIC) throw new Error('Not a reference mesh file. Rebuild it with ship:reference.');
  if (buffer.readUInt32LE(4) !== REFERENCE_FORMAT) throw new Error('Reference cache format changed. Rebuild it with ship:reference.');
  const vertices = buffer.readUInt32LE(8);
  const indices = buffer.readUInt32LE(12);
  if (buffer.length !== 16 + vertices * 12 + indices * 4) throw new Error('Truncated reference mesh file. Rebuild it with ship:reference.');
  const bytes = Uint8Array.prototype.slice.call(buffer, 16);
  return { positions: new Float32Array(bytes.buffer, 0, vertices * 3), index: new Uint32Array(bytes.buffer, vertices * 12, indices) };
}

export const referenceName = (value: string): string => {
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(value)) throw new Error('Reference names are 1–64 letters, digits, dashes or underscores: ' + JSON.stringify(value));
  return value;
};
export const referenceDirectory = (root: string, name: string) => join(root, REFERENCE_ROOT, referenceName(name));
export async function writeReference(root: string, mesh: ReferenceMesh): Promise<string> {
  const directory = referenceDirectory(root, mesh.meta.name);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'mesh.bin'), encodeMesh(mesh.positions, mesh.index));
  await writeFile(join(directory, 'reference.json'), JSON.stringify(mesh.meta, null, 2) + '\n');
  return directory;
}
export async function readReferenceMeta(root: string, name: string): Promise<ReferenceMeta> {
  const directory = referenceDirectory(root, name);
  const meta = JSON.parse(await readFile(join(directory, 'reference.json'), 'utf8').catch(() => {
    throw new Error(`No cached reference "${name}". Run bun run ship:reference ${name}, or ship:reference --list.`);
  })) as ReferenceMeta;
  if (meta.format !== REFERENCE_FORMAT) throw new Error(`Cached reference "${name}" uses format ${meta.format}. Rebuild it with ship:reference --refresh.`);
  return meta;
}
export async function readReference(root: string, name: string): Promise<ReferenceMesh> {
  const meta = await readReferenceMeta(root, name);
  const { positions, index } = decodeMesh(await readFile(join(referenceDirectory(root, name), 'mesh.bin')));
  return { meta, positions, index };
}
export async function listReferences(root: string): Promise<ReferenceMeta[]> {
  const names = await readdir(join(root, REFERENCE_ROOT)).catch(() => [] as string[]);
  const found: ReferenceMeta[] = [];
  for (const name of names.sort()) {
    const meta = await readReferenceMeta(root, name).catch(() => undefined);
    if (meta) found.push(meta);
  }
  return found;
}
/** Triangle indices of the named groups or part keys; no selection keeps every part. */
export function selectTriangles(meta: ReferenceMeta, selection: string[] | undefined): { first: number; count: number }[] {
  if (!selection?.length) return [{ first: 0, count: meta.triangles }];
  const wanted = new Set(selection);
  const chosen = meta.parts.filter((part) => wanted.has(part.group) || wanted.has(part.key) || wanted.has(part.visual));
  if (!chosen.length) throw new Error('No reference part matched ' + selection.join(', ') + '. Groups: ' + Object.keys(meta.groups).join(', ') + '.');
  const ranges: { first: number; count: number }[] = [];
  for (const part of chosen.sort((a, b) => a.first - b.first)) {
    const last = ranges[ranges.length - 1];
    if (last && last.first + last.count === part.first) last.count += part.count;
    else ranges.push({ first: part.first, count: part.count });
  }
  return ranges;
}
