import { expect, test } from 'bun:test';
import { parseMeshFile, type MeshTriangle } from './meshFile';

// A unit cube (8 vertices, 12 triangles, outward CCW winding) built the same way in every
// format's fixture builder below, so a single geometric check proves the parsers agree.
type P = [number, number, number];
const V: Record<string, P> = { v0: [0, 0, 0], v1: [1, 0, 0], v2: [1, 1, 0], v3: [0, 1, 0], v4: [0, 0, 1], v5: [1, 0, 1], v6: [1, 1, 1], v7: [0, 1, 1] };
const CUBE_FACES: [string, string, string][] = [
  ['v0', 'v2', 'v1'], ['v0', 'v3', 'v2'],
  ['v4', 'v5', 'v6'], ['v4', 'v6', 'v7'],
  ['v0', 'v1', 'v5'], ['v0', 'v5', 'v4'],
  ['v3', 'v7', 'v6'], ['v3', 'v6', 'v2'],
  ['v0', 'v4', 'v7'], ['v0', 'v7', 'v3'],
  ['v1', 'v2', 'v6'], ['v1', 'v6', 'v5'],
];
const VERTEX_ORDER = ['v0', 'v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7'];

const cross = (a: P, b: P): P => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: P, b: P) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: P, b: P): P => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
/** The Gauss/divergence-theorem signed volume of a closed triangle mesh: positive for outward-facing CCW winding. */
function signedVolume(triangles: MeshTriangle[]): number {
  return triangles.reduce((v, t) => v + dot(t.a, cross(t.b, t.c)), 0) / 6;
}
function surfaceArea(triangles: MeshTriangle[]): number {
  return triangles.reduce((s, t) => s + 0.5 * Math.hypot(...cross(sub(t.b, t.a), sub(t.c, t.a))), 0);
}
function vertexSet(triangles: MeshTriangle[]): Set<string> {
  return new Set(triangles.flatMap((t) => [t.a, t.b, t.c]).map((p) => p.map((n) => n.toFixed(4)).join(',')));
}
function expectCube(triangles: MeshTriangle[]) {
  expect(triangles).toHaveLength(12);
  expect(surfaceArea(triangles)).toBeCloseTo(6, 6);
  expect(signedVolume(triangles)).toBeCloseTo(1, 6);
  expect(vertexSet(triangles).size).toBe(8);
}

// --- fixture builders -----------------------------------------------------------------------

function cubeObj(): Uint8Array {
  const idx = Object.fromEntries(VERTEX_ORDER.map((n, i) => [n, i + 1]));
  let text = VERTEX_ORDER.map((n) => `v ${V[n][0]} ${V[n][1]} ${V[n][2]}`).join('\n') + '\n';
  text += 'usemtl hull\n' + CUBE_FACES.map(([a, b, c]) => `f ${idx[a]} ${idx[b]} ${idx[c]}`).join('\n') + '\n';
  return new TextEncoder().encode(text);
}

function cubeStlAscii(): Uint8Array {
  let text = 'solid cube\n';
  for (const [a, b, c] of CUBE_FACES) {
    text += 'facet normal 0 0 0\nouter loop\n';
    for (const n of [a, b, c]) text += `vertex ${V[n][0]} ${V[n][1]} ${V[n][2]}\n`;
    text += 'endloop\nendfacet\n';
  }
  return new TextEncoder().encode(text + 'endsolid cube\n');
}

function cubeStlBinary(headerText = ''): Uint8Array {
  const count = CUBE_FACES.length;
  const buf = new ArrayBuffer(84 + 50 * count);
  const bytes = new Uint8Array(buf), view = new DataView(buf);
  bytes.set(new TextEncoder().encode(headerText).subarray(0, 80), 0);
  view.setUint32(80, count, true);
  let offset = 84;
  for (const [a, b, c] of CUBE_FACES) {
    offset += 12; // facet normal left as zero
    for (const n of [a, b, c]) { const p = V[n]; view.setFloat32(offset, p[0], true); view.setFloat32(offset + 4, p[1], true); view.setFloat32(offset + 8, p[2], true); offset += 12; }
    offset += 2; // attribute byte count
  }
  return bytes;
}

function cubePlyAscii(): Uint8Array {
  const idx = Object.fromEntries(VERTEX_ORDER.map((n, i) => [n, i]));
  let text = `ply\nformat ascii 1.0\nelement vertex ${VERTEX_ORDER.length}\nproperty float x\nproperty float y\nproperty float z\n`;
  text += `element face ${CUBE_FACES.length}\nproperty list uchar int vertex_indices\nend_header\n`;
  text += VERTEX_ORDER.map((n) => `${V[n][0]} ${V[n][1]} ${V[n][2]}`).join('\n') + '\n';
  text += CUBE_FACES.map(([a, b, c]) => `3 ${idx[a]} ${idx[b]} ${idx[c]}`).join('\n') + '\n';
  return new TextEncoder().encode(text);
}

function cubePlyBinary(): Uint8Array {
  const idx = Object.fromEntries(VERTEX_ORDER.map((n, i) => [n, i]));
  const header = `ply\nformat binary_little_endian 1.0\nelement vertex ${VERTEX_ORDER.length}\nproperty float x\nproperty float y\nproperty float z\n` +
    `element face ${CUBE_FACES.length}\nproperty list uchar int vertex_indices\nend_header\n`;
  const headerBytes = new TextEncoder().encode(header);
  const bodySize = VERTEX_ORDER.length * 12 + CUBE_FACES.length * (1 + 3 * 4);
  const buf = new ArrayBuffer(headerBytes.length + bodySize);
  const bytes = new Uint8Array(buf), view = new DataView(buf);
  bytes.set(headerBytes, 0);
  let offset = headerBytes.length;
  for (const n of VERTEX_ORDER) { const p = V[n]; view.setFloat32(offset, p[0], true); view.setFloat32(offset + 4, p[1], true); view.setFloat32(offset + 8, p[2], true); offset += 12; }
  for (const [a, b, c] of CUBE_FACES) {
    view.setUint8(offset, 3); offset += 1;
    for (const n of [a, b, c]) { view.setInt32(offset, idx[n], true); offset += 4; }
  }
  return bytes;
}

function packGlb(json: unknown, bin: Uint8Array): Uint8Array {
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonChunk = new Uint8Array(jsonBytes.length + ((4 - (jsonBytes.length % 4)) % 4)).fill(0x20);
  jsonChunk.set(jsonBytes);
  const binChunk = new Uint8Array(bin.length + ((4 - (bin.length % 4)) % 4));
  binChunk.set(bin);
  const total = 12 + 8 + jsonChunk.length + 8 + binChunk.length;
  const bytes = new Uint8Array(total), view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode('glTF'), 0);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  let offset = 12;
  view.setUint32(offset, jsonChunk.length, true); view.setUint32(offset + 4, 0x4e4f534a, true); bytes.set(jsonChunk, offset + 8); offset += 8 + jsonChunk.length;
  view.setUint32(offset, binChunk.length, true); view.setUint32(offset + 4, 0x004e4942, true); bytes.set(binChunk, offset + 8);
  return bytes;
}

function cubeGlbBuffers(): { bin: Uint8Array; posByteLength: number; idxByteLength: number } {
  const idx = Object.fromEntries(VERTEX_ORDER.map((n, i) => [n, i]));
  const positions = new Float32Array(VERTEX_ORDER.length * 3);
  VERTEX_ORDER.forEach((n, i) => { const p = V[n]; positions[i * 3] = p[0]; positions[i * 3 + 1] = p[1]; positions[i * 3 + 2] = p[2]; });
  const indices = new Uint16Array(CUBE_FACES.flatMap(([a, b, c]) => [idx[a], idx[b], idx[c]]));
  const posBuf = new Uint8Array(positions.buffer), idxBuf = new Uint8Array(indices.buffer);
  const bin = new Uint8Array(posBuf.length + idxBuf.length);
  bin.set(posBuf, 0); bin.set(idxBuf, posBuf.length);
  return { bin, posByteLength: posBuf.length, idxByteLength: idxBuf.length };
}

function cubeGlbJson(translation: P, scale: P, posByteLength: number, idxByteLength: number) {
  return {
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, translation, scale }],
    meshes: [{ name: 'Cube', primitives: [{ attributes: { POSITION: 0 }, indices: 1, mode: 4, material: 0 }] }],
    materials: [{ name: 'hull' }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 8, type: 'VEC3' }, { bufferView: 1, componentType: 5123, count: 36, type: 'SCALAR' }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: posByteLength }, { buffer: 0, byteOffset: posByteLength, byteLength: idxByteLength }],
    buffers: [{ byteLength: posByteLength + idxByteLength }],
  };
}

function cubeGlb(translation: P = [0, 0, 0], scale: P = [1, 1, 1]): Uint8Array {
  const { bin, posByteLength, idxByteLength } = cubeGlbBuffers();
  return packGlb(cubeGlbJson(translation, scale, posByteLength, idxByteLength), bin);
}

function cubeGlbWithUri(): Uint8Array {
  const { bin, posByteLength, idxByteLength } = cubeGlbBuffers();
  const json = cubeGlbJson([0, 0, 0], [1, 1, 1], posByteLength, idxByteLength) as { buffers: { byteLength: number; uri?: string }[] };
  json.buffers[0] = { byteLength: posByteLength + idxByteLength, uri: 'external.bin' };
  return packGlb(json, bin);
}

// --- cross-format agreement ------------------------------------------------------------------

test('OBJ, STL, PLY and GLB parse the same unit cube: 12 triangles, same vertex set, area 6, volume 1', () => {
  const results = [
    parseMeshFile('cube.obj', cubeObj()),
    parseMeshFile('cube.stl', cubeStlAscii()),
    parseMeshFile('cube.ply', cubePlyAscii()),
    parseMeshFile('cube.glb', cubeGlb()),
  ];
  expect(results.map((r) => r.format)).toEqual(['obj', 'stl', 'ply', 'glb']);
  const expected = vertexSet(results[0].triangles);
  expect(expected.size).toBe(8);
  for (const r of results) { expectCube(r.triangles); expect(vertexSet(r.triangles)).toEqual(expected); }
});

// --- OBJ --------------------------------------------------------------------------------------

test('OBJ: usemtl sets the face group, groups are collected and sorted', () => {
  const parsed = parseMeshFile('cube.obj', cubeObj());
  expect(parsed.groups).toEqual(['hull']);
  expect(parsed.triangles.every((t) => t.group === 'hull')).toBe(true);
});

test('OBJ: negative relative indices resolve against the vertices seen so far', () => {
  const text = 'v 0 0 0\nv 1 0 0\nv 0 1 0\nf -3 -2 -1\n';
  const parsed = parseMeshFile('tri.obj', new TextEncoder().encode(text));
  expect(parsed.triangles).toEqual([{ a: [0, 0, 0], b: [1, 0, 0], c: [0, 1, 0], group: undefined }]);
});

test('OBJ: an n-gon face is fan-triangulated from its first vertex', () => {
  const text = 'v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1 2 3 4\n';
  const parsed = parseMeshFile('quad.obj', new TextEncoder().encode(text));
  expect(parsed.triangles).toHaveLength(2);
  expect(parsed.triangles[0]).toMatchObject({ a: [0, 0, 0], b: [1, 0, 0], c: [1, 1, 0] });
  expect(parsed.triangles[1]).toMatchObject({ a: [0, 0, 0], b: [1, 1, 0], c: [0, 1, 0] });
});

// --- STL --------------------------------------------------------------------------------------

test('STL: binary is detected by length even when the 80-byte header starts with the word "solid"', () => {
  const parsed = parseMeshFile('cube.stl', cubeStlBinary('solid cube (this is actually binary)'));
  expectCube(parsed.triangles);
  expect(parsed.groups).toEqual([]); // binary STL carries no group name
});

test('STL: ASCII takes its group from the "solid <name>" line', () => {
  const parsed = parseMeshFile('cube.stl', cubeStlAscii());
  expectCube(parsed.triangles);
  expect(parsed.groups).toEqual(['cube']);
});

// --- PLY --------------------------------------------------------------------------------------

test('PLY: ASCII and binary_little_endian agree on the same cube, with no group', () => {
  const ascii = parseMeshFile('cube.ply', cubePlyAscii());
  const binary = parseMeshFile('cube.ply', cubePlyBinary());
  expectCube(ascii.triangles); expectCube(binary.triangles);
  expect(ascii.groups).toEqual([]); expect(binary.groups).toEqual([]);
  expect(vertexSet(ascii.triangles)).toEqual(vertexSet(binary.triangles));
});

// --- GLB --------------------------------------------------------------------------------------

test('GLB: identity-transform node parses the cube with the material name as group', () => {
  const parsed = parseMeshFile('cube.glb', cubeGlb());
  expectCube(parsed.triangles);
  expect(parsed.groups).toEqual(['hull']);
});

test('GLB: a node transform (translation + scale) moves the cube as expected', () => {
  const parsed = parseMeshFile('cube.glb', cubeGlb([2, 3, 4], [2, 2, 2]));
  expect(surfaceArea(parsed.triangles)).toBeCloseTo(24, 5); // area scales with the square of scale
  expect(signedVolume(parsed.triangles)).toBeCloseTo(8, 5); // volume scales with the cube of scale
  const points = vertexSet(parsed.triangles);
  expect(points.has('2.0000,3.0000,4.0000')).toBe(true); // v0 * scale + translation
  expect(points.has('4.0000,5.0000,6.0000')).toBe(true); // v6 * scale + translation
});

test('GLB: a buffer with a "uri" is rejected, since only the embedded BIN chunk is supported', () => {
  expect(() => parseMeshFile('cube.glb', cubeGlbWithUri())).toThrow(/uri/i);
});

// --- error cases ------------------------------------------------------------------------------

test('errors: an unknown extension names the extension', () => {
  expect(() => parseMeshFile('cube.xyz', new Uint8Array([1, 2, 3]))).toThrow(/\.xyz/);
});

test('errors: a truncated binary STL is rejected with a clear message', () => {
  const truncated = cubeStlBinary().slice(0, 100);
  expect(() => parseMeshFile('cube.stl', truncated)).toThrow(/STL/);
});

test('errors: a PLY header with no "end_header" is rejected with a clear message', () => {
  const bytes = new TextEncoder().encode('ply\nformat ascii 1.0\nelement vertex 1\nproperty float x\nproperty float y\nproperty float z\n');
  expect(() => parseMeshFile('cube.ply', bytes)).toThrow(/end_header/);
});

test('errors: a GLB with a bad magic is rejected with a clear message', () => {
  const corrupted = cubeGlb().slice();
  corrupted.set(new TextEncoder().encode('FAKE'), 0);
  expect(() => parseMeshFile('cube.glb', corrupted)).toThrow(/magic/i);
});

test('errors: a .gltf JSON file is rejected and told to use .glb', () => {
  expect(() => parseMeshFile('cube.gltf', new TextEncoder().encode('{}'))).toThrow(/\.glb/);
});
