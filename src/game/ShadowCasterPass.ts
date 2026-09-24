import * as THREE from 'three/webgpu';
import { FleetBatch } from './FleetBatch';
import { subtreePruning, type SubtreePruning } from './SubtreeLayers';

/** Depth-only scene passes drawn with WebGPU directly: the sun's shadow maps, and the ships' occlusion
 * prepass. Three renders each as a whole scene pass: it walks every object (the fleet's batched
 * originals stay in the graph, only masked by layers), then prepares each draw through its node
 * material path. What these passes draw is plain depth writes, so a pass collects them once a frame
 * (once for every shadow map, skipping subtrees with nothing on its layers as three's projection does),
 * culls each batched part and instance against each camera, and submits position-only draws from three's
 * own vertex buffers, transformed in the order three's vertex stage transforms them. The passes of one
 * renderer share what they draw (`DepthCasterStore`): each part is prepared once however many passes
 * draw it, and again, and uploaded again, only when it changes. Morph meshes (the
 * canvas gun covers) are blended here as three's vertex stage blends them. Objects
 * three must draw itself (skinned, custom vertex, depth or discard nodes, one-sided, LOD)
 * it still draws, first, from a scene holding only them; a target is left wholly to three until its
 * pipeline and texture exist. */

/** Three r185's `AttributeType` (renderers/common/Constants.js), which three/webgpu does not export. */
const VERTEX_ATTRIBUTE = 1, INDEX_ATTRIBUTE = 2;
/** `GPUBufferUsage` and `GPUShaderStage` flags; the globals exist only where WebGPU does. */
const COPY_DST = 0x8, VERTEX = 0x20, UNIFORM = 0x40, STORAGE = 0x80, VERTEX_STAGE = 0x1;

// The WebGPU surface this pass uses; TypeScript's DOM library does not declare WebGPU.
type GpuBuffer = { readonly size: number; destroy(): void };
type GpuTexture = { readonly width: number; readonly height: number; readonly depthOrArrayLayers: number; readonly format: string; readonly sampleCount: number; createView(): object };
type GpuPass = {
  setPipeline(pipeline: object): void; setBindGroup(index: number, group: object): void; end(): void;
  setVertexBuffer(slot: number, buffer: GpuBuffer, offset?: number): void; setIndexBuffer(buffer: GpuBuffer, format: string): void;
  draw(vertices: number, instances: number, firstVertex: number, firstInstance: number): void;
  drawIndexed(indices: number, instances: number, firstIndex: number, baseVertex: number, firstInstance: number): void;
};
type GpuDevice = {
  queue: { writeBuffer(buffer: GpuBuffer, offset: number, data: ArrayBufferView, dataOffset?: number, size?: number): void; submit(buffers: object[]): void };
  createBuffer(descriptor: { label: string; size: number; usage: number }): GpuBuffer;
  createShaderModule(descriptor: { label: string; code: string }): object;
  createBindGroupLayout(descriptor: object): object;
  createPipelineLayout(descriptor: object): object;
  createRenderPipelineAsync(descriptor: object): Promise<object>;
  createBindGroup(descriptor: object): object;
  createCommandEncoder(descriptor: { label: string }): { beginRenderPass(descriptor: object): GpuPass; finish(): object };
};
/** The pinned r185 internals this pass reads: the device, GPU resources three created, and its attribute uploader. */
type RendererInternals = {
  backend: { device?: GpuDevice; get(resource: object): { buffer?: GpuBuffer; texture?: GpuTexture } };
  _attributes?: { update(attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, type: number): void };
  coordinateSystem: THREE.CoordinateSystem; reversedDepthBuffer: boolean; shadowMap: { type: THREE.ShadowMapType };
};
type BatchInternals = {
  _instanceInfo: { active: boolean; visible: boolean; geometryIndex: number }[];
  _geometryInfo: { active: boolean; start: number; count: number; boundingSphere: THREE.Sphere | null }[];
  _matricesTexture: THREE.DataTexture;
};

const SHADOW_SIDE: Record<number, THREE.Side> = { [THREE.FrontSide]: THREE.BackSide, [THREE.BackSide]: THREE.FrontSide, [THREE.DoubleSide]: THREE.DoubleSide };
const NO_CALLBACK = THREE.Object3D.prototype.onBeforeRender, NO_SHADOW_CALLBACK = THREE.Object3D.prototype.onBeforeShadow;

/** Whether three's shadow material for `material` is a plain depth write this pass reproduces:
 * both faces (one-sided casters would need each instance's winding), and no vertex, depth or
 * discard nodes, alpha test or displacement of its own. Colour maps only feed transmitted shadows. */
export function plainShadowMaterial(material: THREE.Material | THREE.Material[]): boolean {
  if (Array.isArray(material) || !material.visible) return false;
  const m = material as THREE.Material & Record<string, unknown>;
  const side = (m.shadowSide as THREE.Side | null) ?? SHADOW_SIDE[material.side];
  return side === THREE.DoubleSide && !m.positionNode && !m.castShadowPositionNode && !m.depthNode && !m.maskNode && !m.maskShadowNode
    && !m.castShadowNode && !material.alphaTest && !m.alphaMap && !m.displacementMap && !m.wireframe && !material.clippingPlanes?.length;
}

/** Whether three draws an object of `material` with a scene's override material unchanged. Three keeps the
 * material's own position node and displacement map on the override, and draws a material that refuses
 * overrides as itself. It copies alpha test and map too, which an override with its own fragment node never reads. */
export function plainOverrideMaterial(material: THREE.Material | THREE.Material[]): boolean {
  if (Array.isArray(material) || !material.visible) return false;
  const m = material as THREE.Material & Record<string, unknown>;
  return material.allowOverride && !m.positionNode && !m.displacementMap;
}

/** What a pass draws beyond visibility and layers, and which of those it reproduces; the rest stay with three. */
export interface DepthCasterRule {
  takes(object: THREE.Object3D): boolean;
  plain(material: THREE.Material | THREE.Material[]): boolean;
}
/** A shadow map's casters: objects that cast shadows, through three's shadow material. */
export const SHADOW_CASTERS: DepthCasterRule = { takes: object => object.castShadow, plain: plainShadowMaterial };
/** Every object on the layers, through a scene override material that writes depth alone, both faces, from its
 * own fragment node (ShipOcclusion's prepass). */
export const OVERRIDE_DEPTH: DepthCasterRule = { takes: () => true, plain: plainOverrideMaterial };

/** A float32 xyz position this pass can bind as its only vertex buffer. */
function plainPosition(geometry: THREE.BufferGeometry): boolean {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined;
  if (!position || position.itemSize !== 3 || position.normalized) return false;
  const array = (position as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute ? (position as THREE.InterleavedBufferAttribute).data.array : position.array;
  return array instanceof Float32Array && !(geometry as THREE.InstancedBufferGeometry).isInstancedBufferGeometry;
}

/** Instance matrices this pass reads from the CPU copy three uploads: not a storage buffer compute may write, nor morphed per instance. */
function plainInstances(mesh: THREE.InstancedMesh): boolean {
  return !(mesh.instanceMatrix as { isStorageInstancedBufferAttribute?: boolean }).isStorageInstancedBufferAttribute && !mesh.morphTexture && !mesh.morphTargetInfluences?.length;
}

export interface DepthCasters {
  batches: THREE.BatchedMesh[];
  instanced: THREE.InstancedMesh[];
  meshes: THREE.Mesh[];
  /** Objects only three's own render draws; a target they reach is left to it. */
  others: THREE.Object3D[];
}

export const noCasters = (): DepthCasters => ({ batches: [], instanced: [], meshes: [], others: [] });

/** The shadow casters three's pass would visit for `layers`: visible subtrees, objects on those
 * layers with `castShadow`, sorted by how this pass can draw them. `pruning` skips subtrees holding
 * nothing on those layers, as it does for three's own projection. */
export function collectShadowCasters(scene: THREE.Object3D, layers: number, out: DepthCasters = noCasters(), pruning?: Pick<SubtreePruning, 'skips'>): DepthCasters {
  return collectDepthCasters(scene, layers, SHADOW_CASTERS, out, pruning);
}

/** What three's pass would visit for `layers` under `rule`, as `collectShadowCasters` does for shadow casters. */
export function collectDepthCasters(scene: THREE.Object3D, layers: number, rule: DepthCasterRule, out: DepthCasters = noCasters(), pruning?: Pick<SubtreePruning, 'skips'>): DepthCasters {
  out.batches.length = out.instanced.length = out.meshes.length = out.others.length = 0;
  const stack: THREE.Object3D[] = [scene];
  while (stack.length) {
    const object = stack.pop()!;
    if (!object.visible || pruning?.skips(object, layers)) continue;
    if (object.layers.mask & layers) {
      // Three picks LOD levels and clipping per camera, which this pass does not.
      if (((object as THREE.LOD).isLOD && (object as THREE.LOD).autoUpdate) || ((object as { isClippingGroup?: boolean; enabled?: boolean }).isClippingGroup && (object as { enabled?: boolean }).enabled)) out.others.push(object);
      else if (rule.takes(object)) classify(object, rule, out);
    }
    const children = object.children;
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
  }
  return out;
}

function classify(object: THREE.Object3D, rule: DepthCasterRule, out: DepthCasters): void {
  const mesh = object as THREE.Mesh;
  if (!mesh.isMesh) {
    if ((object as THREE.Line).isLine || (object as THREE.Points).isPoints || (object as THREE.Sprite).isSprite) out.others.push(object);
    return;
  }
  // A batch builds its geometry on its first addition; until then it draws nothing. Nor does three draw
  // a mesh whose own material is hidden, whatever material the pass puts in its place.
  if ((mesh as THREE.BatchedMesh).isBatchedMesh && !mesh.geometry.getAttribute('position')) return;
  if (!Array.isArray(mesh.material) && !mesh.material.visible) return;
  if (!rule.plain(mesh.material) || !plainPosition(mesh.geometry)) out.others.push(mesh);
  else if ((mesh as THREE.BatchedMesh).isBatchedMesh) out.batches.push(mesh as THREE.BatchedMesh);
  else if ((mesh as THREE.SkinnedMesh).isSkinnedMesh || mesh.onBeforeRender !== NO_CALLBACK || mesh.onBeforeShadow !== NO_SHADOW_CALLBACK) out.others.push(mesh);
  else if ((mesh as THREE.InstancedMesh).isInstancedMesh) (plainInstances(mesh as THREE.InstancedMesh) ? out.instanced : out.others).push(mesh as THREE.InstancedMesh);
  else out.meshes.push(mesh);
}

/** A morph mesh's positions as three's vertex stage blends them: the base, scaled by one less the
 * weights' sum for absolute targets, plus each weighted target. Reblended only when a weight moves,
 * and not before a target draws it. */
export class MorphPositions {
  readonly positions: Float32Array;
  /** Bumped on every blend; the pass uploads when its copy is older. */
  version = 0;
  /** The store's round when a pass last prepared it; unused ones are released. */
  seen = 0;
  buffer?: GpuBuffer;
  uploaded = -1;
  private readonly weights: Float64Array;
  private pending = false;

  constructor(readonly mesh: THREE.Mesh) {
    this.positions = new Float32Array(mesh.geometry.getAttribute('position').count * 3);
    this.weights = new Float64Array(mesh.morphTargetInfluences!.length).fill(NaN);
  }

  update(): void { this.check(); this.blend(); }

  /** Take the mesh's weights; a blend is due if they moved. */
  check(): void {
    const influences = this.mesh.morphTargetInfluences!, weights = this.weights;
    let moved = weights.length !== influences.length;
    for (let i = 0; !moved && i < influences.length; i++) moved = weights[i] !== influences[i];
    if (!moved) return;
    weights.set(influences); this.pending = true;
  }

  /** Blend the weights last taken, if not yet done. */
  blend(): void {
    if (!this.pending) return;
    this.pending = false;
    const influences = this.weights, geometry = this.mesh.geometry, out = this.positions, count = out.length / 3;
    const targets = geometry.morphAttributes.position ?? [];
    let sum = 0;
    for (const weight of influences) sum += weight;
    // Three hands the shader its weights as 32-bit floats.
    const scale = Math.fround(geometry.morphTargetsRelative ? 1 : 1 - sum);
    const add = (attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, weight: number, first: boolean) => {
      const array = attribute.array;
      if (!(attribute as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute && !attribute.normalized && attribute.itemSize === 3 && array instanceof Float32Array) {
        for (let i = 0; i < count * 3; i++) out[i] = (first ? 0 : out[i]) + array[i] * weight;
      } else for (let v = 0; v < count; v++) {
        out[v * 3] = (first ? 0 : out[v * 3]) + attribute.getX(v) * weight;
        out[v * 3 + 1] = (first ? 0 : out[v * 3 + 1]) + attribute.getY(v) * weight;
        out[v * 3 + 2] = (first ? 0 : out[v * 3 + 2]) + attribute.getZ(v) * weight;
      }
    };
    add(geometry.getAttribute('position'), scale, true);
    targets.forEach((target, i) => { if (influences[i]) add(target, Math.fround(influences[i]), false); });
    this.version++;
  }
}

/** One geometry's buffers: a batch's combined geometry or a single mesh's, whose positions a morph may replace; the stride
 * its pipeline reads them with; and the pass collection that last brought three's copies up to date. */
interface Source { position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute; index: THREE.BufferAttribute | null; morph?: MorphPositions; stride: number; checked: number }

const grow = <T extends Float32Array | Int32Array>(array: T, size: number): T => { const next = new (array.constructor as new (n: number) => T)(size); next.set(array); return next; };
const IDENTITY = new THREE.Matrix4().elements;
/** Rounds a block is kept, and a morph blended, after the last pass that prepared it (two passes prepare each frame). */
const KEEP_ROUNDS = 240;

/** One caster's run of slots in the store: a batch's drawn instances, an instanced mesh's instances, or a lone mesh. It
 * keeps what the slots were prepared from, so a preparation redoes only what changed since. */
export class DepthCasterBlock {
  /** Its source index (`models`, `sources`); -1 once released. */
  id = -1;
  start = 0;
  count = 0;
  capacity = 0;
  /** The store's round when a pass last prepared it. */
  seen = 0;
  /** Set when every slot must be prepared again: new, moved, or its order rebuilt. */
  stale = true;
  /** A batch's drawn instances in slot order, and the `FleetBatch.layoutVersion` that order follows. */
  order = new Int32Array(0);
  layout = -1;
  instances = -1;
  /** The pose array the slots were copied from (a batch's matrices texture, an instanced mesh's attribute) and its version. */
  poses?: object;
  version = -1;
  private poseData?: ArrayLike<number>;
  private poseBits: Int32Array = new Int32Array(0);
  /** The world matrix last taken. */
  readonly world = new Float64Array(16).fill(NaN);
  /** A mesh's local sphere (centre, radius) last taken, and whether it was culled by it. */
  readonly local = new Float64Array(4).fill(NaN);
  culled = false;

  constructor(readonly object: THREE.Object3D, readonly source: Source) {}

  /** `data` as 32-bit words, to copy and compare poses bit for bit. */
  bitsOf(data: Float32Array): Int32Array {
    if (this.poseData !== data) { this.poseData = data; this.poseBits = new Int32Array(data.buffer, data.byteOffset, data.length); }
    return this.poseBits;
  }
}

/** Every caster the depth passes of one renderer draw, one slot per drawn instance, each with its bounding sphere in the
 * world, kept between frames and shared by the passes: each part is prepared once however many passes and maps draw it,
 * and again only when its pose, order or buffers change. Positions are transformed as three's vertex stage transforms
 * them: by the slot's own matrix (a batch's or an instanced mesh's per-instance matrix, the identity for a lone mesh),
 * then by its source's world matrix joined to the view. A source's slots are consecutive and sorted by geometry range, so
 * equal ranges draw instanced. The GPU copies of the matrices, sources and world matrices follow only the ranges that
 * changed. */
export class DepthCasterStore {
  /** Off: nothing is kept from one preparation to the next, and each uploads every slot, as the passes did alone. */
  reuse = true;
  matrices = new Float32Array(16 * 256);
  spheres = new Float32Array(4 * 256);
  /** Per slot: source, then range start and count (in indices, or vertices when unindexed). */
  slotSource = new Int32Array(256);
  slotStart = new Int32Array(256);
  slotCount = new Int32Array(256);
  /** Per source: the world matrix of its batch or mesh. */
  models = new Float32Array(16 * 64);
  readonly sources: (Source | undefined)[] = [];
  /** Slots handed out, including those left behind by blocks that moved or went, which compaction reclaims. */
  slots = 0;
  /** Preparations so far. */
  round = 0;
  /** Morphs no pass has prepared for a while, for the passes to free their buffers. */
  readonly released: MorphPositions[] = [];
  /** Bumped whenever the GPU buffers are replaced, so each pass rebinds them. */
  generation = 0;
  matrixBuffer?: GpuBuffer;
  modelBuffer?: GpuBuffer;
  sourceBuffer?: GpuBuffer;
  /** Passes holding the store (`depthCasterStore`). */
  users = 0;
  private bits = new Int32Array(this.matrices.buffer);
  private abandoned = 0;
  private readonly blocks = new Map<THREE.Object3D, DepthCasterBlock>();
  private readonly morphs = new Map<THREE.Mesh, MorphPositions>();
  private readonly free: number[] = [];
  private readonly keys: number[] = [];
  private readonly sphere = new THREE.Sphere();
  private readonly matrix = new THREE.Matrix4();
  /** Changed since the last upload: slots of matrices and of sources, and source indices of models. */
  private readonly changed = { matrices: new Changes(64), sources: new Changes(4), models: new Changes(64) };

  /** Start a preparation: release what has gone unused, reclaim abandoned slots, and without reuse forget everything kept. */
  begin(): void {
    const round = ++this.round;
    if (round % 60 === 0) {
      for (const [object, block] of this.blocks) if (round - block.seen > KEEP_ROUNDS) this.release(object, block);
      for (const [mesh, morph] of this.morphs) if (round - morph.seen > KEEP_ROUNDS) { this.morphs.delete(mesh); this.released.push(morph); }
    }
    if (this.abandoned > 1024 && this.abandoned * 2 > this.slots) this.compact();
    if (!this.reuse) for (const block of this.blocks.values()) { block.stale = true; block.layout = -2; }
  }

  /** A batch's drawn instances: sorted by geometry range while the sort key holds them, else in instance order. */
  batch(batch: THREE.BatchedMesh): DepthCasterBlock {
    const block = this.block(batch, batch.geometry, undefined), { _instanceInfo: instances, _matricesTexture: texture } = batch as unknown as BatchInternals;
    const fleet = batch instanceof FleetBatch ? batch : undefined, moved = this.model(block, batch.matrixWorld);
    // Only a fleet batch reports every change to its order; any other is sorted afresh each time.
    if (!fleet || fleet.layoutVersion !== block.layout || instances.length !== block.instances) this.order(block, batch, fleet ? fleet.layoutVersion : -1);
    if (block.stale || moved || !fleet || texture !== block.poses || texture.version !== block.version) this.batchPoses(block, batch, fleet, moved);
    return block;
  }

  /** An instanced mesh: its geometry once per instance three draws, each with its own matrix. */
  instanced(mesh: THREE.InstancedMesh): DepthCasterBlock | undefined {
    const geometry = mesh.geometry, { start, count: indices } = drawRange(geometry), count = mesh.count;
    if (!indices || count <= 0) return undefined;
    const block = this.block(mesh, geometry, undefined), moved = this.model(block, mesh.matrixWorld);
    if (this.place(block, count) || block.stale) {
      for (let slot = block.start; slot < block.start + count; slot++) { this.slotSource[slot] = block.id; this.slotStart[slot] = start; this.slotCount[slot] = indices; }
      this.changed.sources.touch(block.start, block.start + count); block.stale = true;
    } else if (this.slotStart[block.start] !== start || this.slotCount[block.start] !== indices) {
      for (let slot = block.start; slot < block.start + count; slot++) { this.slotStart[slot] = start; this.slotCount[slot] = indices; }
    }
    if (mesh.frustumCulled && !geometry.boundingSphere) geometry.computeBoundingSphere();
    const local = block.local, sphere = geometry.boundingSphere, culled = mesh.frustumCulled;
    const bounds = block.stale || moved || culled !== block.culled || (culled && (local[0] !== sphere!.center.x || local[1] !== sphere!.center.y || local[2] !== sphere!.center.z || local[3] !== sphere!.radius));
    if (culled) { local[0] = sphere!.center.x; local[1] = sphere!.center.y; local[2] = sphere!.center.z; local[3] = sphere!.radius; }
    block.culled = culled;
    const data = mesh.instanceMatrix.array as Float32Array, poses = block.bitsOf(data), out = this.bits;
    let from = Infinity, to = 0;
    for (let i = 0; i < count; i++) {
      const slot = block.start + i, o = i * 16, s = slot * 16;
      let changed = bounds;
      for (let k = 0; k < 16; k++) if (out[s + k] !== poses[o + k]) { out[s + k] = poses[o + k]; changed = true; }
      if (!changed) continue;
      if (slot < from) from = slot; to = slot + 1;
      if (!culled) { this.unbounded(slot); continue; }
      this.sphere.copy(sphere!);
      this.bound(slot, this.matrix.fromArray(data, o).premultiply(mesh.matrixWorld).elements, 0);
    }
    this.changed.matrices.touch(from, to);
    block.stale = false;
    return block;
  }

  /** A lone mesh: one slot with the identity for its own matrix; a morph mesh draws its blended positions. */
  mesh(mesh: THREE.Mesh): DepthCasterBlock | undefined {
    const geometry = mesh.geometry, { start, count } = drawRange(geometry);
    if (!count) return undefined;
    let morph: MorphPositions | undefined;
    if (mesh.morphTargetInfluences?.length) {
      morph = this.morphs.get(mesh);
      if (!morph) this.morphs.set(mesh, morph = new MorphPositions(mesh));
      morph.seen = this.round; morph.check();
    }
    const block = this.block(mesh, geometry, morph), moved = this.model(block, mesh.matrixWorld);
    if (this.place(block, 1) || block.stale) {
      this.slotSource[block.start] = block.id; copy(IDENTITY, 0, this.matrices, block.start * 16);
      this.changed.sources.touch(block.start, block.start + 1); this.changed.matrices.touch(block.start, block.start + 1);
    }
    const slot = block.start;
    this.slotStart[slot] = start; this.slotCount[slot] = count;
    if (!mesh.frustumCulled) {
      if (block.stale || block.culled) this.unbounded(slot);
      block.culled = false; block.stale = false;
      return block;
    }
    if (!geometry.boundingSphere) geometry.computeBoundingSphere();
    const sphere = geometry.boundingSphere!, local = block.local;
    if (block.stale || moved || !block.culled || local[0] !== sphere.center.x || local[1] !== sphere.center.y || local[2] !== sphere.center.z || local[3] !== sphere.radius) {
      local[0] = sphere.center.x; local[1] = sphere.center.y; local[2] = sphere.center.z; local[3] = sphere.radius;
      this.sphere.copy(sphere);
      this.bound(slot, mesh.matrixWorld.elements, 0);
    }
    block.culled = true; block.stale = false;
    return block;
  }

  /** Upload what changed since the last upload; buffers grown on the way are uploaded whole. */
  upload(device: GpuDevice): void {
    const slots = Math.max(1, this.slots), sources = Math.max(1, this.sources.length), changed = this.changed;
    let grown = false;
    const storage = (buffer: GpuBuffer | undefined, count: number, bytes: number, name: string) => {
      if (buffer && buffer.size >= count * bytes) return buffer;
      buffer?.destroy(); grown = true;
      return device.createBuffer({ label: `Depth casters ${name}`, size: capacity(count) * bytes, usage: STORAGE | COPY_DST });
    };
    this.matrixBuffer = storage(this.matrixBuffer, slots, 64, 'matrices');
    this.sourceBuffer = storage(this.sourceBuffer, slots, 4, 'sources');
    this.modelBuffer = storage(this.modelBuffer, sources, 64, 'models');
    if (grown) {
      this.generation++;
      changed.matrices.touch(0, this.slots); changed.sources.touch(0, this.slots); changed.models.touch(0, this.sources.length);
    }
    const queue = device.queue;
    changed.matrices.flush(this.slots, (from, to) => queue.writeBuffer(this.matrixBuffer!, from * 64, this.matrices, from * 16, (to - from) * 16));
    changed.sources.flush(this.slots, (from, to) => queue.writeBuffer(this.sourceBuffer!, from * 4, this.slotSource, from, to - from));
    changed.models.flush(this.sources.length, (from, to) => queue.writeBuffer(this.modelBuffer!, from * 64, this.models, from * 16, (to - from) * 16));
  }

  /** Release every block and morph and the GPU buffers, as when the last pass is disposed. */
  dispose(): void {
    for (const [object, block] of this.blocks) this.release(object, block);
    this.released.push(...this.morphs.values()); this.morphs.clear();
    for (const morph of this.released.splice(0)) morph.buffer?.destroy();
    for (const buffer of [this.matrixBuffer, this.modelBuffer, this.sourceBuffer]) buffer?.destroy();
    this.matrixBuffer = this.modelBuffer = this.sourceBuffer = undefined;
  }

  private block(object: THREE.Object3D, geometry: THREE.BufferGeometry, morph: MorphPositions | undefined): DepthCasterBlock {
    const position = geometry.getAttribute('position') as THREE.BufferAttribute | THREE.InterleavedBufferAttribute, index = geometry.index;
    let block = this.blocks.get(object);
    if (!block) {
      block = new DepthCasterBlock(object, { position, index, morph, stride: strideOf(position, morph), checked: 0 });
      block.id = this.free.pop() ?? this.sources.length;
      this.sources[block.id] = block.source;
      if (block.id * 16 >= this.models.length) this.models = grow(this.models, this.models.length * 2);
      this.blocks.set(object, block);
    } else {
      const source = block.source;
      if (source.position !== position || source.morph !== morph) { source.position = position; source.morph = morph; source.stride = strideOf(position, morph); }
      source.index = index;
    }
    block.seen = this.round;
    return block;
  }

  private release(object: THREE.Object3D, block: DepthCasterBlock): void {
    this.blocks.delete(object);
    if (block.source.morph && this.morphs.get(block.object as THREE.Mesh) === block.source.morph) { this.morphs.delete(block.object as THREE.Mesh); this.released.push(block.source.morph); }
    this.abandoned += block.capacity; this.sources[block.id] = undefined; this.free.push(block.id);
    block.id = -1; block.capacity = block.count = 0;
  }

  /** Room for `count` slots: in place when they fit, else at the end, with headroom once a block has grown. True when its
   * slots must be filled again (moved, or a different count). */
  private place(block: DepthCasterBlock, count: number): boolean {
    const resized = count !== block.count;
    block.count = count;
    if (count <= block.capacity) { if (resized) block.stale = true; return resized; }
    this.abandoned += block.capacity;
    const size = block.capacity ? Math.ceil(count * 1.5) : count;
    this.reserve(this.slots + size);
    block.start = this.slots; block.capacity = size; this.slots += size; block.stale = true;
    return true;
  }

  private reserve(slots: number): void {
    if (slots * 16 <= this.matrices.length) return;
    const size = capacity(slots);
    this.matrices = grow(this.matrices, size * 16); this.bits = new Int32Array(this.matrices.buffer); this.spheres = grow(this.spheres, size * 4);
    this.slotSource = grow(this.slotSource, size); this.slotStart = grow(this.slotStart, size); this.slotCount = grow(this.slotCount, size);
  }

  /** Pack the live blocks from slot 0, in the order they stand, and upload them all. */
  private compact(): void {
    const blocks = [...this.blocks.values()].filter(block => block.capacity).sort((a, b) => a.start - b.start);
    let next = 0;
    for (const block of blocks) {
      if (block.start !== next) {
        const from = block.start, to = from + block.count;
        this.matrices.copyWithin(next * 16, from * 16, to * 16); this.spheres.copyWithin(next * 4, from * 4, to * 4);
        this.slotSource.copyWithin(next, from, to); this.slotStart.copyWithin(next, from, to); this.slotCount.copyWithin(next, from, to);
        block.start = next;
      }
      next += block.capacity;
    }
    this.slots = next; this.abandoned = 0;
    this.changed.matrices.touch(0, next); this.changed.sources.touch(0, next);
  }

  /** The drawn instances in slot order: a batch's ranges consecutive, so a target draws each range it keeps as one instanced draw. */
  private order(block: DepthCasterBlock, batch: THREE.BatchedMesh, layout: number): void {
    const { _instanceInfo: instances, _geometryInfo: geometries } = batch as unknown as BatchInternals;
    const keys = this.keys, unsortable = instances.length > 0x10000;
    keys.length = 0;
    let sorted = true;
    for (let i = 0; i < instances.length; i++) {
      const instance = instances[i];
      if (!instance.active || !instance.visible || !geometries[instance.geometryIndex]?.active) continue;
      // More instances than the sort key holds: one slot per instance, in instance order.
      const key = unsortable ? i : instance.geometryIndex * 0x10000 + i;
      if (keys.length && key < keys[keys.length - 1]) sorted = false;
      keys.push(key);
    }
    if (!sorted) keys.sort((a, b) => a - b);
    this.place(block, keys.length);
    if (block.order.length < keys.length) block.order = new Int32Array(block.capacity);
    const order = block.order;
    for (let k = 0; k < keys.length; k++) {
      const instance = unsortable ? keys[k] : keys[k] % 0x10000, range = geometries[instances[instance].geometryIndex], slot = block.start + k;
      order[k] = instance; this.slotSource[slot] = block.id; this.slotStart[slot] = range.start; this.slotCount[slot] = range.count;
    }
    this.changed.sources.touch(block.start, block.start + keys.length);
    block.layout = layout; block.instances = instances.length; block.stale = true;
  }

  /** Copy the drawn instances' matrices, and bound those that changed. A fleet batch in the world's frame hands over the
   * bounds it keeps from each pose, which are these same numbers. */
  private batchPoses(block: DepthCasterBlock, batch: THREE.BatchedMesh, fleet: FleetBatch | undefined, moved: boolean): void {
    const { _instanceInfo: instances, _geometryInfo: geometries, _matricesTexture: texture } = batch as unknown as BatchInternals;
    const data = texture.image.data as Float32Array, poses = block.bitsOf(data), out = this.bits, order = block.order, spheres = this.spheres;
    const world = batch.matrixWorld, identity = isIdentity(world), kept = this.reuse && identity ? fleet : undefined;
    // A moved world or a rebuilt order changes every slot's bounds, whatever its matrix.
    const all = block.stale || moved;
    let from = Infinity, to = 0;
    for (let k = 0; k < block.count; k++) {
      const instance = order[k], slot = block.start + k, o = instance * 16, s = slot * 16;
      let changed = all;
      for (let i = 0; i < 16; i++) if (out[s + i] !== poses[o + i]) { out[s + i] = poses[o + i]; changed = true; }
      if (!changed) continue;
      if (slot < from) from = slot; to = slot + 1;
      const geometryId = instances[instance].geometryIndex;
      // Kept bounds are Sphere.applyMatrix4's, which divides by w: the same numbers only for an affine pose.
      if (kept && data[o + 3] === 0 && data[o + 7] === 0 && data[o + 11] === 0 && data[o + 15] === 1) {
        const bounds = kept.partBoundsAt(instance), local = geometries[geometryId].boundingSphere, b = instance * 4, i = slot * 4;
        if (local) {
          spheres[i] = bounds[b]; spheres[i + 1] = bounds[b + 1]; spheres[i + 2] = bounds[b + 2]; spheres[i + 3] = local.radius < 0 ? -1 : bounds[b + 3];
          continue;
        }
      }
      batch.getBoundingSphereAt(geometryId, this.sphere);
      if (identity) this.bound(slot, data, o);
      else this.bound(slot, this.matrix.fromArray(data, o).premultiply(world).elements, 0);
    }
    this.changed.matrices.touch(from, to);
    block.poses = texture; block.version = texture.version; block.stale = false;
  }

  /** Take `world` as the source's world matrix; true when it differs from the last taken (a zero's sign included). */
  private model(block: DepthCasterBlock, world: THREE.Matrix4): boolean {
    const e = world.elements, known = block.world;
    let moved = block.stale;
    for (let i = 0; !moved && i < 16; i++) { const a = e[i], b = known[i]; moved = a !== b || (a === 0 && 1 / a !== 1 / b); }
    if (!moved) return false;
    for (let i = 0; i < 16; i++) known[i] = e[i];
    copy(e, 0, this.models, block.id * 16);
    this.changed.models.touch(block.id, block.id + 1);
    return true;
  }

  /** A slot drawn wherever the camera looks, as three draws an object it does not cull. */
  private unbounded(slot: number): void {
    this.spheres.fill(0, slot * 4, slot * 4 + 3); this.spheres[slot * 4 + 3] = Infinity;
  }

  /** World bounds of `this.sphere` under the world matrix at `m[o]`, as `Sphere.applyMatrix4` computes them. */
  private bound(slot: number, m: ArrayLike<number>, o: number): void {
    const c = this.sphere.center, s = this.spheres, i = slot * 4;
    s[i] = m[o] * c.x + m[o + 4] * c.y + m[o + 8] * c.z + m[o + 12];
    s[i + 1] = m[o + 1] * c.x + m[o + 5] * c.y + m[o + 9] * c.z + m[o + 13];
    s[i + 2] = m[o + 2] * c.x + m[o + 6] * c.y + m[o + 10] * c.z + m[o + 14];
    const scale = Math.max(m[o] ** 2 + m[o + 1] ** 2 + m[o + 2] ** 2, m[o + 4] ** 2 + m[o + 5] ** 2 + m[o + 6] ** 2, m[o + 8] ** 2 + m[o + 9] ** 2 + m[o + 10] ** 2);
    s[i + 3] = this.sphere.radius < 0 ? -1 : this.sphere.radius * Math.sqrt(scale);
  }
}

/** Entries changed since the last upload, written as runs; runs closer than a few kilobytes join, since each write costs
 * more than copying that much. */
class Changes {
  private marks = new Uint8Array(256);
  private from = Infinity;
  private to = 0;
  private readonly gap: number;

  constructor(bytes: number) { this.gap = Math.ceil(4096 / bytes); }

  touch(from: number, to: number): void {
    if (to <= from) return;
    if (to > this.marks.length) { const marks = new Uint8Array(capacity(to)); marks.set(this.marks); this.marks = marks; }
    this.marks.fill(1, from, to);
    if (from < this.from) this.from = from;
    if (to > this.to) this.to = to;
  }

  /** Hand each run below `end` to `write` as [from, to), and forget them all. */
  flush(end: number, write: (from: number, to: number) => void): void {
    const marks = this.marks, last = Math.min(this.to, end);
    let start = -1, stop = 0;
    for (let i = this.from; i < last; i++) {
      if (!marks[i]) continue;
      if (start >= 0 && i - stop >= this.gap) { write(start, stop); start = -1; }
      if (start < 0) start = i;
      stop = i + 1;
    }
    if (start >= 0) write(start, stop);
    if (this.to > this.from) marks.fill(0, this.from, this.to);
    this.from = Infinity; this.to = 0;
  }
}

const stores = new WeakMap<object, DepthCasterStore>();
/** The store every depth pass of `renderer` shares; each pass holds it until disposed. */
export function depthCasterStore(renderer: object): DepthCasterStore {
  let store = stores.get(renderer);
  if (!store) stores.set(renderer, store = new DepthCasterStore());
  store.users++;
  return store;
}
function releaseStore(renderer: object, store: DepthCasterStore): void {
  if (--store.users > 0) return;
  store.dispose();
  if (stores.get(renderer) === store) stores.delete(renderer);
}

/** One pass's casters for a frame: blocks of the store in the order their slots are culled (batches, instanced meshes,
 * then lone meshes), as a pass once laid out slots of its own. */
export class DepthCasterFrame {
  readonly blocks: DepthCasterBlock[] = [];
  /** Slots across those blocks. */
  count = 0;

  constructor(public store = new DepthCasterStore()) {}

  get matrices(): Float32Array { return this.store.matrices; }
  get spheres(): Float32Array { return this.store.spheres; }
  get models(): Float32Array { return this.store.models; }
  get slotSource(): Int32Array { return this.store.slotSource; }
  get sources(): readonly (Source | undefined)[] { return this.store.sources; }

  prepare(casters: DepthCasters): void {
    const store = this.store;
    store.begin();
    this.blocks.length = 0; this.count = 0;
    for (const batch of casters.batches) this.add(store.batch(batch));
    for (const mesh of casters.instanced) this.add(store.instanced(mesh));
    for (const mesh of casters.meshes) this.add(store.mesh(mesh));
  }

  private add(block: DepthCasterBlock | undefined): void {
    if (!block?.count) return;
    this.blocks.push(block); this.count += block.count;
  }
}

/** A matrix's 16 numbers from `from[at]` to `to[into]`, without the view `subarray` would allocate. */
function copy(from: ArrayLike<number>, at: number, to: Float32Array, into: number): void {
  for (let i = 0; i < 16; i++) to[into + i] = from[at + i];
}

const drawn = { start: 0, count: 0 };
/** The indices (or vertices, unindexed) three draws of `geometry` (count 0: none), valid until the next call. */
function drawRange(geometry: THREE.BufferGeometry): { start: number; count: number } {
  const available = (geometry.index ?? geometry.getAttribute('position')).count, start = Math.max(0, geometry.drawRange.start);
  const count = Math.min(geometry.drawRange.count, available - start);
  drawn.start = start; drawn.count = count > 0 ? count : 0;
  return drawn;
}

function isIdentity(matrix: THREE.Matrix4): boolean {
  const e = matrix.elements;
  for (let i = 0; i < 16; i++) if (e[i] !== (i % 5 === 0 ? 1 : 0)) return false;
  return true;
}

/** One target's draws: slots in `ids` order, and per draw its source, range and instances. */
export class DepthCasterDraws {
  ids = new Uint32Array(256);
  idCount = 0;
  source = new Int32Array(64);
  start = new Int32Array(64);
  count = new Int32Array(64);
  first = new Int32Array(64);
  instances = new Int32Array(64);
  drawCount = 0;

  /** Keep the slots whose spheres touch `frustum`; consecutive kept slots of one range share a draw. */
  cull(frame: DepthCasterFrame, frustum: THREE.Frustum): void {
    this.idCount = 0; this.drawCount = 0;
    // Another pass may have prepared a block again since this frame's own preparation, so count its slots as they stand.
    let slots = 0;
    for (const block of frame.blocks) slots += block.count;
    if (this.ids.length < slots) this.ids = new Uint32Array(Math.max(slots, this.ids.length * 2));
    const planes = frustum.planes, { spheres: s, slotSource, slotStart, slotCount } = frame.store;
    const [a, b, c, d, e, f] = planes;
    let open = -1;
    for (const block of frame.blocks) for (let slot = block.start, end = slot + block.count; slot < end; slot++) {
      const x = s[slot * 4], y = s[slot * 4 + 1], z = s[slot * 4 + 2], r = s[slot * 4 + 3];
      // Empty geometry (radius -1) never draws; an infinite radius always does.
      if (r < 0 || a.normal.x * x + a.normal.y * y + a.normal.z * z + a.constant < -r || b.normal.x * x + b.normal.y * y + b.normal.z * z + b.constant < -r ||
        c.normal.x * x + c.normal.y * y + c.normal.z * z + c.constant < -r || d.normal.x * x + d.normal.y * y + d.normal.z * z + d.constant < -r ||
        e.normal.x * x + e.normal.y * y + e.normal.z * z + e.constant < -r || f.normal.x * x + f.normal.y * y + f.normal.z * z + f.constant < -r) continue;
      const source = slotSource[slot], start = slotStart[slot], count = slotCount[slot];
      if (open >= 0 && this.source[open] === source && this.start[open] === start && this.count[open] === count) this.instances[open]++;
      else {
        open = this.drawCount++;
        if (open >= this.source.length) this.grow();
        this.source[open] = source; this.start[open] = start; this.count[open] = count; this.first[open] = this.idCount; this.instances[open] = 1;
      }
      this.ids[this.idCount++] = slot;
    }
  }

  private grow(): void {
    const size = this.source.length * 2, grow = (array: Int32Array) => { const next = new Int32Array(size); next.set(array); return next; };
    this.source = grow(this.source); this.start = grow(this.start); this.count = grow(this.count); this.first = grow(this.first); this.instances = grow(this.instances);
  }
}

const SHADER = /* wgsl */ `
struct View { projection: mat4x4f, view: mat4x4f };
@group(0) @binding(0) var<uniform> camera: View;
@group(0) @binding(1) var<storage, read> matrices: array<mat4x4f>;
@group(0) @binding(2) var<storage, read> ids: array<u32>;
@group(0) @binding(3) var<storage, read> models: array<mat4x4f>;
@group(0) @binding(4) var<storage, read> sources: array<u32>;
// Three's vertex stage as it writes it: the instance's own matrix (the identity for a lone mesh), then the
// view joined to the object's world matrix, then the projection. Of the orders tried this lands closest to
// three's depths; the GPU compiler contracts both shaders its own way, so a few edge texels differ by an ulp.
@vertex fn main(@location(0) position: vec3f, @builtin(instance_index) instance: u32) -> @builtin(position) vec4f {
  let slot = ids[instance];
  let local = (matrices[slot] * vec4f(position, 1.0)).xyz;
  let view = ((camera.view * models[sources[slot]]) * vec4f(local, 1.0)).xyz;
  return camera.projection * vec4f(view, 1.0);
}`;

let collections = 0;

/** A render target whose depth texture a pass draws; a colour attachment, if it has one, is left as it was. */
export type DepthTarget = THREE.RenderTarget & { depthTexture: THREE.DepthTexture };

export class DepthCasterPass {
  /** Off: each pass prepares every caster afresh into a store of its own and uploads all of it, as before the passes
   * shared one; for comparison. */
  static share = true;
  /** Off: every target is three's own scene pass, for comparison. */
  enabled = true;
  /** Since creation: targets drawn here, targets left wholly to three, targets three shared (drawing its own objects first). */
  readonly stats = { drawn: 0, deferred: 0, shared: 0, draws: 0, instances: 0 };
  private readonly casters = noCasters();
  /** The renderer's store, which every depth pass on it shares, and one of this pass's own while `share` is off. */
  private readonly store: DepthCasterStore;
  private own?: DepthCasterStore;
  /** Set once disposed, when the pass has let go of the shared store. */
  private released = false;
  private readonly frame: DepthCasterFrame;
  private readonly draws = new DepthCasterDraws();
  private readonly frustum = new THREE.Frustum();
  private readonly viewProjection = new THREE.Matrix4();
  /** The camera's projection, then its view matrix. */
  private readonly uniforms = new Float32Array(32);
  private collectedFrame = -1;
  private collectedLayers = 0;
  /** This pass's latest collection, numbered across every pass. */
  private collection = 0;
  private layout?: object;
  private module?: object;
  private pipelineLayout?: object;
  private readonly pipelines = new Map<string, object | 'pending' | 'failed'>();
  private readonly strides = new Map<number, object>();
  private cameraBuffer?: GpuBuffer;
  private idBuffer?: GpuBuffer;
  private group?: object;
  /** The store buffers `group` binds. */
  private groupStore?: DepthCasterStore;
  private groupGeneration = -1;
  private readonly views = new WeakMap<GpuTexture, object>();
  private readonly reached: THREE.Object3D[] = [];
  private proxy?: THREE.Scene;

  /** The renderer's subtree skipping, which the caster walk shares. */
  private readonly pruning: SubtreePruning;

  /** `label` names the pass's GPU objects; `rule` says what three's pass draws, and which of that this one can. */
  constructor(protected readonly renderer: THREE.WebGPURenderer, private readonly label: string, private readonly rule: DepthCasterRule) {
    this.pruning = subtreePruning(renderer);
    this.frame = new DepthCasterFrame(this.store = depthCasterStore(renderer));
  }

  /** Draw `scene` from `camera` (its matrices already updated) into `target`'s depth, as three's render with the
   * pass's material would. Objects are collected once per `frameId` and camera layers. False leaves it to three. */
  draw(scene: THREE.Object3D, camera: THREE.Camera, target: DepthTarget, frameId: number): boolean {
    const renderer = this.renderer as unknown as RendererInternals;
    if (!this.enabled || target.samples > 1) return this.defer();
    const device = renderer.backend.device, attributes = renderer._attributes;
    // Three sets these on a camera the first time it renders from it; until then the matrices differ.
    if (!device || !attributes || camera.coordinateSystem !== renderer.coordinateSystem || camera.reversedDepth !== renderer.reversedDepthBuffer) return this.defer();
    const texture = renderer.backend.get(target.depthTexture).texture;
    if (!texture || texture.width !== target.width || texture.height !== target.height || texture.depthOrArrayLayers !== 1 || texture.sampleCount !== 1) return this.defer();
    if (frameId !== this.collectedFrame || camera.layers.mask !== this.collectedLayers) {
      collectDepthCasters(scene, camera.layers.mask, this.rule, this.casters, this.pruning);
      const store = this.frame.store = DepthCasterPass.share ? this.store : this.own ??= Object.assign(new DepthCasterStore(), { reuse: false });
      this.frame.prepare(this.casters);
      for (const released of store.released.splice(0)) released.buffer?.destroy();
      this.collectedFrame = frameId; this.collectedLayers = camera.layers.mask; this.collection = ++collections;
    }
    this.viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.viewProjection, camera.coordinateSystem, camera.reversedDepth);
    this.uniforms.set(camera.projectionMatrix.elements, 0); this.uniforms.set(camera.matrixWorldInverse.elements, 16);
    const reached = this.reached; reached.length = 0;
    for (const other of this.casters.others) if (!(other as THREE.Mesh).isMesh || !other.frustumCulled || this.frustum.intersectsObject(other as THREE.Mesh)) reached.push(other);
    this.draws.cull(this.frame, this.frustum);
    // Every source this target draws must have its buffers uploaded and current.
    const sources = this.frame.sources, draws = this.draws;
    // Once per collection: the maps a pass draws in one frame share their casters' buffers.
    const collection = this.collection;
    for (let i = 0; i < draws.drawCount; i++) {
      const source = sources[draws.source[i]]!;
      if (source.checked === collection || (i > 0 && draws.source[i] === draws.source[i - 1])) continue;
      if (source.morph) this.uploadMorph(device, source.morph);
      else attributes.update(source.position, VERTEX_ATTRIBUTE);
      if (source.index) attributes.update(source.index, INDEX_ATTRIBUTE);
      source.checked = collection;
    }
    const pipelines = this.strides; pipelines.clear();
    for (let i = 0, last = -1; i < draws.drawCount; i++) {
      const stride = sources[draws.source[i]]!.stride;
      if (stride === last || pipelines.has(stride)) continue;
      last = stride;
      const pipeline = this.pipeline(device, texture.format, stride);
      if (!pipeline) return this.defer();
      pipelines.set(stride, pipeline);
    }
    // Three clears the target as it draws its share, then this pass adds the rest.
    if (reached.length) { this.drawOthers(scene as THREE.Scene, camera, reached); this.stats.shared++; }
    if (draws.drawCount || !reached.length) this.encode(device, renderer, texture, pipelines, reached.length > 0);
    this.stats.drawn++; this.stats.draws += draws.drawCount; this.stats.instances += draws.idCount;
    return true;
  }

  /** Three's own render of `objects` alone, into the target it has bound, with the override material
   * (the shadow material three set, or the caller's) and object callbacks set on `scene`. */
  private drawOthers(scene: THREE.Scene, camera: THREE.Camera, objects: THREE.Object3D[]): void {
    const proxy = this.proxy ??= Object.assign(new THREE.Scene(), { name: `${this.label} three draws`, matrixWorldAutoUpdate: false });
    proxy.children = objects; proxy.overrideMaterial = scene.overrideMaterial;
    try { this.renderer.render(proxy, camera); }
    finally { proxy.children = []; proxy.overrideMaterial = null; }
  }

  protected defer(): false { this.stats.deferred++; return false; }

  /** A morph's blended positions in its own vertex buffer, blended and uploaded once per change of weights. */
  private uploadMorph(device: GpuDevice, morph: MorphPositions): void {
    morph.blend();
    morph.buffer ??= device.createBuffer({ label: `Depth casters morph ${morph.mesh.name}`, size: Math.max(4, morph.positions.byteLength), usage: VERTEX | COPY_DST });
    if (morph.uploaded !== morph.version) { device.queue.writeBuffer(morph.buffer, 0, morph.positions); morph.uploaded = morph.version; }
  }

  private encode(device: GpuDevice, renderer: RendererInternals, texture: GpuTexture, pipelines: Map<number, object>, load: boolean): void {
    const draws = this.draws, sources = this.frame.sources;
    if (draws.drawCount) {
      // What changed since any pass last uploaded; queue order keeps it ahead of these draws and behind earlier targets'.
      this.frame.store.upload(device);
      this.reserve(device, draws.idCount);
      // Queue order keeps each target's ids and camera apart from the next target's writes.
      device.queue.writeBuffer(this.idBuffer!, 0, draws.ids, 0, draws.idCount);
      device.queue.writeBuffer(this.cameraBuffer!, 0, this.uniforms);
    }
    let view = this.views.get(texture);
    if (!view) this.views.set(texture, view = texture.createView());
    const stencil = texture.format.includes('stencil');
    const encoder = device.createCommandEncoder({ label: this.label });
    const pass = encoder.beginRenderPass({ label: this.label, colorAttachments: [], depthStencilAttachment: {
      view, depthClearValue: renderer.reversedDepthBuffer ? 0 : 1, depthLoadOp: load ? 'load' : 'clear', depthStoreOp: 'store',
      ...(stencil ? { stencilClearValue: 0, stencilLoadOp: load ? 'load' : 'clear', stencilStoreOp: 'store' } : {}),
    } });
    let source = -1, pipeline: object | undefined;
    for (let i = 0; i < draws.drawCount; i++) {
      if (draws.source[i] !== source) {
        source = draws.source[i];
        const { position, index, morph, stride } = sources[source]!, next = pipelines.get(stride)!;
        if (next !== pipeline) { pass.setPipeline(pipeline = next); pass.setBindGroup(0, this.group!); }
        const interleaved = (position as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute;
        if (morph) pass.setVertexBuffer(0, morph.buffer!);
        else pass.setVertexBuffer(0, renderer.backend.get(interleaved ? (position as THREE.InterleavedBufferAttribute).data : position).buffer!, interleaved ? (position as THREE.InterleavedBufferAttribute).offset * 4 : 0);
        if (index) pass.setIndexBuffer(renderer.backend.get(index).buffer!, index.array instanceof Uint16Array ? 'uint16' : 'uint32');
      }
      if (sources[source]!.index) pass.drawIndexed(draws.count[i], draws.instances[i], draws.start[i], 0, draws.first[i]);
      else pass.draw(draws.count[i], draws.instances[i], draws.start[i], draws.first[i]);
    }
    pass.end();
    device.queue.submit([encoder.finish()]);
  }

  /** The depth-only pipeline for a position stride; created asynchronously, so targets wait for three meanwhile. */
  private pipeline(device: GpuDevice, format: string, stride: number): object | undefined {
    const key = `${format}:${stride}`, known = this.pipelines.get(key);
    if (known === 'pending' || known === 'failed') return undefined;
    if (known) return known;
    this.module ??= device.createShaderModule({ label: this.label, code: SHADER });
    this.layout ??= device.createBindGroupLayout({ label: this.label, entries: [
      { binding: 0, visibility: VERTEX_STAGE, buffer: { type: 'uniform' } },
      { binding: 1, visibility: VERTEX_STAGE, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: VERTEX_STAGE, buffer: { type: 'read-only-storage' } },
      { binding: 3, visibility: VERTEX_STAGE, buffer: { type: 'read-only-storage' } },
      { binding: 4, visibility: VERTEX_STAGE, buffer: { type: 'read-only-storage' } },
    ] });
    this.pipelineLayout ??= device.createPipelineLayout({ label: this.label, bindGroupLayouts: [this.layout] });
    this.pipelines.set(key, 'pending');
    device.createRenderPipelineAsync({
      label: `${this.label} ${key}`, layout: this.pipelineLayout,
      vertex: { module: this.module, entryPoint: 'main', buffers: [{ arrayStride: stride, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      // Three's shadow and depth override materials keep the default LessEqual test, which reversed depth flips.
      depthStencil: { format, depthWriteEnabled: true, depthCompare: (this.renderer as unknown as RendererInternals).reversedDepthBuffer ? 'greater-equal' : 'less-equal' },
    }).then(pipeline => this.pipelines.set(key, pipeline), error => { this.pipelines.set(key, 'failed'); console.warn(`${this.label}: pipeline failed; three draws the targets`, error); });
    return undefined;
  }

  /** Grow this pass's ids buffer to hold `ids` ids; a new one, or new store buffers, need a new bind group. */
  private reserve(device: GpuDevice, ids: number): void {
    const store = this.frame.store;
    let changed = !this.group || this.groupStore !== store || this.groupGeneration !== store.generation;
    if (!this.idBuffer || this.idBuffer.size < ids * 4) {
      this.idBuffer?.destroy(); changed = true;
      this.idBuffer = device.createBuffer({ label: `${this.label} ids`, size: capacity(ids) * 4, usage: STORAGE | COPY_DST });
    }
    this.cameraBuffer ??= (changed = true, device.createBuffer({ label: `${this.label} camera`, size: 128, usage: UNIFORM | COPY_DST }));
    if (!changed) return;
    this.group = device.createBindGroup({ label: this.label, layout: this.layout, entries: [this.cameraBuffer, store.matrixBuffer!, this.idBuffer, store.modelBuffer!, store.sourceBuffer!]
      .map((buffer, binding) => ({ binding, resource: { buffer } })) });
    this.groupStore = store; this.groupGeneration = store.generation;
  }

  dispose(): void {
    for (const buffer of [this.idBuffer, this.cameraBuffer]) buffer?.destroy();
    this.idBuffer = this.cameraBuffer = undefined; this.group = this.groupStore = undefined;
    this.own?.dispose(); this.own = undefined;
    if (!this.released) releaseStore(this.renderer, this.store);
    this.released = true;
    this.pipelines.clear();
  }
}

/** The sun's shadow maps: casters as three's shadow material draws them. */
export class ShadowCasterPass extends DepthCasterPass {
  constructor(renderer: THREE.WebGPURenderer) { super(renderer, 'Shadow casters', SHADOW_CASTERS); }

  /** Draw a map from its shadow camera. Variance maps keep depth moments in colour, which this pass does not write. */
  override draw(scene: THREE.Object3D, camera: THREE.OrthographicCamera, target: DepthTarget, frameId: number): boolean {
    return (this.renderer as unknown as RendererInternals).shadowMap.type === THREE.VSMShadowMap ? this.defer() : super.draw(scene, camera, target, frameId);
  }
}

/** Power-of-two capacity, at least 256 entries, so growth is rare and never empty. */
const capacity = (n: number) => 2 ** Math.ceil(Math.log2(Math.max(n, 256)));

function strideOf(position: Source['position'], morph: MorphPositions | undefined): number {
  return !morph && (position as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute ? (position as THREE.InterleavedBufferAttribute).data.stride * 4 : 12;
}
