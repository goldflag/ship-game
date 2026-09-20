import { IDENTITY, applyPoint, multiply, visualGroup, type RawPart, type Vec3 } from './reference';

/** Local `.glb`/`.obj` readers for a reference that did not come from GameModels3D. Small and dependency-free:
 * only node transforms, positions and triangle indices are read, because the cache stores geometry alone. */
export interface FileParseOptions {
  /** Applied before the frame conversion; an export already in metres needs 1. */
  scale?: number;
  /** True reflects source +Z to ship −Z, as the World of Warships conversion does. */
  flipZ?: boolean;
}
const frame = (p: Vec3, options: FileParseOptions): Vec3 => {
  const s = options.scale ?? 1;
  return [p[0] * s, p[1] * s, options.flipZ ? -p[2] * s : p[2] * s];
};

interface Accessor {
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: string;
}
const COMPONENT_BYTES: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const TYPE_COUNT: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

/** glTF binary container: a JSON chunk and one binary chunk. External `.bin` buffers are not followed. */
export function parseGlb(data: Buffer, options: FileParseOptions = {}): RawPart[] {
  if (data.length < 20 || data.readUInt32LE(0) !== 0x46546c67) throw new Error('Not a binary glTF (.glb) file.');
  if (data.readUInt32LE(4) !== 2) throw new Error('Only glTF 2.0 binary files are supported.');
  let offset = 12;
  let json: any;
  let binary = data.subarray(0, 0);
  while (offset + 8 <= data.length) {
    const length = data.readUInt32LE(offset);
    const kind = data.readUInt32LE(offset + 4);
    const chunk = data.subarray(offset + 8, offset + 8 + length);
    if (kind === 0x4e4f534a) json = JSON.parse(chunk.toString('utf8'));
    else if (kind === 0x004e4942) binary = chunk;
    offset += 8 + length + ((4 - (length % 4)) % 4);
  }
  if (!json?.meshes?.length) throw new Error('The glTF file has no meshes.');
  const read = (accessorIndex: number): Float64Array => {
    const accessor = json.accessors?.[accessorIndex] as Accessor | undefined;
    if (!accessor || !COMPONENT_BYTES[accessor.componentType] || !TYPE_COUNT[accessor.type]) throw new Error('Unsupported glTF accessor.');
    const view = json.bufferViews?.[accessor.bufferView ?? -1];
    if (!view) throw new Error('glTF accessors without a buffer view are not supported.');
    if ((json.buffers?.[view.buffer ?? 0]?.uri ?? undefined) !== undefined) throw new Error('Only self-contained .glb files are supported; external buffers are not fetched.');
    const size = TYPE_COUNT[accessor.type];
    const bytes = COMPONENT_BYTES[accessor.componentType];
    const stride = view.byteStride && view.byteStride > 0 ? view.byteStride : size * bytes;
    const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    const out = new Float64Array(accessor.count * size);
    for (let i = 0; i < accessor.count; i++)
      for (let c = 0; c < size; c++) {
        const at = start + i * stride + c * bytes;
        if (at + bytes > binary.length) throw new Error('Truncated glTF buffer.');
        out[i * size + c] =
          accessor.componentType === 5126 ? binary.readFloatLE(at)
          : accessor.componentType === 5125 ? binary.readUInt32LE(at)
          : accessor.componentType === 5123 ? binary.readUInt16LE(at)
          : accessor.componentType === 5122 ? binary.readInt16LE(at)
          : accessor.componentType === 5121 ? binary.readUInt8(at)
          : binary.readInt8(at);
      }
    return out;
  };
  const localMatrix = (node: any): number[] => {
    if (Array.isArray(node.matrix) && node.matrix.length === 16) return node.matrix.slice();
    const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1];
    const [sx, sy, sz] = node.scale ?? [1, 1, 1];
    const [tx, ty, tz] = node.translation ?? [0, 0, 0];
    const [x2, y2, z2] = [x + x, y + y, z + z];
    return [
      (1 - (y * y2 + z * z2)) * sx, (x * y2 + w * z2) * sx, (x * z2 - w * y2) * sx, 0,
      (x * y2 - w * z2) * sy, (1 - (x * x2 + z * z2)) * sy, (y * z2 + w * x2) * sy, 0,
      (x * z2 + w * y2) * sz, (y * z2 - w * x2) * sz, (1 - (x * x2 + y * y2)) * sz, 0,
      tx, ty, tz, 1,
    ];
  };
  const parts: RawPart[] = [];
  const used = new Map<string, number>();
  const visit = (nodeIndex: number, parent: readonly number[], path: string[]) => {
    const node = json.nodes?.[nodeIndex];
    if (!node) return;
    const name = String(node.name ?? 'node' + nodeIndex);
    const matrix = multiply(parent, localMatrix(node));
    const here = [...path, name];
    if (node.mesh !== undefined) {
      const mesh = json.meshes[node.mesh];
      const positions: number[] = [];
      const index: number[] = [];
      for (const primitive of mesh?.primitives ?? []) {
        if ((primitive.mode ?? 4) !== 4 || primitive.attributes?.POSITION === undefined) continue;
        const source = read(primitive.attributes.POSITION);
        const base = positions.length / 3;
        for (let i = 0; i < source.length; i += 3) positions.push(...frame(applyPoint(matrix, [source[i], source[i + 1], source[i + 2]]), options));
        const indices = primitive.indices === undefined ? Float64Array.from({ length: source.length / 3 }, (_, i) => i) : read(primitive.indices);
        for (let i = 0; i + 2 < indices.length; i += 3)
          if (options.flipZ) index.push(base + indices[i], base + indices[i + 2], base + indices[i + 1]);
          else index.push(base + indices[i], base + indices[i + 1], base + indices[i + 2]);
      }
      if (index.length) {
        const seen = (used.get(name) ?? 0) + 1;
        used.set(name, seen);
        parts.push({ key: seen > 1 ? `${name}#${seen}` : name, path: here.join('/'), visual: String(mesh?.name ?? name), group: visualGroup(String(mesh?.name ?? name)), positions, index });
      }
    }
    for (const child of node.children ?? []) visit(child, matrix, here);
  };
  const scene = json.scenes?.[json.scene ?? 0];
  for (const nodeIndex of scene?.nodes ?? json.nodes?.map((_: unknown, i: number) => i) ?? []) visit(nodeIndex, IDENTITY, []);
  if (!parts.length) throw new Error('The glTF file has no triangle geometry.');
  return parts;
}

/** Wavefront OBJ: `v` positions and `f` faces, fan-triangulated. `o`/`g` names become parts. */
export function parseObj(text: string, options: FileParseOptions = {}): RawPart[] {
  const vertices: Vec3[] = [];
  const parts: RawPart[] = [];
  const used = new Map<string, number>();
  let current: { name: string; positions: number[]; index: number[]; map: Map<number, number> } | undefined;
  const open = (name: string) => {
    close();
    current = { name, positions: [], index: [], map: new Map() };
  };
  function close() {
    if (!current?.index.length) return;
    const seen = (used.get(current.name) ?? 0) + 1;
    used.set(current.name, seen);
    parts.push({ key: seen > 1 ? `${current.name}#${seen}` : current.name, path: current.name, visual: current.name, group: visualGroup(current.name), positions: current.positions, index: current.index });
    current = undefined;
  }
  for (const line of text.split('\n')) {
    const words = line.trim().split(/\s+/);
    if (words[0] === 'v') {
      const p = [Number(words[1]), Number(words[2]), Number(words[3])] as Vec3;
      if (!p.every(Number.isFinite)) throw new Error('Invalid OBJ vertex: ' + line.trim());
      vertices.push(frame(p, options));
    } else if (words[0] === 'o' || words[0] === 'g') open(words.slice(1).join(' ') || 'group');
    else if (words[0] === 'f') {
      if (!current) open('mesh');
      const corners = words.slice(1).map((word) => {
        const value = Number(word.split('/')[0]);
        const at = value < 0 ? vertices.length + value : value - 1;
        if (!Number.isInteger(at) || at < 0 || at >= vertices.length) throw new Error('Invalid OBJ face index: ' + line.trim());
        let local = current!.map.get(at);
        if (local === undefined) {
          local = current!.positions.length / 3;
          current!.map.set(at, local);
          current!.positions.push(...vertices[at]);
        }
        return local;
      });
      for (let i = 2; i < corners.length; i++)
        if (options.flipZ) current!.index.push(corners[0], corners[i], corners[i - 1]);
        else current!.index.push(corners[0], corners[i - 1], corners[i]);
    }
  }
  close();
  if (!parts.length) throw new Error('The OBJ file has no triangle geometry.');
  return parts;
}
