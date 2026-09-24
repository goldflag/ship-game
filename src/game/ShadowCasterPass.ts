import * as THREE from 'three/webgpu';
import { subtreePruning, type SubtreePruning } from './SubtreeLayers';

/** Depth-only scene passes drawn with WebGPU directly: the sun's shadow maps, and the ships' occlusion
 * prepass. Three renders each as a whole scene pass: it walks every object (the fleet's batched
 * originals stay in the graph, only masked by layers), then prepares each draw through its node
 * material path. What these passes draw is plain depth writes, so a pass collects them once a frame
 * (once for every shadow map, skipping subtrees with nothing on its layers as three's projection does),
 * culls each batched part and instance against each camera, and submits position-only draws from three's
 * own vertex buffers, transformed in the order three's vertex stage transforms them. Morph meshes (the
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
  _geometryInfo: { active: boolean; start: number; count: number }[];
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
 * weights' sum for absolute targets, plus each weighted target. Reblended only when a weight moves. */
export class MorphPositions {
  readonly positions: Float32Array;
  /** Bumped on every blend; the pass uploads when its copy is older. */
  version = 0;
  /** The frame count when a frame last drew it; unused ones are released. */
  seen = 0;
  buffer?: GpuBuffer;
  uploaded = -1;
  private readonly weights: Float64Array;

  constructor(readonly mesh: THREE.Mesh) {
    this.positions = new Float32Array(mesh.geometry.getAttribute('position').count * 3);
    this.weights = new Float64Array(mesh.morphTargetInfluences!.length).fill(NaN);
  }

  update(): void {
    const influences = this.mesh.morphTargetInfluences!, weights = this.weights;
    let moved = weights.length !== influences.length;
    for (let i = 0; !moved && i < influences.length; i++) moved = weights[i] !== influences[i];
    if (!moved) return;
    weights.set(influences);
    const geometry = this.mesh.geometry, out = this.positions, count = out.length / 3;
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

/** One geometry's buffers: a batch's combined geometry or a single mesh's, whose positions a morph may replace. */
interface Source { position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute; index: THREE.BufferAttribute | null; morph?: MorphPositions }

const grow = <T extends Float32Array | Int32Array>(array: T, size: number): T => { const next = new (array.constructor as new (n: number) => T)(size); next.set(array); return next; };
const IDENTITY = new THREE.Matrix4().elements;

/** The frame's casters, one slot per drawn instance, each with its bounding sphere in the world. Positions
 * are transformed as three's vertex stage transforms them: by the slot's own matrix (a batch's or an
 * instanced mesh's per-instance matrix, the identity for a lone mesh), then by its source's world matrix
 * joined to the view. A source's slots are consecutive and sorted by geometry range, so equal ranges
 * draw instanced. */
export class DepthCasterFrame {
  matrices = new Float32Array(16 * 256);
  spheres = new Float32Array(4 * 256);
  count = 0;
  sources: Source[] = [];
  /** Per source: the world matrix of its batch or mesh. */
  models = new Float32Array(16 * 64);
  /** Per slot: source, then range start and count (in indices, or vertices when unindexed). */
  slotSource = new Int32Array(256);
  slotStart = new Int32Array(256);
  slotCount = new Int32Array(256);
  private readonly sphere = new THREE.Sphere();
  private readonly matrix = new THREE.Matrix4();
  private readonly keys: number[] = [];
  private readonly morphs = new Map<THREE.Mesh, MorphPositions>();
  /** Morphs no frame has drawn for a while, for the pass to free their buffers. */
  readonly released: MorphPositions[] = [];
  private frames = 0;

  prepare(casters: DepthCasters): void {
    this.count = 0; this.sources.length = 0; this.frames++;
    for (const batch of casters.batches) this.addBatch(batch);
    for (const mesh of casters.instanced) this.addInstanced(mesh);
    for (const mesh of casters.meshes) this.addMesh(mesh);
    for (const [mesh, morph] of this.morphs) if (this.frames - morph.seen > 120) { this.morphs.delete(mesh); this.released.push(morph); }
  }

  /** Release every morph, as when the pass is disposed. */
  releaseAll(): void {
    this.released.push(...this.morphs.values()); this.morphs.clear();
  }

  private addBatch(batch: THREE.BatchedMesh): void {
    const { _instanceInfo: instances, _geometryInfo: geometries, _matricesTexture: texture } = batch as unknown as BatchInternals;
    const data = texture.image.data as Float32Array, world = batch.matrixWorld, identity = isIdentity(world);
    const source = this.source({ position: batch.geometry.getAttribute('position') as THREE.BufferAttribute, index: batch.geometry.index }, world);
    if (instances.length > 0x10000) return this.addUnsortable(batch, source);
    // Slots of one range are consecutive, so a target draws each range it keeps as one instanced draw.
    const keys = this.keys; keys.length = 0;
    let sorted = true;
    for (let i = 0; i < instances.length; i++) {
      const instance = instances[i];
      if (!instance.active || !instance.visible || !geometries[instance.geometryIndex]?.active) continue;
      const key = instance.geometryIndex * 0x10000 + i;
      if (keys.length && key < keys[keys.length - 1]) sorted = false;
      keys.push(key);
    }
    if (!sorted) keys.sort((a, b) => a - b);
    for (const key of keys) {
      const geometryId = Math.floor(key / 0x10000), instance = key % 0x10000, range = geometries[geometryId];
      const slot = this.slot(source, range.start, range.count);
      copy(data, instance * 16, this.matrices, slot * 16);
      batch.getBoundingSphereAt(geometryId, this.sphere);
      if (identity) this.bound(slot, data, instance * 16);
      else this.bound(slot, this.matrix.fromArray(data, instance * 16).premultiply(world).elements, 0);
    }
  }

  /** More instances than the sort key holds: one slot per instance, in instance order. */
  private addUnsortable(batch: THREE.BatchedMesh, source: number): void {
    const { _instanceInfo: instances, _geometryInfo: geometries, _matricesTexture: texture } = batch as unknown as BatchInternals;
    const data = texture.image.data as Float32Array;
    instances.forEach((instance, i) => {
      const range = geometries[instance.geometryIndex];
      if (!instance.active || !instance.visible || !range?.active) return;
      const slot = this.slot(source, range.start, range.count);
      copy(data, i * 16, this.matrices, slot * 16);
      batch.getBoundingSphereAt(instance.geometryIndex, this.sphere);
      this.bound(slot, this.matrix.fromArray(data, i * 16).premultiply(batch.matrixWorld).elements, 0);
    });
  }

  /** An instanced mesh: its geometry once per instance three draws, each with its own matrix. */
  private addInstanced(mesh: THREE.InstancedMesh): void {
    const geometry = mesh.geometry, range = drawRange(geometry);
    if (!range || mesh.count <= 0) return;
    const source = this.source({ position: geometry.getAttribute('position') as THREE.BufferAttribute, index: geometry.index }, mesh.matrixWorld);
    const data = mesh.instanceMatrix.array as Float32Array;
    if (mesh.frustumCulled && !geometry.boundingSphere) geometry.computeBoundingSphere();
    for (let i = 0; i < mesh.count; i++) {
      const slot = this.slot(source, range.start, range.count);
      copy(data, i * 16, this.matrices, slot * 16);
      if (!mesh.frustumCulled) { this.unbounded(slot); continue; }
      this.sphere.copy(geometry.boundingSphere!);
      this.bound(slot, this.matrix.fromArray(data, i * 16).premultiply(mesh.matrixWorld).elements, 0);
    }
  }

  private addMesh(mesh: THREE.Mesh): void {
    const geometry = mesh.geometry, range = drawRange(geometry);
    if (!range) return;
    let morph: MorphPositions | undefined;
    if (mesh.morphTargetInfluences?.length) {
      morph = this.morphs.get(mesh);
      if (!morph) this.morphs.set(mesh, morph = new MorphPositions(mesh));
      morph.seen = this.frames; morph.update();
    }
    const slot = this.slot(this.source({ position: geometry.getAttribute('position') as THREE.BufferAttribute, index: geometry.index, morph }, mesh.matrixWorld), range.start, range.count);
    copy(IDENTITY, 0, this.matrices, slot * 16);
    if (!mesh.frustumCulled) return this.unbounded(slot);
    if (!geometry.boundingSphere) geometry.computeBoundingSphere();
    this.sphere.copy(geometry.boundingSphere!);
    this.bound(slot, mesh.matrixWorld.elements, 0);
  }

  private source(source: Source, world: THREE.Matrix4): number {
    const index = this.sources.push(source) - 1;
    if (index * 16 >= this.models.length) this.models = grow(this.models, this.models.length * 2);
    copy(world.elements, 0, this.models, index * 16);
    return index;
  }

  private slot(source: number, start: number, count: number): number {
    const slot = this.count++;
    if (slot * 16 >= this.matrices.length) {
      const slots = this.matrices.length / 8;
      this.matrices = grow(this.matrices, slots * 16); this.spheres = grow(this.spheres, slots * 4);
      this.slotSource = grow(this.slotSource, slots); this.slotStart = grow(this.slotStart, slots); this.slotCount = grow(this.slotCount, slots);
    }
    this.slotSource[slot] = source; this.slotStart[slot] = start; this.slotCount[slot] = count;
    return slot;
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

/** A matrix's 16 numbers from `from[at]` to `to[into]`, without the view `subarray` would allocate. */
function copy(from: ArrayLike<number>, at: number, to: Float32Array, into: number): void {
  for (let i = 0; i < 16; i++) to[into + i] = from[at + i];
}

/** The indices (or vertices, unindexed) three draws of `geometry`, if any. */
function drawRange(geometry: THREE.BufferGeometry): { start: number; count: number } | undefined {
  const available = (geometry.index ?? geometry.getAttribute('position')).count, start = Math.max(0, geometry.drawRange.start);
  const count = Math.min(geometry.drawRange.count, available - start);
  return count > 0 ? { start, count } : undefined;
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
    if (this.ids.length < frame.count) this.ids = new Uint32Array(Math.max(frame.count, this.ids.length * 2));
    const planes = frustum.planes, s = frame.spheres;
    const [a, b, c, d, e, f] = planes;
    let open = -1;
    for (let slot = 0; slot < frame.count; slot++) {
      const x = s[slot * 4], y = s[slot * 4 + 1], z = s[slot * 4 + 2], r = s[slot * 4 + 3];
      // Empty geometry (radius -1) never draws; an infinite radius always does.
      if (r < 0 || a.normal.x * x + a.normal.y * y + a.normal.z * z + a.constant < -r || b.normal.x * x + b.normal.y * y + b.normal.z * z + b.constant < -r ||
        c.normal.x * x + c.normal.y * y + c.normal.z * z + c.constant < -r || d.normal.x * x + d.normal.y * y + d.normal.z * z + d.constant < -r ||
        e.normal.x * x + e.normal.y * y + e.normal.z * z + e.constant < -r || f.normal.x * x + f.normal.y * y + f.normal.z * z + f.constant < -r) continue;
      const source = frame.slotSource[slot], start = frame.slotStart[slot], count = frame.slotCount[slot];
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

/** A render target whose depth texture a pass draws; a colour attachment, if it has one, is left as it was. */
export type DepthTarget = THREE.RenderTarget & { depthTexture: THREE.DepthTexture };

export class DepthCasterPass {
  /** Off: every target is three's own scene pass, for comparison. */
  enabled = true;
  /** Since creation: targets drawn here, targets left wholly to three, targets three shared (drawing its own objects first). */
  readonly stats = { drawn: 0, deferred: 0, shared: 0, draws: 0, instances: 0 };
  private readonly casters = noCasters();
  private readonly frame = new DepthCasterFrame();
  private readonly draws = new DepthCasterDraws();
  private readonly frustum = new THREE.Frustum();
  private readonly viewProjection = new THREE.Matrix4();
  /** The camera's projection, then its view matrix. */
  private readonly uniforms = new Float32Array(32);
  private collectedFrame = -1;
  private collectedLayers = 0;
  private uploaded = false;
  private layout?: object;
  private module?: object;
  private pipelineLayout?: object;
  private readonly pipelines = new Map<string, object | 'pending' | 'failed'>();
  private cameraBuffer?: GpuBuffer;
  private matrixBuffer?: GpuBuffer;
  private idBuffer?: GpuBuffer;
  private modelBuffer?: GpuBuffer;
  private sourceBuffer?: GpuBuffer;
  private group?: object;
  private readonly views = new WeakMap<GpuTexture, object>();
  private readonly reached: THREE.Object3D[] = [];
  private proxy?: THREE.Scene;

  /** The renderer's subtree skipping, which the caster walk shares. */
  private readonly pruning: SubtreePruning;

  /** `label` names the pass's GPU objects; `rule` says what three's pass draws, and which of that this one can. */
  constructor(protected readonly renderer: THREE.WebGPURenderer, private readonly label: string, private readonly rule: DepthCasterRule) {
    this.pruning = subtreePruning(renderer);
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
      this.frame.prepare(this.casters);
      for (const released of this.frame.released.splice(0)) released.buffer?.destroy();
      this.collectedFrame = frameId; this.collectedLayers = camera.layers.mask; this.uploaded = false;
    }
    this.viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.viewProjection, camera.coordinateSystem, camera.reversedDepth);
    this.uniforms.set(camera.projectionMatrix.elements, 0); this.uniforms.set(camera.matrixWorldInverse.elements, 16);
    const reached = this.reached; reached.length = 0;
    for (const other of this.casters.others) if (!(other as THREE.Mesh).isMesh || !other.frustumCulled || this.frustum.intersectsObject(other as THREE.Mesh)) reached.push(other);
    this.draws.cull(this.frame, this.frustum);
    // Every source this target draws must have its buffers uploaded and current.
    const sources = this.frame.sources, draws = this.draws;
    for (let i = 0; i < draws.drawCount; i++) {
      const source = sources[draws.source[i]];
      if (i > 0 && draws.source[i] === draws.source[i - 1]) continue;
      if (source.morph) this.uploadMorph(device, source.morph);
      else attributes.update(source.position, VERTEX_ATTRIBUTE);
      if (source.index) attributes.update(source.index, INDEX_ATTRIBUTE);
    }
    const pipelines = new Map<number, object>();
    for (let i = 0; i < draws.drawCount; i++) {
      const stride = strideOf(sources[draws.source[i]]);
      if (pipelines.has(stride)) continue;
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

  /** A morph's blended positions in its own vertex buffer, uploaded once per blend. */
  private uploadMorph(device: GpuDevice, morph: MorphPositions): void {
    morph.buffer ??= device.createBuffer({ label: `${this.label} morph ${morph.mesh.name}`, size: Math.max(4, morph.positions.byteLength), usage: VERTEX | COPY_DST });
    if (morph.uploaded !== morph.version) { device.queue.writeBuffer(morph.buffer, 0, morph.positions); morph.uploaded = morph.version; }
  }

  private encode(device: GpuDevice, renderer: RendererInternals, texture: GpuTexture, pipelines: Map<number, object>, load: boolean): void {
    const frame = this.frame, draws = this.draws, sources = frame.sources;
    if (draws.drawCount) {
      this.reserve(device, frame.count, draws.idCount, sources.length);
      if (!this.uploaded) {
        device.queue.writeBuffer(this.matrixBuffer!, 0, frame.matrices, 0, frame.count * 16);
        device.queue.writeBuffer(this.modelBuffer!, 0, frame.models, 0, sources.length * 16);
        device.queue.writeBuffer(this.sourceBuffer!, 0, frame.slotSource, 0, frame.count);
        this.uploaded = true;
      }
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
        const { position, index, morph } = sources[source], next = pipelines.get(strideOf(sources[source]))!;
        if (next !== pipeline) { pass.setPipeline(pipeline = next); pass.setBindGroup(0, this.group!); }
        const interleaved = (position as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute;
        if (morph) pass.setVertexBuffer(0, morph.buffer!);
        else pass.setVertexBuffer(0, renderer.backend.get(interleaved ? (position as THREE.InterleavedBufferAttribute).data : position).buffer!, interleaved ? (position as THREE.InterleavedBufferAttribute).offset * 4 : 0);
        if (index) pass.setIndexBuffer(renderer.backend.get(index).buffer!, index.array instanceof Uint16Array ? 'uint16' : 'uint32');
      }
      if (sources[source].index) pass.drawIndexed(draws.count[i], draws.instances[i], draws.start[i], 0, draws.first[i]);
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

  /** Grow the storage buffers to hold `slots` slots, `ids` ids and `sources` sources; a new buffer needs a new bind group. */
  private reserve(device: GpuDevice, slots: number, ids: number, sources: number): void {
    let changed = !this.group;
    const storage = (buffer: GpuBuffer | undefined, count: number, bytes: number, name: string) => {
      if (buffer && buffer.size >= count * bytes) return buffer;
      buffer?.destroy(); changed = true;
      return device.createBuffer({ label: `${this.label} ${name}`, size: capacity(count) * bytes, usage: STORAGE | COPY_DST });
    };
    this.cameraBuffer ??= (changed = true, device.createBuffer({ label: `${this.label} camera`, size: 128, usage: UNIFORM | COPY_DST }));
    this.matrixBuffer = storage(this.matrixBuffer, slots, 64, 'matrices');
    this.idBuffer = storage(this.idBuffer, ids, 4, 'ids');
    this.modelBuffer = storage(this.modelBuffer, sources, 64, 'models');
    this.sourceBuffer = storage(this.sourceBuffer, slots, 4, 'sources');
    if (changed) this.group = device.createBindGroup({ label: this.label, layout: this.layout, entries: [this.cameraBuffer, this.matrixBuffer, this.idBuffer, this.modelBuffer, this.sourceBuffer]
      .map((buffer, binding) => ({ binding, resource: { buffer } })) });
  }

  dispose(): void {
    this.frame.releaseAll();
    for (const released of this.frame.released.splice(0)) released.buffer?.destroy();
    for (const buffer of [this.matrixBuffer, this.idBuffer, this.cameraBuffer, this.modelBuffer, this.sourceBuffer]) buffer?.destroy();
    this.matrixBuffer = this.idBuffer = this.cameraBuffer = this.modelBuffer = this.sourceBuffer = undefined; this.group = undefined;
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

function strideOf({ position, morph }: Source): number {
  return !morph && (position as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute ? (position as THREE.InterleavedBufferAttribute).data.stride * 4 : 12;
}
