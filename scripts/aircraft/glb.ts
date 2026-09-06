import { Matrix4, Quaternion, Vector3 } from 'three';

export const aircraftNodeIds = [
  'aircraft.root', 'propeller.spin', 'control.rudder',
  'control.elevator.port', 'control.elevator.starboard',
  'control.aileron.port', 'control.aileron.starboard',
  'gear.port', 'gear.starboard', 'gear.tail', 'socket.payload', 'socket.deck',
] as const;

export interface AircraftDimensions { id: string; length: number; wingspan: number }
interface Node {
  name?: string; mesh?: number; children?: number[]; matrix?: number[];
  translation?: number[]; rotation?: number[]; scale?: number[]; extras?: Record<string, unknown>;
}
interface Accessor {
  bufferView?: number; byteOffset?: number; componentType: number; count: number;
  type: string; min?: number[]; max?: number[]; sparse?: unknown;
}
interface Gltf {
  asset: { version: string }; nodes: Node[]; scene?: number;
  scenes: { nodes: number[]; extras?: Record<string, unknown> }[];
  meshes: { primitives: { mode?: number; material?: number; attributes: Record<string, number>; indices?: number }[] }[];
  accessors: Accessor[];
  buffers: { byteLength: number; uri?: string }[];
  bufferViews: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }[];
  images?: { uri?: string; bufferView?: number; mimeType?: string }[];
  textures?: { source?: number }[];
  materials?: Record<string, unknown>[];
  extensionsRequired?: string[];
}

/** Inspect the independently exported GLB, including its binary vertex/index data. */
export function inspectAircraftGlb(bytes: Buffer, aircraft: AircraftDimensions, contentHash: string, options: { requireTexturedSurface?: boolean } = {}) {
  const require: (condition: unknown, message: string) => asserts condition = (condition, message) => {
    if (!condition) throw new Error(`${aircraft.id}: ${message}`);
  };
  require(bytes.length >= 28 && bytes.readUInt32LE(0) === 0x46546c67 && bytes.readUInt32LE(4) === 2 && bytes.readUInt32LE(8) === bytes.length, 'Invalid GLB header');
  require(bytes.length <= 5 * 1024 * 1024, 'GLB exceeds the 5 MiB asset budget');
  const jsonLength = bytes.readUInt32LE(12), binaryHeader = 20 + jsonLength;
  require(bytes.readUInt32LE(16) === 0x4e4f534a && jsonLength % 4 === 0 && binaryHeader + 8 <= bytes.length, 'Missing or malformed JSON chunk');
  const gltf = JSON.parse(bytes.subarray(20, binaryHeader).toString('utf8')) as Gltf;
  require(gltf.asset?.version === '2.0', 'Unsupported glTF version');
  require(bytes.readUInt32LE(binaryHeader + 4) === 0x004e4942, 'Missing embedded binary chunk');
  const binary = bytes.subarray(binaryHeader + 8);
  require(binary.length === bytes.readUInt32LE(binaryHeader), 'Malformed binary chunk length');
  require(Array.isArray(gltf.buffers) && gltf.buffers.length === 1 && !gltf.buffers[0].uri && gltf.buffers[0].byteLength <= binary.length && gltf.buffers[0].byteLength > binary.length - 4, 'GLB must use one self-contained binary buffer');
  require(!gltf.extensionsRequired?.length, 'Asset requires unsupported glTF extensions');
  for (const view of gltf.bufferViews ?? []) require(view.buffer === 0 && (view.byteOffset ?? 0) >= 0 && view.byteLength >= 0 && (view.byteOffset ?? 0) + view.byteLength <= gltf.buffers[0].byteLength, 'Invalid binary buffer view');
  for (const img of gltf.images ?? []) require(!img.uri && img.bufferView !== undefined && Boolean(gltf.bufferViews[img.bufferView]) && ['image/png', 'image/jpeg'].includes(img.mimeType ?? ''), 'Texture images must be embedded PNG/JPEG resources');
  const scene = gltf.scenes?.[gltf.scene ?? 0];
  require(scene && Array.isArray(scene.nodes), 'Missing default scene');
  require(scene.extras?.contentHash === contentHash, 'GLB source hash is stale; rebuild from the catalog and recipe');
  require(scene.extras?.aircraftId === aircraft.id, 'GLB aircraft ID does not match the catalog');
  require(Array.isArray(gltf.nodes) && Array.isArray(gltf.meshes) && gltf.meshes.length > 0, 'Missing aircraft geometry');

  const byId = new Map<string, number>(), parents = new Map<number, number>();
  gltf.nodes.forEach((node, index) => {
    const id = node.extras?.nodeId;
    if (id !== undefined) {
      require(typeof id === 'string' && id.length > 0 && !byId.has(id), `Invalid or duplicate node ID ${id}`);
      byId.set(id, index);
    }
    const shape = (values: number[] | undefined, count: number) => values === undefined || (values.length === count && values.every(Number.isFinite));
    require(shape(node.matrix, 16) && shape(node.translation, 3) && shape(node.rotation, 4) && shape(node.scale, 3), `Invalid transform on node ${index}`);
    require(!(node.matrix && (node.translation || node.rotation || node.scale)), `Node ${index} combines matrix and TRS`);
    if (node.rotation) require(Math.abs(Math.hypot(...node.rotation) - 1) < 0.0001, `Unnormalized rotation on node ${index}`);
    for (const child of node.children ?? []) {
      require(Number.isInteger(child) && Boolean(gltf.nodes[child]) && !parents.has(child), 'Cyclic or multiply-parented GLB hierarchy');
      parents.set(child, index);
    }
  });
  const nodeIndex = (id: string) => {
    const index = byId.get(id);
    require(index !== undefined, `Missing required export node ${id}`);
    return index;
  };
  const root = nodeIndex('aircraft.root');
  for (const id of aircraftNodeIds) nodeIndex(id);
  const localFrame = (node: Node) => node.matrix ? new Matrix4().fromArray(node.matrix) : new Matrix4().compose(
    new Vector3().fromArray(node.translation ?? [0, 0, 0]),
    new Quaternion().fromArray(node.rotation ?? [0, 0, 0, 1]),
    new Vector3().fromArray(node.scale ?? [1, 1, 1]),
  );
  const frames = (override?: { index: number; rotation: Matrix4 }) => {
    const world = new Map<number, Matrix4>();
    const walk = (index: number, parent: Matrix4) => {
      require(Number.isInteger(index) && Boolean(gltf.nodes[index]) && !world.has(index), 'Cyclic or multiply-parented GLB hierarchy');
      const local = localFrame(gltf.nodes[index]);
      if (override?.index === index) local.multiply(override.rotation);
      const transform = parent.clone().multiply(local);
      require(transform.elements.every(Number.isFinite), 'Nonfinite GLB transform');
      world.set(index, transform);
      for (const child of gltf.nodes[index].children ?? []) walk(child, transform);
    };
    for (const index of scene.nodes) {
      require(!parents.has(index), 'Scene root also has a parent');
      walk(index, new Matrix4());
    }
    require(world.size === gltf.nodes.length, 'Unreachable nodes outside the default scene');
    return world;
  };
  const world = frames();
  const descendsFrom = (index: number, ancestor: number) => {
    for (let current: number | undefined = index; current !== undefined; current = parents.get(current)) if (current === ancestor) return true;
    return false;
  };
  for (const [id, index] of byId) require(descendsFrom(index, root), `${id} is not part of aircraft.root`);
  for (const [index, node] of gltf.nodes.entries()) if (node.mesh !== undefined) require(descendsFrom(index, root), 'Mesh outside aircraft.root');

  const readAccessor = (index: number, expectedType: string) => {
    const accessor = gltf.accessors[index];
    require(accessor && accessor.type === expectedType && accessor.bufferView !== undefined && !accessor.sparse, `Unsupported ${expectedType} accessor ${index}`);
    const view = gltf.bufferViews[accessor.bufferView];
    require(view && Number.isInteger(accessor.count) && accessor.count > 0, `Invalid accessor ${index}`);
    const sizes: Record<number, number> = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 };
    const componentBytes = sizes[accessor.componentType], components = expectedType === 'VEC3' ? 3 : expectedType === 'VEC2' ? 2 : 1;
    require(componentBytes && (expectedType === 'SCALAR' || accessor.componentType === 5126), `Unsupported accessor component type ${accessor.componentType}`);
    const stride = view.byteStride ?? componentBytes * components, offset = accessor.byteOffset ?? 0;
    require(stride >= componentBytes * components && offset >= 0 && offset + (accessor.count - 1) * stride + componentBytes * components <= view.byteLength, `Accessor ${index} exceeds its buffer view`);
    const values = new Array<number[]>(accessor.count);
    for (let i = 0; i < accessor.count; i++) {
      values[i] = [];
      for (let component = 0; component < components; component++) {
        const address = (view.byteOffset ?? 0) + offset + i * stride + component * componentBytes;
        const value = accessor.componentType === 5126 ? binary.readFloatLE(address) : componentBytes === 1 ? binary.readUInt8(address) : componentBytes === 2 ? binary.readUInt16LE(address) : binary.readUInt32LE(address);
        require(Number.isFinite(value), `Nonfinite vertex data in accessor ${index}`);
        values[i].push(value);
      }
    }
    return { accessor, values };
  };
  const bounds = [new Vector3(Infinity, Infinity, Infinity), new Vector3(-Infinity, -Infinity, -Infinity)];
  const vertices = new Map<number, Vector3[]>();
  let triangles = 0, primitives = 0, uvPrimitives = 0, texturedPrimitives = 0, normalPrimitives = 0;
  let minimumTriangleAreaM2 = Infinity;
  for (const [index, node] of gltf.nodes.entries()) {
    if (node.mesh === undefined) continue;
    const mesh = gltf.meshes[node.mesh];
    require(mesh && mesh.primitives.length > 0, `Missing mesh ${node.mesh}`);
    const nodeVertices: Vector3[] = [];
    for (const primitive of mesh.primitives) {
      require((primitive.mode ?? 4) === 4, 'Only triangle mesh primitives are supported');
      require(primitive.material !== undefined && Boolean(gltf.materials?.[primitive.material]), 'Every primitive must have an embedded material');
      const { accessor, values } = readAccessor(primitive.attributes.POSITION, 'VEC3');
      const normalIndex = primitive.attributes.NORMAL;
      if (normalIndex !== undefined) {
        const normals = readAccessor(normalIndex, 'VEC3');
        require(normals.accessor.count === accessor.count, 'Normal and position accessor counts differ');
        require(normals.values.every(value => Math.abs(Math.hypot(...value) - 1) <= 0.01), 'Normal vectors must have unit length');
        normalPrimitives++;
      }
      const material = gltf.materials![primitive.material] as { pbrMetallicRoughness?: { baseColorTexture?: { index: number; texCoord?: number } } };
      const baseColor = material.pbrMetallicRoughness?.baseColorTexture;
      const uvIndex = primitive.attributes.TEXCOORD_0;
      if (uvIndex !== undefined) {
        const uv = readAccessor(uvIndex, 'VEC2');
        require(uv.accessor.count === accessor.count, 'UV and position accessor counts differ');
        uvPrimitives++;
      }
      if (baseColor) {
        require((baseColor.texCoord ?? 0) === 0 && uvIndex !== undefined, 'Base-color texture needs a finite TEXCOORD_0 UV accessor');
        const imageIndex = gltf.textures?.[baseColor.index]?.source;
        require(Number.isInteger(baseColor.index) && imageIndex !== undefined && Number.isInteger(imageIndex) && Boolean(gltf.images?.[imageIndex]), 'Base-color texture references a missing embedded image');
        const img = gltf.images![imageIndex], view = gltf.bufferViews[img.bufferView!];
        const imageBytes = binary.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
        require(img.mimeType === 'image/png' ? imageBytes.length >= 24 && imageBytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a' : imageBytes.length >= 4 && imageBytes.readUInt16BE(0) === 0xffd8, 'Embedded base-color image has an invalid signature');
        texturedPrimitives++;
      }
      const minimum = [Infinity, Infinity, Infinity], maximum = [-Infinity, -Infinity, -Infinity];
      const worldPositions: Vector3[] = [];
      for (const value of values) {
        value.forEach((v, axis) => { minimum[axis] = Math.min(minimum[axis], v); maximum[axis] = Math.max(maximum[axis], v); });
        const vertex = new Vector3().fromArray(value);
        nodeVertices.push(vertex);
        const global = vertex.clone().applyMatrix4(world.get(index)!);
        worldPositions.push(global);
        bounds[0].min(global); bounds[1].max(global);
      }
      require(accessor.min?.length === 3 && accessor.max?.length === 3 && minimum.every((v, axis) => Math.abs(v - accessor.min![axis]) < 0.001) && maximum.every((v, axis) => Math.abs(v - accessor.max![axis]) < 0.001), 'Position accessor bounds disagree with binary vertices');
      let triangleIndices = values.map((_, index) => index);
      if (primitive.indices !== undefined) {
        const indices = readAccessor(primitive.indices, 'SCALAR');
        require([5121, 5123, 5125].includes(indices.accessor.componentType) && indices.values.every(([value]) => value < values.length), 'Triangle index outside its vertex accessor');
        triangleIndices = indices.values.map(([index]) => index);
      }
      const vertexCount = triangleIndices.length;
      require(vertexCount % 3 === 0, 'Incomplete triangle primitive');
      for (let triangle = 0; triangle < vertexCount; triangle += 3) {
        const a = worldPositions[triangleIndices[triangle]], b = worldPositions[triangleIndices[triangle + 1]], c = worldPositions[triangleIndices[triangle + 2]];
        const area = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a)).length() / 2;
        require(Number.isFinite(area) && area > 1e-14, `Degenerate triangle in node ${node.name ?? index}, triangle ${triangle / 3} (area ${area} m²)`);
        minimumTriangleAreaM2 = Math.min(minimumTriangleAreaM2, area);
      }
      triangles += vertexCount / 3;
      primitives++;
    }
    vertices.set(index, nodeVertices);
  }
  require(triangles > 0 && triangles <= 40000, `Aircraft triangle budget exceeded (${triangles}; maximum 40000)`);
  if (options.requireTexturedSurface) require(uvPrimitives > 0 && texturedPrimitives > 0, 'Production aircraft needs UVs and an embedded base-color texture bound to geometry');
  if (options.requireTexturedSurface) require(normalPrimitives === primitives, 'Production aircraft needs finite unit normals on every primitive');
  const dimensions = bounds[1].clone().sub(bounds[0]);
  require(dimensions.toArray().every(v => Number.isFinite(v) && v > 0), 'Invalid aircraft dimensions');
  const near = (actual: number, expected: number, label: string) => require(Math.abs(actual - expected) <= expected * 0.03, `${label} ${actual.toFixed(3)} m differs from catalog ${expected} m by over 3%`);
  near(dimensions.x, aircraft.wingspan, 'Wingspan');
  near(dimensions.z, aircraft.length, 'Length');

  const movingIds = aircraftNodeIds.filter(id => id === 'propeller.spin' || id.startsWith('control.'));
  const joints = movingIds.map(id => {
    const index = nodeIndex(id);
    const movingMeshes = [...vertices.keys()].filter(mesh => descendsFrom(mesh, index));
    require(movingMeshes.length > 0, `${id} has no independently parented moving geometry`);
    require(gltf.nodes[index].mesh === undefined, `${id} must retain an empty pivot node`);
    const rotation = id === 'propeller.spin' ? new Matrix4().makeRotationZ(0.35) : id === 'control.rudder' ? new Matrix4().makeRotationY(0.35) : new Matrix4().makeRotationX(0.35);
    const articulated = frames({ index, rotation });
    let maximumTravel = 0;
    for (const mesh of movingMeshes) for (const vertex of vertices.get(mesh)!) maximumTravel = Math.max(maximumTravel, vertex.clone().applyMatrix4(world.get(mesh)!).distanceTo(vertex.clone().applyMatrix4(articulated.get(mesh)!)));
    require(maximumTravel > 0.005, `${id} articulation does not move its geometry`);
    for (const mesh of vertices.keys()) if (!movingMeshes.includes(mesh)) require(world.get(mesh)!.equals(articulated.get(mesh)!), `${id} moves unrelated geometry`);
    return { id, pivot: new Vector3().setFromMatrixPosition(world.get(index)!).toArray(), movingMeshes: movingMeshes.length, testedRotationRadians: 0.35, maximumVertexTravel: maximumTravel };
  });
  for (const id of ['gear.port', 'gear.starboard', 'gear.tail', 'socket.payload', 'socket.deck']) require(gltf.nodes[nodeIndex(id)].mesh === undefined, `${id} must retain an empty pivot/socket node`);
  const centerZ = (bounds[0].z + bounds[1].z) / 2;
  require(new Vector3().setFromMatrixPosition(world.get(nodeIndex('propeller.spin'))!).z < centerZ && new Vector3().setFromMatrixPosition(world.get(nodeIndex('control.rudder'))!).z > centerZ, 'Aircraft must face runtime -Z');
  for (const control of ['control.elevator', 'control.aileron']) {
    require(new Vector3().setFromMatrixPosition(world.get(nodeIndex(`${control}.port`))!).x < 0 && new Vector3().setFromMatrixPosition(world.get(nodeIndex(`${control}.starboard`))!).x > 0, 'Port/starboard controls violate runtime +X starboard convention');
  }
  return {
    schemaVersion: 1, aircraftId: aircraft.id, contentHash, result: 'passed',
    coordinates: { units: 'meters', right: '+X', up: '+Y', forward: '-Z' },
    bounds: bounds.map(v => v.toArray()), measured: { wingspan: dimensions.x, height: dimensions.y, length: dimensions.z },
    nodeIds: aircraftNodeIds, joints, triangles, meshes: vertices.size, primitives, bytes: bytes.length,
    surfaces: { uvPrimitives, texturedPrimitives, normalPrimitives, embeddedImages: gltf.images?.length ?? 0 },
    geometry: { minimumTriangleAreaM2, rejectedTriangleAreaThresholdM2: 1e-14, degenerateTriangles: 0 },
    historicalAccuracy: 'Not certified; see the aircraft source register and discrepancy report.',
  };
}

/** Each LOD is independently inspected before its reduction is accepted. */
export function inspectAircraftLods(models: [Buffer, Buffer, Buffer], aircraft: AircraftDimensions, contentHash: string, options: { requireTexturedSurface?: boolean } = {}) {
  const reports = models.map((model, level) => {
    try { return inspectAircraftGlb(model, aircraft, contentHash, options); }
    catch (error) { throw new Error(`LOD${level}: ${error instanceof Error ? error.message : String(error)}`); }
  });
  const [base, first, second] = reports.map(report => report.triangles);
  if (!(base > first && first > second)) throw new Error(`${aircraft.id}: LOD triangles must decrease strictly from LOD0 to LOD2`);
  // Small independent controls remain intact; allow their fixed cost around the
  // target 45%/20% reductions without accepting merely nominal LOD changes.
  if (first / base > 0.75 || second / base > 0.45) throw new Error(`${aircraft.id}: LOD reduction misses the approximate 0.45/0.20 triangle targets`);
  return reports;
}
