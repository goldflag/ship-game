// Dependency-free parser for imported mesh files (OBJ/STL/PLY/GLB), used to turn an artist's
// mesh into a triangle soup a custom construction block can be built from. No three.js, no npm
// packages: this must run in the CLI and the MCP server without pulling in a renderer.

/** One triangle of an imported mesh, in the file's own coordinates. */
export interface MeshTriangle { a: [number, number, number]; b: [number, number, number]; c: [number, number, number]; group?: string }
export interface ParsedMesh { format: 'obj' | 'stl' | 'ply' | 'glb'; triangles: MeshTriangle[]; groups: string[] }

/** `name` is only used to pick the format by extension; `bytes` is the file content. */
export function parseMeshFile(name: string, bytes: Uint8Array): ParsedMesh {
  const ext = (name.split('.').pop() ?? '').toLowerCase();
  let triangles: MeshTriangle[];
  if (ext === 'obj') triangles = parseObj(bytes);
  else if (ext === 'stl') triangles = parseStl(bytes);
  else if (ext === 'ply') triangles = parsePly(bytes);
  else if (ext === 'glb') triangles = parseGlb(bytes);
  else if (ext === 'gltf') throw new Error(`${name}: a .gltf JSON file is not supported; export or convert it to a binary .glb first.`);
  else throw new Error(`${name}: unrecognized mesh extension ".${ext}"; supported formats are .obj, .stl, .ply and .glb.`);
  if (triangles.length === 0) throw new Error(`${name}: parsed zero triangles from the file; there is nothing to import.`);
  const groups = [...new Set(triangles.map((t) => t.group).filter((g): g is string => g !== undefined))].sort((a, b) => a.localeCompare(b));
  return { format: ext as ParsedMesh['format'], triangles, groups };
}

// ---------------------------------------------------------------------------------------------
// OBJ
// ---------------------------------------------------------------------------------------------

function parseObj(bytes: Uint8Array): MeshTriangle[] {
  const lines = new TextDecoder('utf8').decode(bytes).split(/\r\n|\n|\r/);
  const vertices: [number, number, number][] = [];
  const triangles: MeshTriangle[] = [];
  let material: string | undefined, group: string | undefined;
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n].trim();
    if (!line || line.startsWith('#')) continue;
    const tokens = line.split(/\s+/);
    const key = tokens[0];
    if (key === 'v') {
      if (tokens.length < 4) throw new Error(`OBJ line ${n + 1}: "v" needs at least 3 coordinates, got "${line}".`);
      const x = Number(tokens[1]), y = Number(tokens[2]), z = Number(tokens[3]);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) throw new Error(`OBJ line ${n + 1}: non-numeric vertex coordinate in "${line}".`);
      vertices.push([x, y, z]);
    } else if (key === 'usemtl') {
      material = tokens.slice(1).join(' ') || undefined;
    } else if (key === 'g' || key === 'o') {
      group = tokens.slice(1).join(' ') || undefined;
    } else if (key === 'f') {
      const resolve = (token: string): [number, number, number] => {
        const idx = Number(token.split('/')[0]);
        if (!Number.isInteger(idx) || idx === 0) throw new Error(`OBJ line ${n + 1}: bad face vertex index "${token}" in "${line}".`);
        const i = idx > 0 ? idx - 1 : vertices.length + idx;
        const v = vertices[i];
        if (!v) throw new Error(`OBJ line ${n + 1}: face vertex index ${idx} is out of range (${vertices.length} vertices defined so far).`);
        return v;
      };
      const face = tokens.slice(1).map(resolve);
      if (face.length < 3) throw new Error(`OBJ line ${n + 1}: face needs at least 3 vertices, got ${face.length} in "${line}".`);
      const label = material ?? group;
      for (let i = 1; i < face.length - 1; i++) triangles.push({ a: face[0], b: face[i], c: face[i + 1], group: label });
    }
  }
  return triangles;
}

// ---------------------------------------------------------------------------------------------
// STL
// ---------------------------------------------------------------------------------------------

function parseStl(bytes: Uint8Array): MeshTriangle[] {
  if (bytes.length >= 84) {
    const count = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(80, true);
    if (bytes.length === 84 + 50 * count) return parseStlBinary(bytes, count);
  }
  return parseStlAscii(new TextDecoder('utf8').decode(bytes));
}

function parseStlBinary(bytes: Uint8Array, count: number): MeshTriangle[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const triangles: MeshTriangle[] = [];
  let offset = 84;
  for (let i = 0; i < count; i++) {
    offset += 12; // facet normal, unused
    const read = (): [number, number, number] => {
      const v: [number, number, number] = [view.getFloat32(offset, true), view.getFloat32(offset + 4, true), view.getFloat32(offset + 8, true)];
      offset += 12;
      return v;
    };
    const a = read(), b = read(), c = read();
    offset += 2; // attribute byte count, unused
    triangles.push({ a, b, c });
  }
  return triangles;
}

function parseStlAscii(text: string): MeshTriangle[] {
  const lines = text.split(/\r\n|\n|\r/);
  if (!/^\s*solid\b/i.test(lines[0] ?? '')) {
    throw new Error('STL: not recognized as binary (file length does not match 84 + 50*triangle-count from the header) and the first line is not "solid ..."; check the export.');
  }
  const group = lines[0].trim().replace(/^solid\s*/i, '') || undefined;
  const triangles: MeshTriangle[] = [];
  let loop: [number, number, number][] = [];
  for (let n = 0; n < lines.length; n++) {
    const tokens = lines[n].trim().split(/\s+/);
    if (tokens[0] === 'vertex') {
      if (tokens.length < 4) throw new Error(`STL line ${n + 1}: "vertex" needs 3 coordinates, got "${lines[n].trim()}".`);
      const x = Number(tokens[1]), y = Number(tokens[2]), z = Number(tokens[3]);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) throw new Error(`STL line ${n + 1}: non-numeric vertex coordinate.`);
      loop.push([x, y, z]);
    } else if (tokens[0] === 'endloop') {
      if (loop.length !== 3) throw new Error(`STL line ${n + 1}: facet loop has ${loop.length} vertices, expected 3 (ASCII STL facets are always triangles).`);
      triangles.push({ a: loop[0], b: loop[1], c: loop[2], group });
      loop = [];
    }
  }
  if (triangles.length === 0) throw new Error('STL: ASCII file has no "facet"/"vertex" data between "solid" and "endsolid".');
  return triangles;
}

// ---------------------------------------------------------------------------------------------
// PLY
// ---------------------------------------------------------------------------------------------

interface PlyProperty { name: string; type: string; list?: { countType: string; itemType: string } }
interface PlyElement { name: string; count: number; props: PlyProperty[] }

const PLY_TYPES: Record<string, { size: number; read: (view: DataView, offset: number, little: boolean) => number }> = {
  char: { size: 1, read: (v, o) => v.getInt8(o) }, int8: { size: 1, read: (v, o) => v.getInt8(o) },
  uchar: { size: 1, read: (v, o) => v.getUint8(o) }, uint8: { size: 1, read: (v, o) => v.getUint8(o) },
  short: { size: 2, read: (v, o, l) => v.getInt16(o, l) }, int16: { size: 2, read: (v, o, l) => v.getInt16(o, l) },
  ushort: { size: 2, read: (v, o, l) => v.getUint16(o, l) }, uint16: { size: 2, read: (v, o, l) => v.getUint16(o, l) },
  int: { size: 4, read: (v, o, l) => v.getInt32(o, l) }, int32: { size: 4, read: (v, o, l) => v.getInt32(o, l) },
  uint: { size: 4, read: (v, o, l) => v.getUint32(o, l) }, uint32: { size: 4, read: (v, o, l) => v.getUint32(o, l) },
  float: { size: 4, read: (v, o, l) => v.getFloat32(o, l) }, float32: { size: 4, read: (v, o, l) => v.getFloat32(o, l) },
  double: { size: 8, read: (v, o, l) => v.getFloat64(o, l) }, float64: { size: 8, read: (v, o, l) => v.getFloat64(o, l) },
};

function findAscii(bytes: Uint8Array, needle: string): number {
  const code = [...needle].map((c) => c.charCodeAt(0));
  outer: for (let i = 0; i <= bytes.length - code.length; i++) {
    for (let j = 0; j < code.length; j++) if (bytes[i + j] !== code[j]) continue outer;
    return i;
  }
  return -1;
}

function parsePly(bytes: Uint8Array): MeshTriangle[] {
  const headerEnd = findAscii(bytes, 'end_header');
  if (headerEnd === -1) throw new Error('PLY: header has no "end_header" line; the file may be truncated or is not a PLY file.');
  let dataStart = headerEnd + 'end_header'.length;
  if (bytes[dataStart] === 0x0d) dataStart++;
  if (bytes[dataStart] === 0x0a) dataStart++;
  const lines = new TextDecoder('latin1').decode(bytes.subarray(0, headerEnd)).split(/\r\n|\n|\r/).map((l) => l.trim()).filter(Boolean);
  if (lines[0] !== 'ply') throw new Error(`PLY: first header line must be "ply", got "${lines[0] ?? ''}".`);
  let formatKind: 'ascii' | 'binary_little_endian' | undefined;
  const elements: PlyElement[] = [];
  for (let n = 1; n < lines.length; n++) {
    const tokens = lines[n].split(/\s+/);
    if (tokens[0] === 'format') {
      if (tokens[1] !== 'ascii' && tokens[1] !== 'binary_little_endian') throw new Error(`PLY header: unsupported format "${tokens[1]}"; only ascii and binary_little_endian are supported.`);
      formatKind = tokens[1];
    } else if (tokens[0] === 'comment' || tokens[0] === 'obj_info') {
      continue;
    } else if (tokens[0] === 'element') {
      elements.push({ name: tokens[1], count: Number(tokens[2]), props: [] });
    } else if (tokens[0] === 'property') {
      const el = elements[elements.length - 1];
      if (!el) throw new Error(`PLY header line ${n + 1}: "property" appears before any "element".`);
      if (tokens[1] === 'list') el.props.push({ name: tokens[4], type: 'list', list: { countType: tokens[2], itemType: tokens[3] } });
      else el.props.push({ name: tokens[2], type: tokens[1] });
    } else {
      throw new Error(`PLY header line ${n + 1}: unrecognized directive "${tokens[0]}".`);
    }
  }
  if (!formatKind) throw new Error('PLY header: missing "format" line.');
  const vertexElem = elements.find((e) => e.name === 'vertex');
  const faceElem = elements.find((e) => e.name === 'face');
  if (!vertexElem) throw new Error('PLY header: no "element vertex".');
  if (!faceElem) throw new Error('PLY header: no "element face".');
  const xi = vertexElem.props.findIndex((p) => p.name === 'x'), yi = vertexElem.props.findIndex((p) => p.name === 'y'), zi = vertexElem.props.findIndex((p) => p.name === 'z');
  if (xi === -1 || yi === -1 || zi === -1) throw new Error('PLY header: vertex element is missing an x/y/z property.');
  const indexProp = faceElem.props.find((p) => p.type === 'list');
  if (!indexProp || (indexProp.name !== 'vertex_indices' && indexProp.name !== 'vertex_index')) {
    throw new Error('PLY header: face element needs a "property list ... vertex_indices" (or "vertex_index").');
  }
  const indexPos = faceElem.props.indexOf(indexProp);
  return formatKind === 'ascii'
    ? parsePlyAscii(bytes, dataStart, elements, vertexElem, faceElem, xi, yi, zi, indexPos)
    : parsePlyBinary(bytes, dataStart, elements, vertexElem, faceElem, xi, yi, zi, indexPos);
}

function readAsciiRow(tokens: string[], props: PlyProperty[], elementName: string, row: number): (number | number[])[] {
  const values: (number | number[])[] = [];
  let t = 0;
  for (const prop of props) {
    if (prop.type === 'list') {
      const count = Number(tokens[t++]);
      if (!Number.isInteger(count) || count < 0) throw new Error(`PLY: "${elementName}" row ${row} has a bad list count.`);
      values.push(tokens.slice(t, t + count).map(Number));
      t += count;
    } else {
      values.push(Number(tokens[t++]));
    }
  }
  return values;
}

function facesFromIndices(indices: number[], vertices: [number, number, number][], label: string, row: number): MeshTriangle[] {
  if (indices.length < 3) throw new Error(`PLY: "${label}" row ${row} has ${indices.length} vertex indices, need at least 3.`);
  const face = indices.map((idx) => {
    const v = vertices[idx];
    if (!v) throw new Error(`PLY: "${label}" row ${row} references vertex ${idx}, only ${vertices.length} vertices defined.`);
    return v;
  });
  const triangles: MeshTriangle[] = [];
  for (let k = 1; k < face.length - 1; k++) triangles.push({ a: face[0], b: face[k], c: face[k + 1] });
  return triangles;
}

function parsePlyAscii(bytes: Uint8Array, dataStart: number, elements: PlyElement[], vertexElem: PlyElement, faceElem: PlyElement, xi: number, yi: number, zi: number, indexPos: number): MeshTriangle[] {
  const lines = new TextDecoder('utf8').decode(bytes.subarray(dataStart)).split(/\r\n|\n|\r/).filter((l) => l.trim().length > 0);
  const vertices: [number, number, number][] = [];
  const triangles: MeshTriangle[] = [];
  let cursor = 0;
  for (const elem of elements) {
    for (let i = 0; i < elem.count; i++) {
      const line = lines[cursor];
      if (line === undefined) throw new Error(`PLY: expected ${elem.count} "${elem.name}" rows but ran out of data rows after ${i}.`);
      cursor++;
      const values = readAsciiRow(line.trim().split(/\s+/), elem.props, elem.name, i);
      if (elem === vertexElem) {
        const x = values[xi] as number, y = values[yi] as number, z = values[zi] as number;
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) throw new Error(`PLY: non-numeric vertex at row ${i}.`);
        vertices.push([x, y, z]);
      } else if (elem === faceElem) {
        triangles.push(...facesFromIndices(values[indexPos] as number[], vertices, 'face', i));
      }
    }
  }
  return triangles;
}

function parsePlyBinary(bytes: Uint8Array, dataStart: number, elements: PlyElement[], vertexElem: PlyElement, faceElem: PlyElement, xi: number, yi: number, zi: number, indexPos: number): MeshTriangle[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const vertices: [number, number, number][] = [];
  const triangles: MeshTriangle[] = [];
  let offset = dataStart;
  const readValue = (type: string, elementName: string): number => {
    const spec = PLY_TYPES[type];
    if (!spec) throw new Error(`PLY: unsupported property type "${type}" in "${elementName}".`);
    if (offset + spec.size > bytes.length) throw new Error(`PLY: binary data truncated at byte offset ${offset} while reading "${elementName}".`);
    const v = spec.read(view, offset, true);
    offset += spec.size;
    return v;
  };
  for (const elem of elements) {
    for (let i = 0; i < elem.count; i++) {
      const values: (number | number[])[] = [];
      for (const prop of elem.props) {
        if (prop.type === 'list') {
          const count = readValue(prop.list!.countType, elem.name);
          const items: number[] = [];
          for (let k = 0; k < count; k++) items.push(readValue(prop.list!.itemType, elem.name));
          values.push(items);
        } else {
          values.push(readValue(prop.type, elem.name));
        }
      }
      if (elem === vertexElem) vertices.push([values[xi] as number, values[yi] as number, values[zi] as number]);
      else if (elem === faceElem) triangles.push(...facesFromIndices(values[indexPos] as number[], vertices, 'face', i));
    }
  }
  return triangles;
}

// ---------------------------------------------------------------------------------------------
// GLB (binary glTF container only; a .gltf JSON file is rejected in parseMeshFile)
// ---------------------------------------------------------------------------------------------

type Mat4 = number[]; // 16 numbers, column-major, matching glTF's own convention
const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let sum = 0; for (let k = 0; k < 4; k++) sum += a[k * 4 + r] * b[c * 4 + k]; out[c * 4 + r] = sum; }
  return out;
}

function fromTrs(t?: number[], r?: number[], s?: number[]): Mat4 {
  const [tx, ty, tz] = t ?? [0, 0, 0];
  const [qx, qy, qz, qw] = r ?? [0, 0, 0, 1];
  const [sx, sy, sz] = s ?? [1, 1, 1];
  const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
  const xx = qx * x2, xy = qx * y2, xz = qx * z2, yy = qy * y2, yz = qy * z2, zz = qz * z2, wx = qw * x2, wy = qw * y2, wz = qw * z2;
  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

function transformPoint(m: Mat4, p: [number, number, number]): [number, number, number] {
  const [x, y, z] = p;
  return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
}

const COMPONENT_SIZE: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const TYPE_COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function readComponent(view: DataView, offset: number, componentType: number): number {
  switch (componentType) {
    case 5120: return view.getInt8(offset);
    case 5121: return view.getUint8(offset);
    case 5122: return view.getInt16(offset, true);
    case 5123: return view.getUint16(offset, true);
    case 5125: return view.getUint32(offset, true);
    case 5126: return view.getFloat32(offset, true);
    default: throw new Error(`GLB: unsupported accessor componentType ${componentType}.`);
  }
}

// `json` is untyped glTF content, checked defensively field-by-field below.
function readAccessor(json: any, bin: Uint8Array | undefined, index: number): number[][] {
  const acc = json.accessors?.[index];
  if (!acc) throw new Error(`GLB: missing accessor ${index}.`);
  const componentCount = TYPE_COMPONENTS[acc.type];
  if (!componentCount) throw new Error(`GLB: accessor ${index} has unsupported type "${acc.type}".`);
  const compSize = COMPONENT_SIZE[acc.componentType];
  if (!compSize) throw new Error(`GLB: accessor ${index} has unsupported componentType ${acc.componentType}.`);
  if (acc.bufferView === undefined) throw new Error(`GLB: accessor ${index} has no bufferView; sparse or zero-filled accessors are not supported.`);
  const view = json.bufferViews?.[acc.bufferView];
  if (!view) throw new Error(`GLB: accessor ${index} references missing bufferView ${acc.bufferView}.`);
  if ((view.buffer ?? 0) !== 0) throw new Error(`GLB: bufferView ${acc.bufferView} references buffer ${view.buffer}; only the single embedded buffer 0 is supported.`);
  const buffer = json.buffers?.[view.buffer ?? 0];
  if (buffer?.uri !== undefined) throw new Error(`GLB: buffer ${view.buffer ?? 0} has a "uri" ("${buffer.uri}"); only an embedded BIN chunk with no uri is supported. Bake external buffers into the .glb first.`);
  if (!bin) throw new Error(`GLB: accessor ${index} needs mesh data but the file has no embedded BIN chunk.`);
  const stride = view.byteStride ?? componentCount * compSize;
  const base = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const rows: number[][] = [];
  for (let i = 0; i < acc.count; i++) {
    const row: number[] = [];
    for (let c = 0; c < componentCount; c++) {
      const off = base + i * stride + c * compSize;
      if (off + compSize > bin.byteLength) throw new Error(`GLB: accessor ${index} element ${i} reads past the end of the BIN chunk at byte ${off}.`);
      row.push(readComponent(dv, off, acc.componentType));
    }
    rows.push(row);
  }
  return rows;
}

function readPositionAccessor(json: any, bin: Uint8Array | undefined, index: number): [number, number, number][] {
  const acc = json.accessors?.[index];
  if (!acc) throw new Error(`GLB: missing accessor ${index} for POSITION.`);
  if (acc.type !== 'VEC3' || acc.componentType !== 5126) throw new Error(`GLB: POSITION accessor ${index} must be VEC3/FLOAT (componentType 5126), found ${acc.type}/${acc.componentType}.`);
  return readAccessor(json, bin, index) as [number, number, number][];
}

function readIndexAccessor(json: any, bin: Uint8Array | undefined, index: number): number[] {
  const acc = json.accessors?.[index];
  if (!acc) throw new Error(`GLB: missing accessor ${index} for indices.`);
  if (acc.type !== 'SCALAR' || ![5121, 5123, 5125].includes(acc.componentType)) {
    throw new Error(`GLB: index accessor ${index} must be SCALAR with componentType 5121, 5123 or 5125, found ${acc.type}/${acc.componentType}.`);
  }
  return readAccessor(json, bin, index).map((row) => row[0]);
}

function parseGlb(bytes: Uint8Array): MeshTriangle[] {
  if (bytes.length < 12) throw new Error(`GLB: file is only ${bytes.length} bytes, too short for the 12-byte header.`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (magic !== 'glTF') throw new Error(`GLB: bad magic "${magic}", expected "glTF"; this is not a binary glTF file.`);
  const version = view.getUint32(4, true);
  if (version !== 2) throw new Error(`GLB: unsupported version ${version}; only glTF binary version 2 is supported.`);
  const total = view.getUint32(8, true);
  if (total > bytes.length) throw new Error(`GLB: header declares ${total} total bytes but the file is only ${bytes.length} bytes; the file is truncated.`);
  let json: any, bin: Uint8Array | undefined;
  let offset = 12;
  while (offset < total) {
    if (offset + 8 > total) throw new Error(`GLB: chunk header at byte ${offset} runs past the end of the file.`);
    const chunkLength = view.getUint32(offset, true);
    const chunkType = view.getUint32(offset + 4, true);
    const dataStart = offset + 8;
    if (dataStart + chunkLength > total) throw new Error(`GLB: chunk at byte ${offset} declares length ${chunkLength} but runs past the end of the file.`);
    const data = bytes.subarray(dataStart, dataStart + chunkLength);
    if (chunkType === 0x4e4f534a) json = JSON.parse(new TextDecoder('utf8').decode(data)); // 'JSON'
    else if (chunkType === 0x004e4942) bin = data; // 'BIN\0'
    offset = dataStart + chunkLength;
  }
  if (!json) throw new Error('GLB: file has no JSON chunk.');
  const sceneIdx = json.scene ?? 0;
  const scene = json.scenes?.[sceneIdx];
  if (!scene) throw new Error(`GLB: no scene at index ${sceneIdx}.`);
  const nodes = json.nodes ?? [];
  const materials = json.materials ?? [];
  const triangles: MeshTriangle[] = [];
  const visit = (nodeIdx: number, parent: Mat4) => {
    const node = nodes[nodeIdx];
    if (!node) throw new Error(`GLB: missing node ${nodeIdx}.`);
    if (node.matrix && node.matrix.length !== 16) throw new Error(`GLB: node ${nodeIdx} has a "matrix" that is not 16 numbers.`);
    const local: Mat4 = node.matrix ?? fromTrs(node.translation, node.rotation, node.scale);
    const world = multiply(parent, local);
    if (node.mesh !== undefined) {
      const mesh = json.meshes?.[node.mesh];
      if (!mesh) throw new Error(`GLB: node ${nodeIdx} references missing mesh ${node.mesh}.`);
      for (const prim of mesh.primitives ?? []) {
        if (prim.mode !== undefined && prim.mode !== 4) continue; // only TRIANGLES
        const posIdx = prim.attributes?.POSITION;
        if (posIdx === undefined) throw new Error(`GLB: mesh ${node.mesh} primitive has no POSITION attribute.`);
        const positions = readPositionAccessor(json, bin, posIdx).map((p) => transformPoint(world, p));
        const group = materials[prim.material]?.name ?? mesh.name ?? undefined;
        if (prim.indices !== undefined) {
          const indices = readIndexAccessor(json, bin, prim.indices);
          if (indices.length % 3 !== 0) throw new Error(`GLB: mesh ${node.mesh} primitive has ${indices.length} indices, not a multiple of 3.`);
          for (let i = 0; i < indices.length; i += 3) {
            const a = positions[indices[i]], b = positions[indices[i + 1]], c = positions[indices[i + 2]];
            if (!a || !b || !c) throw new Error(`GLB: mesh ${node.mesh} primitive index out of range (${positions.length} positions).`);
            triangles.push({ a, b, c, group });
          }
        } else {
          if (positions.length % 3 !== 0) throw new Error(`GLB: mesh ${node.mesh} primitive has ${positions.length} positions and no indices; not a multiple of 3.`);
          for (let i = 0; i < positions.length; i += 3) triangles.push({ a: positions[i], b: positions[i + 1], c: positions[i + 2], group });
        }
      }
    }
    for (const child of node.children ?? []) visit(child, world);
  };
  for (const rootIdx of scene.nodes ?? []) visit(rootIdx, IDENTITY);
  return triangles;
}
