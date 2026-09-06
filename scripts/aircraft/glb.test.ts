import { describe, expect, test } from 'bun:test';
import { aircraftNodeIds, inspectAircraftGlb, inspectAircraftLods } from './glb';
import { validateAircraftCatalog, validateAircraftShape } from './catalog';
import measuredZero from '../../assets/aircraft/shapes/a6m2-zero.json';

const aircraft = { id: 'test-plane', name: 'Test plane', nation: 'United States', role: 'fighter', year: 1942, length: 8, wingspan: 10 };
const contentHash = 'original-source-hash';
type FixtureNode = { name?: string; extras?: Record<string, unknown>; translation?: number[]; rotation?: number[]; children?: number[]; mesh?: number };

function fixture(options: { textured?: boolean; bodyCopies?: number } = {}) {
  const bodyCopies = options.bodyCopies ?? 1;
  const points = [
    ...Array.from({ length: bodyCopies }, () => [-5, 0, -4, 5, 0, -4, 0, 1, 4]).flat(),
    0, 0, 0, 0.2, 0, 0, 0, 0.2, 0.2,
  ];
  const positionLength = points.length * 4, bodyBytes = bodyCopies * 36;
  const uvBytes = options.textured ? (bodyCopies + 1) * 24 : 0;
  const png = options.textured ? Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN0kAAAAASUVORK5CYII=', 'base64') : Buffer.alloc(0);
  const normalOffset = Math.ceil((positionLength + uvBytes + png.length) / 4) * 4;
  const normalBytes = options.textured ? positionLength : 0;
  const binary = Buffer.alloc(normalOffset + normalBytes);
  points.forEach((value, index) => binary.writeFloatLE(value, index * 4));
  if (options.textured) {
    for (let index = 0; index < uvBytes / 4; index++) binary.writeFloatLE(index % 2, positionLength + index * 4);
    png.copy(binary, positionLength + uvBytes);
    for (let index = 0; index < points.length / 3; index++) binary.writeFloatLE(1, normalOffset + index * 12 + 4);
  }
  const nodes: FixtureNode[] = aircraftNodeIds.map(id => ({ extras: { nodeId: id }, children: [] }));
  nodes[0].children = aircraftNodeIds.slice(1).map((_, index) => index + 1);
  const pivots = [[0, 0, -3.6], [0, 0, 3], [-1, 0, 2.5], [1, 0, 2.5], [-3, 0, 0.7], [3, 0, 0.7]];
  for (const [offset, translation] of pivots.entries()) {
    nodes[offset + 1].translation = translation;
    nodes[offset + 1].children = [nodes.length];
    nodes.push({ mesh: 1 });
  }
  nodes[0].children!.push(nodes.length);
  nodes.push({ mesh: 0 });
  const gltf = {
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0], extras: { contentHash, aircraftId: aircraft.id } }], nodes,
    meshes: [0, 1].map(index => ({ primitives: [{ attributes: { POSITION: index, ...(options.textured ? { TEXCOORD_0: index + 2, NORMAL: index + 4 } : {}) } as Record<string, number>, material: 0 }] })),
    accessors: [
      { bufferView: 0, componentType: 5126, count: bodyCopies * 3, type: 'VEC3', min: [-5, 0, -4], max: [5, 1, 4] },
      { bufferView: 1, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [0.2, 0.2, 0.2] },
      ...(options.textured ? [bodyCopies * 3, 3].map((count, index) => ({ bufferView: index + 2, componentType: 5126, count, type: 'VEC2', min: [0, 0], max: [1, 1] })) : []),
      ...(options.textured ? [bodyCopies * 3, 3].map((count, index) => ({ bufferView: index + 5, componentType: 5126, count, type: 'VEC3', min: [0, 1, 0], max: [0, 1, 0] })) : []),
    ],
    buffers: [{ byteLength: binary.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: bodyBytes }, { buffer: 0, byteOffset: bodyBytes, byteLength: 36 },
      ...(options.textured ? [
        { buffer: 0, byteOffset: positionLength, byteLength: bodyCopies * 24 },
        { buffer: 0, byteOffset: positionLength + bodyCopies * 24, byteLength: 24 },
        { buffer: 0, byteOffset: positionLength + uvBytes, byteLength: png.length },
        { buffer: 0, byteOffset: normalOffset, byteLength: bodyBytes },
        { buffer: 0, byteOffset: normalOffset + bodyBytes, byteLength: 36 },
      ] : []),
    ],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [0.2, 0.4, 0.6, 1], metallicFactor: 0, roughnessFactor: 0.7, ...(options.textured ? { baseColorTexture: { index: 0 } } : {}) } }],
    images: (options.textured ? [{ bufferView: 4, mimeType: 'image/png' }] : []) as { uri?: string; bufferView?: number; mimeType?: string }[],
    textures: options.textured ? [{ source: 0 }] : [],
  };
  const encode = () => {
    const serialized = Buffer.from(JSON.stringify(gltf));
    const json = Buffer.alloc(Math.ceil(serialized.length / 4) * 4, 32);
    serialized.copy(json);
    const bytes = Buffer.alloc(28 + json.length + binary.length);
    bytes.writeUInt32LE(0x46546c67, 0); bytes.writeUInt32LE(2, 4); bytes.writeUInt32LE(bytes.length, 8);
    bytes.writeUInt32LE(json.length, 12); bytes.writeUInt32LE(0x4e4f534a, 16); json.copy(bytes, 20);
    bytes.writeUInt32LE(binary.length, 20 + json.length); bytes.writeUInt32LE(0x004e4942, 24 + json.length); binary.copy(bytes, 28 + json.length);
    return bytes;
  };
  return { gltf, binary, encode };
}

describe('aircraft GLB contract', () => {
  test('measures exported binary geometry and exercises every independent control', () => {
    const report = inspectAircraftGlb(fixture().encode(), aircraft, contentHash);
    expect(report.measured).toEqual({ wingspan: 10, height: 1, length: 8 });
    expect(report.triangles).toBe(7);
    expect(report.joints).toHaveLength(6);
    expect(report.joints.every(joint => joint.maximumVertexTravel > 0.005)).toBe(true);
  });
  test('rejects stale source hash and mismatched aircraft identity', () => {
    const source = fixture();
    expect(() => inspectAircraftGlb(source.encode(), aircraft, 'new-source-hash')).toThrow('source hash is stale');
    source.gltf.scenes[0].extras.aircraftId = 'other-plane';
    expect(() => inspectAircraftGlb(source.encode(), aircraft, contentHash)).toThrow('aircraft ID');
  });
  test('rejects malformed and externally dependent files', () => {
    expect(() => inspectAircraftGlb(Buffer.from('broken'), aircraft, contentHash)).toThrow('Invalid GLB header');
    const source = fixture();
    source.gltf.images.push({ uri: 'outside.png' });
    expect(() => inspectAircraftGlb(source.encode(), aircraft, contentHash)).toThrow('embedded PNG/JPEG');
  });
  test('checks actual vertex values instead of trusting accessor bounds', () => {
    const source = fixture();
    source.binary.writeFloatLE(-8, 0);
    expect(() => inspectAircraftGlb(source.encode(), aircraft, contentHash)).toThrow('bounds disagree');
    source.binary.writeFloatLE(NaN, 0);
    expect(() => inspectAircraftGlb(source.encode(), aircraft, contentHash)).toThrow('Nonfinite vertex');
  });
  test('rejects out-of-bounds accessors', () => {
    const source = fixture();
    source.gltf.accessors[0].count = 30;
    expect(() => inspectAircraftGlb(source.encode(), aircraft, contentHash)).toThrow('exceeds its buffer view');
  });
  test('rejects duplicate IDs and multiply-parented nodes', () => {
    const source = fixture();
    source.gltf.nodes[2].extras = source.gltf.nodes[1].extras;
    expect(() => inspectAircraftGlb(source.encode(), aircraft, contentHash)).toThrow('duplicate node ID');
    const shared = fixture();
    shared.gltf.nodes[2].children!.push(shared.gltf.nodes[1].children![0]);
    expect(() => inspectAircraftGlb(shared.encode(), aircraft, contentHash)).toThrow('multiply-parented');
  });
  test('rejects missing and detached moving geometry', () => {
    const source = fixture();
    source.gltf.nodes[1].extras = {};
    expect(() => inspectAircraftGlb(source.encode(), aircraft, contentHash)).toThrow('Missing required export node propeller.spin');
    const detached = fixture();
    detached.gltf.nodes[0].children!.push(...detached.gltf.nodes[1].children!);
    detached.gltf.nodes[1].children = [];
    expect(() => inspectAircraftGlb(detached.encode(), aircraft, contentHash)).toThrow('no independently parented moving geometry');
  });
  test('rejects objects leaked from another interactive Blender scene', () => {
    const source = fixture();
    source.gltf.scenes[0].nodes.push(source.gltf.nodes.length);
    source.gltf.nodes.push({ name: 'Cube', mesh: 0 });
    expect(() => inspectAircraftGlb(source.encode(), aircraft, contentHash)).toThrow('Mesh outside aircraft.root');
  });
  test('rejects backwards aircraft and swapped port/starboard controls', () => {
    const source = fixture();
    source.gltf.nodes[0].rotation = [0, 1, 0, 0];
    expect(() => inspectAircraftGlb(source.encode(), aircraft, contentHash)).toThrow('face runtime -Z');
    const swapped = fixture();
    swapped.gltf.nodes[3].translation![0] = 1;
    expect(() => inspectAircraftGlb(swapped.encode(), aircraft, contentHash)).toThrow('Port/starboard controls');
  });
  test('rejects dimensions outside the three percent allowance', () => {
    expect(() => inspectAircraftGlb(fixture().encode(), { ...aircraft, wingspan: 11 }, contentHash)).toThrow('Wingspan');
    expect(() => inspectAircraftGlb(fixture().encode(), { ...aircraft, length: 10 }, contentHash)).toThrow('Length');
  });
  test('production checks require a texture actually bound to finite UV geometry', () => {
    expect(() => inspectAircraftGlb(fixture().encode(), aircraft, contentHash, { requireTexturedSurface: true })).toThrow('Production aircraft needs UVs');
    const source = fixture({ textured: true });
    const report = inspectAircraftGlb(source.encode(), aircraft, contentHash, { requireTexturedSurface: true });
    expect(report.surfaces).toEqual({ uvPrimitives: 7, texturedPrimitives: 7, normalPrimitives: 7, embeddedImages: 1 });
    delete source.gltf.meshes[0].primitives[0].attributes.TEXCOORD_0;
    expect(() => inspectAircraftGlb(source.encode(), aircraft, contentHash)).toThrow('needs a finite TEXCOORD_0');
  });
  test('rejects malformed UV accessors and broken embedded texture bindings', () => {
    const nonfinite = fixture({ textured: true });
    nonfinite.binary.writeFloatLE(NaN, 72);
    expect(() => inspectAircraftGlb(nonfinite.encode(), aircraft, contentHash)).toThrow('Nonfinite vertex data');
    const count = fixture({ textured: true });
    count.gltf.accessors[2].count = 2;
    expect(() => inspectAircraftGlb(count.encode(), aircraft, contentHash)).toThrow('UV and position accessor counts differ');
    const missing = fixture({ textured: true });
    missing.gltf.textures[0].source = 2;
    expect(() => inspectAircraftGlb(missing.encode(), aircraft, contentHash)).toThrow('missing embedded image');
    const corrupt = fixture({ textured: true });
    corrupt.binary.writeUInt32LE(0, 120);
    expect(() => inspectAircraftGlb(corrupt.encode(), aircraft, contentHash)).toThrow('invalid signature');
  });
  test('all three LOD binaries retain dimensions, source identity, textures and six independent controls', () => {
    const models = [40, 15, 3].map(bodyCopies => fixture({ textured: true, bodyCopies }).encode()) as [Buffer, Buffer, Buffer];
    const reports = inspectAircraftLods(models, aircraft, contentHash, { requireTexturedSurface: true });
    expect(reports.map(report => report.triangles)).toEqual([46, 21, 9]);
    expect(reports.every(report => report.joints.length === 6)).toBe(true);
    const stale = fixture({ bodyCopies: 3 });
    stale.gltf.scenes[0].extras.contentHash = 'old-lod-source';
    expect(() => inspectAircraftLods([models[0], models[1], stale.encode()], aircraft, contentHash)).toThrow('source hash is stale');
    expect(() => inspectAircraftLods([models[0], models[1], stale.encode()], aircraft, contentHash)).toThrow('LOD2:');
    const detached = fixture({ bodyCopies: 3 });
    detached.gltf.nodes[1].extras = {};
    expect(() => inspectAircraftLods([models[0], models[1], detached.encode()], aircraft, contentHash)).toThrow('Missing required export node');
  });
  test('rejects identical, reversed and merely nominal LOD reductions', () => {
    const make = (bodyCopies: number) => fixture({ bodyCopies }).encode();
    expect(() => inspectAircraftLods([make(40), make(40), make(3)], aircraft, contentHash)).toThrow('decrease strictly');
    expect(() => inspectAircraftLods([make(40), make(3), make(15)], aircraft, contentHash)).toThrow('decrease strictly');
    expect(() => inspectAircraftLods([make(40), make(38), make(35)], aircraft, contentHash)).toThrow('approximate 0.45/0.20');
  });
  test('rejects collinear triangles from actual binary positions even when bounds agree', () => {
    const source = fixture();
    source.binary.writeFloatLE(0, 24); source.binary.writeFloatLE(0, 28); source.binary.writeFloatLE(-4, 32);
    source.gltf.accessors[0].min = [-5, 0, -4]; source.gltf.accessors[0].max = [5, 0, -4];
    expect(() => inspectAircraftGlb(source.encode(), aircraft, contentHash)).toThrow('Degenerate triangle');
    const valid = inspectAircraftGlb(fixture().encode(), aircraft, contentHash);
    expect(valid.geometry.minimumTriangleAreaM2).toBeGreaterThan(1e-14);
    expect(valid.geometry.degenerateTriangles).toBe(0);
  });
  test('rejects zero/nonfinite normals, mismatched counts and missing production normals', () => {
    const zero = fixture({ textured: true });
    zero.binary.writeFloatLE(0, zero.gltf.bufferViews[5].byteOffset + 4);
    expect(() => inspectAircraftGlb(zero.encode(), aircraft, contentHash)).toThrow('Normal vectors must have unit length');
    const nonfinite = fixture({ textured: true });
    nonfinite.binary.writeFloatLE(NaN, nonfinite.gltf.bufferViews[5].byteOffset);
    expect(() => inspectAircraftGlb(nonfinite.encode(), aircraft, contentHash)).toThrow('Nonfinite vertex data');
    const count = fixture({ textured: true }); count.gltf.accessors[4].count = 2;
    expect(() => inspectAircraftGlb(count.encode(), aircraft, contentHash)).toThrow('Normal and position accessor counts differ');
    const missing = fixture({ textured: true }); delete missing.gltf.meshes[0].primitives[0].attributes.NORMAL;
    expect(() => inspectAircraftGlb(missing.encode(), aircraft, contentHash, { requireTexturedSurface: true })).toThrow('unit normals on every primitive');
  });
});

describe('measured aircraft shape contract', () => {
  const shape = () => structuredClone(measuredZero);
  test('accepts retained measured source stations without requiring manufacturing sections', () => {
    expect(validateAircraftShape(shape(), 'a6m2-zero').reference.imagePath).toContain('references/schematics');
  });
  test('rejects inverted canopy/body contours and negative widths before building', () => {
    const inverted = shape();
    inverted.canopy[2][2] = inverted.canopy[2][3] + 0.1;
    expect(() => validateAircraftShape(inverted, inverted.id)).toThrow('bottom/base must not exceed top');
    const negative = shape();
    negative.fuselage[2][1] = -0.1;
    expect(() => validateAircraftShape(negative, negative.id)).toThrow('width cannot be negative');
  });
  test('rejects nonfinite, unordered, reversed chord and incomplete span stations', () => {
    const nonfinite = shape(); nonfinite.fuselage[3][2] = Infinity;
    expect(() => validateAircraftShape(nonfinite, nonfinite.id)).toThrow('finite numbers');
    const unordered = shape(); unordered.fuselage[4][0] = unordered.fuselage[3][0];
    expect(() => validateAircraftShape(unordered, unordered.id)).toThrow('stations must increase');
    const chord = shape(); chord.wing[3][1] = chord.wing[3][2] + 0.1;
    expect(() => validateAircraftShape(chord, chord.id)).toThrow('leading/trailing');
    const clipped = shape(); clipped.wing.forEach(row => { row[0] *= 0.97; });
    expect(() => validateAircraftShape(clipped, clipped.id)).toThrow('tip 1');
  });
  test('requires a useful fin, valid fittings and named reference evidence', () => {
    const fin = shape(); fin.fin = fin.fin.slice(0, 2);
    expect(() => validateAircraftShape(fin, fin.id)).toThrow('at least three');
    const prop = shape(); prop.propeller.radiusM = 0;
    expect(() => validateAircraftShape(prop, prop.id)).toThrow('propeller');
    const source = shape(); source.reference.imagePath = '';
    expect(() => validateAircraftShape(source, source.id)).toThrow('reference.imagePath');
    expect(() => validateAircraftShape(shape(), 'wrong-plane')).toThrow('aircraft ID');
  });
});

describe('versioned aircraft catalog', () => {
  test('accepts a WWII-era authored variant', () => {
    expect(validateAircraftCatalog({ schemaVersion: 1, aircraft: [aircraft] }).aircraft[0].id).toBe(aircraft.id);
  });
  test('rejects incompatible schemas, duplicate IDs, path traversal, and invalid dimensions', () => {
    expect(() => validateAircraftCatalog({ schemaVersion: 2, aircraft: [aircraft] })).toThrow('schemaVersion');
    expect(() => validateAircraftCatalog({ schemaVersion: 1, aircraft: [aircraft, aircraft] })).toThrow('duplicate');
    expect(() => validateAircraftCatalog({ schemaVersion: 1, aircraft: [{ ...aircraft, id: '../outside' }] })).toThrow('aircraft ID');
    expect(() => validateAircraftCatalog({ schemaVersion: 1, aircraft: [{ ...aircraft, length: NaN }] })).toThrow('invalid length');
  });
});
