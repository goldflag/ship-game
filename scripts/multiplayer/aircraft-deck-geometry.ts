import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Box3, Matrix4, Quaternion, Vector3 } from 'three';
import { aircraftGroundPose } from '../../src/simulation/aircraftGroundPose';

interface Node {
  mesh?: number; matrix?: number[]; translation?: number[]; rotation?: number[];
  scale?: number[]; children?: number[]; extras?: Record<string, unknown>;
}
interface Glb {
  nodes: Node[]; scenes: { nodes: number[] }[]; scene?: number;
  meshes: { primitives: { attributes: Record<string, number>; indices?: number }[] }[];
  accessors: { bufferView: number; byteOffset?: number; count: number; componentType: number; type: string; sparse?: unknown }[];
  bufferViews: { byteOffset?: number; byteLength: number; byteStride?: number }[];
}

/** Build-time CPU geometry, measured from the published rig in its resting pose.
 * No renderer/model loading is needed in the simulation. Wing sweep includes
 * intermediate poses so unfolding cannot reserve only its two end positions.
 */
export async function aircraftDeckGeometry(id: string) {
  const bytes = await readFile(`public/models/aircraft/${id}.glb`);
  if (bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) throw new Error(`Invalid aircraft GLB: ${id}`);
  const jsonLength = bytes.readUInt32LE(12), binaryHeader = 20 + jsonLength;
  if (bytes.readUInt32LE(16) !== 0x4e4f534a || bytes.readUInt32LE(binaryHeader + 4) !== 0x004e4942) throw new Error(`Missing aircraft GLB chunks: ${id}`);
  const doc = JSON.parse(bytes.subarray(20, binaryHeader).toString()) as Glb;
  const binary = bytes.subarray(binaryHeader + 8), pose = aircraftGroundPose(id);
  const vertex = new Vector3(), root = new Matrix4().makeRotationX(pose.pitch);
  root.setPosition(0, pose.clearance, 0);
  const contacts = new Map<string, Vector3[]>();
  const gearTriangles = new Map<string, Vector3[][]>();
  const hookPoints: Vector3[] = [];
  let hookFrame: Matrix4 | undefined;
  const layers = new Map<number, Box3>();
  const clip = (polygon: Vector3[], height: number, above: boolean) => {
    const out: Vector3[] = [];
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i], b = polygon[(i + 1) % polygon.length];
      const insideA = above ? a.y >= height : a.y <= height, insideB = above ? b.y >= height : b.y <= height;
      if (insideA) out.push(a);
      if (insideA !== insideB) out.push(a.clone().lerp(b, (height - a.y) / (b.y - a.y)));
    }
    return out;
  };
  const bounds = (fraction: number) => {
    const result = new Box3(), seen = new Set<number>();
    const visit = (index: number, parent: Matrix4, gearOwner?: string, hookOwner = false) => {
      if (seen.has(index)) throw new Error(`Invalid aircraft hierarchy: ${id}`);
      seen.add(index);
      const node = doc.nodes[index];
      const nodeId = String(node.extras?.nodeId);
      if (['gear.port', 'gear.starboard', 'gear.tail'].includes(nodeId)) gearOwner = nodeId;
      const local = node.matrix ? new Matrix4().fromArray(node.matrix) : new Matrix4().compose(
        new Vector3().fromArray(node.translation ?? [0, 0, 0]),
        new Quaternion().fromArray(node.rotation ?? [0, 0, 0, 1]),
        new Vector3().fromArray(node.scale ?? [1, 1, 1]),
      );
      if (pose.foldingWings && String(node.extras?.nodeId).startsWith('wing.fold.')) {
        const axis = node.extras!.foldAxis as number[], degrees = Number(node.extras!.foldAngleDegrees);
        if (!Array.isArray(axis) || axis.length !== 3 || !axis.every(Number.isFinite) || !Number.isFinite(degrees)) throw new Error(`Invalid aircraft fold: ${id}`);
        local.multiply(new Matrix4().makeRotationAxis(new Vector3().fromArray(axis), degrees * Math.PI / 180 * fraction));
      }
      const world = parent.clone().multiply(local);
      if (nodeId === 'arrestor.hook') { hookOwner = true; hookFrame = world.clone(); }
      const capture = fraction === (pose.foldingWings ? 1 : 0);
      for (const primitive of node.mesh === undefined ? [] : doc.meshes[node.mesh].primitives) {
        const a = doc.accessors[primitive.attributes.POSITION], v = doc.bufferViews[a.bufferView];
        if (a.type !== 'VEC3' || a.componentType !== 5126 || a.sparse) throw new Error(`Unsupported aircraft vertex accessor: ${id}`);
        const offset = (v.byteOffset ?? 0) + (a.byteOffset ?? 0), stride = v.byteStride ?? 12;
        if (stride < 12 || (a.byteOffset ?? 0) + (a.count - 1) * stride + 12 > v.byteLength) throw new Error(`Invalid aircraft vertex range: ${id}`);
        const vertices: Vector3[] = [];
        for (let i = 0; i < a.count; i++) {
          const p = offset + i * stride;
          vertex.set(binary.readFloatLE(p), binary.readFloatLE(p + 4), binary.readFloatLE(p + 8)).applyMatrix4(world);
          if (!vertex.toArray().every(Number.isFinite)) throw new Error(`Nonfinite aircraft vertex: ${id}`);
          result.expandByPoint(vertex);
          if (capture || fraction === 0 && gearOwner) vertices.push(vertex.clone());
          if (fraction === 0 && gearOwner) {
            const points = contacts.get(gearOwner) ?? [];
            points.push(vertex.clone()); contacts.set(gearOwner, points);
          }
          if (fraction === 0 && hookOwner) hookPoints.push(vertex.clone());
        }
        if (capture || fraction === 0 && gearOwner) {
          let indices = vertices.map((_, i) => i);
          if (primitive.indices !== undefined) {
            const a = doc.accessors[primitive.indices], v = doc.bufferViews[a.bufferView];
            const size = a.componentType === 5121 ? 1 : a.componentType === 5123 ? 2 : a.componentType === 5125 ? 4 : 0;
            if (!size || a.type !== 'SCALAR' || a.sparse) throw new Error(`Unsupported aircraft triangle indices: ${id}`);
            indices = Array.from({ length: a.count }, (_, i) => {
              const offset = (v.byteOffset ?? 0) + (a.byteOffset ?? 0) + i * (v.byteStride ?? size);
              return size === 1 ? binary.readUInt8(offset) : size === 2 ? binary.readUInt16LE(offset) : binary.readUInt32LE(offset);
            });
          }
          for (let i = 0; i < indices.length; i += 3) {
            const triangle = indices.slice(i, i + 3).map(j => vertices[j]);
            if (triangle.length !== 3 || triangle.some(p => !p)) throw new Error(`Invalid aircraft triangle: ${id}`);
            if (fraction === 0 && gearOwner) {
              const list = gearTriangles.get(gearOwner) ?? [];
              list.push(triangle); gearTriangles.set(gearOwner, list);
            }
            if (!capture) continue;
            const low = Math.floor(Math.min(...triangle.map(p => p.y)) / .25), high = Math.floor(Math.max(...triangle.map(p => p.y)) / .25);
            for (let band = low; band <= high; band++) {
              const polygon = clip(clip(triangle, band * .25, true), (band + 1) * .25, false);
              const box = layers.get(band) ?? new Box3();
              for (const p of polygon) box.expandByPoint(p);
              if (!box.isEmpty()) layers.set(band, box);
            }
          }
        }
      }
      for (const child of node.children ?? []) visit(child, world, gearOwner, hookOwner);
    };
    for (const index of doc.scenes[doc.scene ?? 0].nodes) visit(index, root);
    if (result.isEmpty()) throw new Error(`Empty aircraft deck geometry: ${id}`);
    return result;
  };
  const spread = bounds(0), parked = pose.foldingWings ? bounds(1) : spread.clone();
  const sweep = spread.clone().union(parked);
  if (pose.foldingWings) for (let i = 1; i < 20; i++) sweep.union(bounds(i / 20));
  if (!hookFrame || !hookPoints.length) throw new Error(`Missing aircraft hook geometry: ${id}`);
  const inverseHook = hookFrame.clone().invert();
  const hookHeight = (fraction: number) => {
    const transform = hookFrame!.clone().multiply(new Matrix4().makeRotationX(.65 * fraction)).multiply(inverseHook);
    return hookPoints.reduce((low, p) => Math.min(low, p.clone().applyMatrix4(transform).y), Infinity);
  };
  // Retain a small LOD/contact allowance. On touchdown the CPU constrains both
  // control samples to this fitted stop, preventing interpolation through deck.
  if (hookHeight(0) < .04) throw new Error(`Stowed aircraft hook intersects its deck allowance: ${id}`);
  let hookDeckFraction = 1;
  for (let i = 1; i <= 64; i++) {
    if (hookHeight(i / 64) >= .04) continue;
    let low = (i - 1) / 64, high = i / 64;
    for (let j = 0; j < 20; j++) {
      const middle = (low + high) / 2;
      if (hookHeight(middle) >= .04) low = middle; else high = middle;
    }
    hookDeckFraction = low;
    break;
  }
  for (let i = 0; i <= 64; i++) {
    const transform = hookFrame.clone().multiply(new Matrix4().makeRotationX(.65 * hookDeckFraction * i / 64)).multiply(inverseHook);
    for (const point of hookPoints) sweep.expandByPoint(point.clone().applyMatrix4(transform));
  }
  const value = (box: Box3) => ({ min: box.min.toArray(), max: box.max.toArray() });
  const support = ['gear.port', 'gear.starboard', 'gear.tail'].map(gear => {
    const points = contacts.get(gear);
    if (!points?.length) throw new Error(`Missing aircraft ground support: ${id}/${gear}`);
    const low = points.reduce((min, p) => Math.min(min, p.y), Infinity);
    const bottom = points.filter(p => p.y <= low + .002);
    return bottom.reduce((sum, p) => sum.add(p), new Vector3()).multiplyScalar(1 / bottom.length).toArray();
  });
  const inverseRoot = root.clone().invert();
  const tyres = ['gear.port', 'gear.starboard', 'gear.tail'].map(gear => {
    const points = contacts.get(gear)!;
    const low = Math.min(...points.map(p => p.y));
    const patches: number[][][] = [];
    for (const triangle of gearTriangles.get(gear) ?? []) {
      const polygon = clip(triangle, low + .15, false);
      for (let i = 1; i + 1 < polygon.length; i++) {
        const tri = [polygon[0], polygon[i], polygon[i + 1]];
        if (tri[1].clone().sub(tri[0]).cross(tri[2].clone().sub(tri[0])).lengthSq() < 1e-14) continue;
        patches.push(tri.map(p => p.clone().applyMatrix4(inverseRoot).toArray()));
      }
    }
    if (!patches.length || patches.length > 500) throw new Error(`Invalid aircraft tyre contact patches: ${id}/${gear}`);
    return patches;
  });
  return { version: 1, modelHash: createHash('sha256').update(bytes).digest('hex'), hookDeckFraction, tyres, parked: value(parked), spread: value(spread), sweep: value(sweep), support, layers: [...layers].sort(([a], [b]) => a - b).map(([, box]) => value(box)) };
}
