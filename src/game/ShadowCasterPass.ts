import * as THREE from 'three/webgpu';

/** Draws the sun's shadow casters into a map with WebGPU directly. Three renders each map as a
 * whole scene pass: it walks every object (the fleet's batched originals stay in the graph, only
 * masked by layers), then prepares each draw through its node material path. The casters are
 * plain depth writes, so this pass collects them once a frame for every map, culls each batched
 * part against each map, and submits position-only draws from three's own vertex buffers.
 * Morph meshes (the canvas gun covers) are blended here as three's vertex stage blends them. Casters
 * three must draw itself (skinned, instanced, custom vertex, depth or discard nodes, one-sided, LOD)
 * it still draws, first, from a scene holding only them; a map is left wholly to three until its
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

/** A float32 xyz position this pass can bind as its only vertex buffer. */
function plainPosition(geometry: THREE.BufferGeometry): boolean {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined;
  if (!position || position.itemSize !== 3 || position.normalized) return false;
  const array = (position as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute ? (position as THREE.InterleavedBufferAttribute).data.array : position.array;
  return array instanceof Float32Array && !(geometry as THREE.InstancedBufferGeometry).isInstancedBufferGeometry;
}

export interface ShadowCasters {
  batches: THREE.BatchedMesh[];
  meshes: THREE.Mesh[];
  /** Casters only three's own shadow render draws; a map they reach is left to it. */
  others: THREE.Object3D[];
}

/** The shadow casters three's pass would visit for `layers`: visible subtrees, objects on those
 * layers with `castShadow`, sorted by how this pass can draw them. */
export function collectShadowCasters(scene: THREE.Object3D, layers: number, out: ShadowCasters = { batches: [], meshes: [], others: [] }): ShadowCasters {
  out.batches.length = out.meshes.length = out.others.length = 0;
  const stack: THREE.Object3D[] = [scene];
  while (stack.length) {
    const object = stack.pop()!;
    if (!object.visible) continue;
    if (object.layers.mask & layers) {
      // Three picks LOD levels and clipping per camera, which this pass does not.
      if (((object as THREE.LOD).isLOD && (object as THREE.LOD).autoUpdate) || ((object as { isClippingGroup?: boolean; enabled?: boolean }).isClippingGroup && (object as { enabled?: boolean }).enabled)) out.others.push(object);
      else if (object.castShadow) classify(object, out);
    }
    const children = object.children;
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
  }
  return out;
}

function classify(object: THREE.Object3D, out: ShadowCasters): void {
  const mesh = object as THREE.Mesh;
  if (!mesh.isMesh) {
    if ((object as THREE.Line).isLine || (object as THREE.Points).isPoints || (object as THREE.Sprite).isSprite) out.others.push(object);
    return;
  }
  // A batch builds its geometry on its first addition; until then it draws nothing.
  if ((mesh as THREE.BatchedMesh).isBatchedMesh && !mesh.geometry.getAttribute('position')) return;
  if (!plainShadowMaterial(mesh.material) || !plainPosition(mesh.geometry)) out.others.push(mesh);
  else if ((mesh as THREE.BatchedMesh).isBatchedMesh) out.batches.push(mesh as THREE.BatchedMesh);
  else if ((mesh as THREE.InstancedMesh).isInstancedMesh || (mesh as THREE.SkinnedMesh).isSkinnedMesh ||
    mesh.onBeforeRender !== NO_CALLBACK || mesh.onBeforeShadow !== NO_SHADOW_CALLBACK) out.others.push(mesh);
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
    const scale = geometry.morphTargetsRelative ? 1 : 1 - sum;
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
    targets.forEach((target, i) => { if (influences[i]) add(target, influences[i], false); });
    this.version++;
  }
}

/** One geometry's buffers: a batch's combined geometry or a single mesh's, whose positions a morph may replace. */
interface Source { position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute; index: THREE.BufferAttribute | null; morph?: MorphPositions }

/** The frame's casters as world matrices and bounding spheres, one slot per drawn instance. A
 * source's slots are consecutive and sorted by geometry range, so equal ranges draw instanced. */
export class ShadowCasterFrame {
  matrices = new Float32Array(16 * 256);
  spheres = new Float32Array(4 * 256);
  count = 0;
  sources: Source[] = [];
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

  prepare(casters: ShadowCasters): void {
    this.count = 0; this.sources.length = 0; this.frames++;
    for (const batch of casters.batches) this.addBatch(batch);
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
    const source = this.sources.push({ position: batch.geometry.getAttribute('position') as THREE.BufferAttribute, index: batch.geometry.index }) - 1;
    if (instances.length > 0x10000) return this.addUnsortable(batch, source);
    // Slots of one range are consecutive, so a cascade draws each range it keeps as one instanced draw.
    const keys = this.keys; keys.length = 0;
    for (let i = 0; i < instances.length; i++) {
      const instance = instances[i];
      if (instance.active && instance.visible && geometries[instance.geometryIndex]?.active) keys.push(instance.geometryIndex * 0x10000 + i);
    }
    keys.sort((a, b) => a - b);
    for (const key of keys) {
      const geometryId = Math.floor(key / 0x10000), instance = key % 0x10000, range = geometries[geometryId];
      const slot = this.slot(source, range.start, range.count);
      if (identity) this.matrices.set(data.subarray(instance * 16, instance * 16 + 16), slot * 16);
      else this.matrix.fromArray(data, instance * 16).premultiply(world).toArray(this.matrices, slot * 16);
      batch.getBoundingSphereAt(geometryId, this.sphere);
      this.bound(slot);
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
      this.matrix.fromArray(data, i * 16).premultiply(batch.matrixWorld).toArray(this.matrices, slot * 16);
      batch.getBoundingSphereAt(instance.geometryIndex, this.sphere);
      this.bound(slot);
    });
  }

  private addMesh(mesh: THREE.Mesh): void {
    const geometry = mesh.geometry, index = geometry.index, position = geometry.getAttribute('position');
    const available = (index ?? position).count, start = Math.max(0, geometry.drawRange.start);
    const count = Math.min(geometry.drawRange.count, available - start);
    if (count <= 0) return;
    let morph: MorphPositions | undefined;
    if (mesh.morphTargetInfluences?.length) {
      morph = this.morphs.get(mesh);
      if (!morph) this.morphs.set(mesh, morph = new MorphPositions(mesh));
      morph.seen = this.frames; morph.update();
    }
    const slot = this.slot(this.sources.push({ position: position as THREE.BufferAttribute, index, morph }) - 1, start, count);
    mesh.matrixWorld.toArray(this.matrices, slot * 16);
    if (!mesh.frustumCulled) { this.spheres.fill(0, slot * 4, slot * 4 + 3); this.spheres[slot * 4 + 3] = Infinity; return; }
    if (!geometry.boundingSphere) geometry.computeBoundingSphere();
    this.sphere.copy(geometry.boundingSphere!);
    this.bound(slot);
  }

  private slot(source: number, start: number, count: number): number {
    const slot = this.count++;
    if (slot * 16 >= this.matrices.length) {
      const grow = <T extends Float32Array | Int32Array>(array: T, size: number): T => { const next = new (array.constructor as new (n: number) => T)(size); next.set(array); return next; };
      const slots = this.matrices.length / 8;
      this.matrices = grow(this.matrices, slots * 16); this.spheres = grow(this.spheres, slots * 4);
      this.slotSource = grow(this.slotSource, slots); this.slotStart = grow(this.slotStart, slots); this.slotCount = grow(this.slotCount, slots);
    }
    this.slotSource[slot] = source; this.slotStart[slot] = start; this.slotCount[slot] = count;
    return slot;
  }

  /** World bounds of `this.sphere` under the slot's matrix, as `Sphere.applyMatrix4` computes them. */
  private bound(slot: number): void {
    const m = this.matrices, o = slot * 16, c = this.sphere.center, s = this.spheres, i = slot * 4;
    s[i] = m[o] * c.x + m[o + 4] * c.y + m[o + 8] * c.z + m[o + 12];
    s[i + 1] = m[o + 1] * c.x + m[o + 5] * c.y + m[o + 9] * c.z + m[o + 13];
    s[i + 2] = m[o + 2] * c.x + m[o + 6] * c.y + m[o + 10] * c.z + m[o + 14];
    const scale = Math.max(m[o] ** 2 + m[o + 1] ** 2 + m[o + 2] ** 2, m[o + 4] ** 2 + m[o + 5] ** 2 + m[o + 6] ** 2, m[o + 8] ** 2 + m[o + 9] ** 2 + m[o + 10] ** 2);
    s[i + 3] = this.sphere.radius < 0 ? -1 : this.sphere.radius * Math.sqrt(scale);
  }
}

function isIdentity(matrix: THREE.Matrix4): boolean {
  const e = matrix.elements;
  for (let i = 0; i < 16; i++) if (e[i] !== (i % 5 === 0 ? 1 : 0)) return false;
  return true;
}

/** One map's draws: slots in `ids` order, and per draw its source, range and instances. */
export class ShadowCascadeDraws {
  ids = new Uint32Array(256);
  idCount = 0;
  source = new Int32Array(64);
  start = new Int32Array(64);
  count = new Int32Array(64);
  first = new Int32Array(64);
  instances = new Int32Array(64);
  drawCount = 0;

  /** Keep the slots whose spheres touch `frustum`; consecutive kept slots of one range share a draw. */
  cull(frame: ShadowCasterFrame, frustum: THREE.Frustum): void {
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
struct Cascade { viewProjection: mat4x4f };
@group(0) @binding(0) var<uniform> cascade: Cascade;
@group(0) @binding(1) var<storage, read> matrices: array<mat4x4f>;
@group(0) @binding(2) var<storage, read> ids: array<u32>;
@vertex fn main(@location(0) position: vec3f, @builtin(instance_index) instance: u32) -> @builtin(position) vec4f {
  return cascade.viewProjection * (matrices[ids[instance]] * vec4f(position, 1.0));
}`;

type ShadowMapTarget = THREE.RenderTarget & { depthTexture: THREE.DepthTexture };

export class ShadowCasterPass {
  /** Off: every map is three's own scene pass, for comparison. */
  enabled = true;
  /** Since creation: maps drawn here, maps left wholly to three, maps three shared (drawing its own casters first). */
  readonly stats = { drawn: 0, deferred: 0, shared: 0, draws: 0, instances: 0 };
  private readonly casters: ShadowCasters = { batches: [], meshes: [], others: [] };
  private readonly frame = new ShadowCasterFrame();
  private readonly draws = new ShadowCascadeDraws();
  private readonly frustum = new THREE.Frustum();
  private readonly viewProjection = new THREE.Matrix4();
  private readonly uniforms = new Float32Array(16);
  private collectedFrame = -1;
  private collectedLayers = 0;
  private uploaded = false;
  private layout?: object;
  private module?: object;
  private pipelineLayout?: object;
  private readonly pipelines = new Map<string, object | 'pending' | 'failed'>();
  private cascadeBuffer?: GpuBuffer;
  private matrixBuffer?: GpuBuffer;
  private idBuffer?: GpuBuffer;
  private group?: object;
  private readonly views = new WeakMap<GpuTexture, object>();
  private readonly reached: THREE.Object3D[] = [];
  private proxy?: THREE.Scene;

  constructor(private readonly renderer: THREE.WebGPURenderer) {}

  /** Draw `target`'s map from `camera` (its matrices already updated). False leaves it to three. */
  draw(scene: THREE.Object3D, camera: THREE.OrthographicCamera, target: ShadowMapTarget, frameId: number): boolean {
    const renderer = this.renderer as unknown as RendererInternals;
    if (!this.enabled || renderer.shadowMap.type === THREE.VSMShadowMap || target.samples > 1) return this.defer();
    const device = renderer.backend.device, attributes = renderer._attributes;
    // Three sets these on a camera the first time it renders from it; until then the matrices differ.
    if (!device || !attributes || camera.coordinateSystem !== renderer.coordinateSystem || camera.reversedDepth !== renderer.reversedDepthBuffer) return this.defer();
    const texture = renderer.backend.get(target.depthTexture).texture;
    if (!texture || texture.width !== target.width || texture.height !== target.height || texture.depthOrArrayLayers !== 1 || texture.sampleCount !== 1) return this.defer();
    if (frameId !== this.collectedFrame || camera.layers.mask !== this.collectedLayers) {
      collectShadowCasters(scene, camera.layers.mask, this.casters);
      this.frame.prepare(this.casters);
      for (const released of this.frame.released.splice(0)) released.buffer?.destroy();
      this.collectedFrame = frameId; this.collectedLayers = camera.layers.mask; this.uploaded = false;
    }
    this.viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.viewProjection, camera.coordinateSystem, camera.reversedDepth);
    const reached = this.reached; reached.length = 0;
    for (const other of this.casters.others) if (!(other as THREE.Mesh).isMesh || !other.frustumCulled || this.frustum.intersectsObject(other as THREE.Mesh)) reached.push(other);
    this.draws.cull(this.frame, this.frustum);
    // Every source this map draws must have its buffers uploaded and current.
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
    // Three clears the map as it draws its share, then this pass adds the rest.
    if (reached.length) { this.drawOthers(scene as THREE.Scene, camera, reached); this.stats.shared++; }
    if (draws.drawCount || !reached.length) this.encode(device, renderer, texture, pipelines, reached.length > 0);
    this.stats.drawn++; this.stats.draws += draws.drawCount; this.stats.instances += draws.idCount;
    return true;
  }

  /** Three's own shadow render of `objects` alone, into the map it has bound, with the shadow
   * material and object callbacks it set on `scene`. */
  private drawOthers(scene: THREE.Scene, camera: THREE.Camera, objects: THREE.Object3D[]): void {
    const proxy = this.proxy ??= Object.assign(new THREE.Scene(), { name: 'Shadow casters three draws', matrixWorldAutoUpdate: false });
    proxy.children = objects; proxy.overrideMaterial = scene.overrideMaterial;
    try { this.renderer.render(proxy, camera); }
    finally { proxy.children = []; proxy.overrideMaterial = null; }
  }

  private defer(): false { this.stats.deferred++; return false; }

  /** A morph's blended positions in its own vertex buffer, uploaded once per blend. */
  private uploadMorph(device: GpuDevice, morph: MorphPositions): void {
    morph.buffer ??= device.createBuffer({ label: `Shadow caster morph ${morph.mesh.name}`, size: Math.max(4, morph.positions.byteLength), usage: VERTEX | COPY_DST });
    if (morph.uploaded !== morph.version) { device.queue.writeBuffer(morph.buffer, 0, morph.positions); morph.uploaded = morph.version; }
  }

  private encode(device: GpuDevice, renderer: RendererInternals, texture: GpuTexture, pipelines: Map<number, object>, load: boolean): void {
    const frame = this.frame, draws = this.draws, sources = frame.sources;
    if (draws.drawCount) {
      this.reserve(device, frame.count, draws.idCount);
      if (!this.uploaded) { device.queue.writeBuffer(this.matrixBuffer!, 0, frame.matrices, 0, frame.count * 16); this.uploaded = true; }
      // Queue order keeps each map's ids and matrix apart from the next map's writes.
      device.queue.writeBuffer(this.idBuffer!, 0, draws.ids, 0, draws.idCount);
      this.uniforms.set(this.viewProjection.elements);
      device.queue.writeBuffer(this.cascadeBuffer!, 0, this.uniforms);
    }
    let view = this.views.get(texture);
    if (!view) this.views.set(texture, view = texture.createView());
    const stencil = texture.format.includes('stencil');
    const encoder = device.createCommandEncoder({ label: 'Shadow casters' });
    const pass = encoder.beginRenderPass({ label: 'Shadow casters', colorAttachments: [], depthStencilAttachment: {
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

  /** The depth-only pipeline for a position stride; created asynchronously, so maps wait for three meanwhile. */
  private pipeline(device: GpuDevice, format: string, stride: number): object | undefined {
    const key = `${format}:${stride}`, known = this.pipelines.get(key);
    if (known === 'pending' || known === 'failed') return undefined;
    if (known) return known;
    this.module ??= device.createShaderModule({ label: 'Shadow casters', code: SHADER });
    this.layout ??= device.createBindGroupLayout({ label: 'Shadow casters', entries: [
      { binding: 0, visibility: VERTEX_STAGE, buffer: { type: 'uniform' } },
      { binding: 1, visibility: VERTEX_STAGE, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: VERTEX_STAGE, buffer: { type: 'read-only-storage' } },
    ] });
    this.pipelineLayout ??= device.createPipelineLayout({ label: 'Shadow casters', bindGroupLayouts: [this.layout] });
    this.pipelines.set(key, 'pending');
    device.createRenderPipelineAsync({
      label: `Shadow casters ${key}`, layout: this.pipelineLayout,
      vertex: { module: this.module, entryPoint: 'main', buffers: [{ arrayStride: stride, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      // Three's shadow material keeps the default LessEqual test, which reversed depth flips.
      depthStencil: { format, depthWriteEnabled: true, depthCompare: (this.renderer as unknown as RendererInternals).reversedDepthBuffer ? 'greater-equal' : 'less-equal' },
    }).then(pipeline => this.pipelines.set(key, pipeline), error => { this.pipelines.set(key, 'failed'); console.warn('Shadow caster pipeline failed; three draws the maps', error); });
    return undefined;
  }

  /** Grow the storage buffers to hold `slots` matrices and `ids` ids; a new buffer needs a new bind group. */
  private reserve(device: GpuDevice, slots: number, ids: number): void {
    const size = (buffer: GpuBuffer | undefined, bytes: number) => !buffer || buffer.size < bytes;
    let changed = false;
    this.cascadeBuffer ??= (changed = true, device.createBuffer({ label: 'Shadow cascade', size: 64, usage: UNIFORM | COPY_DST }));
    if (size(this.matrixBuffer, slots * 64)) {
      this.matrixBuffer?.destroy(); changed = true;
      this.matrixBuffer = device.createBuffer({ label: 'Shadow caster matrices', size: capacity(slots) * 64, usage: STORAGE | COPY_DST });
    }
    if (size(this.idBuffer, ids * 4)) {
      this.idBuffer?.destroy(); changed = true;
      this.idBuffer = device.createBuffer({ label: 'Shadow caster ids', size: capacity(ids) * 4, usage: STORAGE | COPY_DST });
    }
    if (changed || !this.group) this.group = device.createBindGroup({ label: 'Shadow casters', layout: this.layout, entries: [
      { binding: 0, resource: { buffer: this.cascadeBuffer } },
      { binding: 1, resource: { buffer: this.matrixBuffer } },
      { binding: 2, resource: { buffer: this.idBuffer } },
    ] });
  }

  dispose(): void {
    this.frame.releaseAll();
    for (const released of this.frame.released.splice(0)) released.buffer?.destroy();
    this.matrixBuffer?.destroy(); this.idBuffer?.destroy(); this.cascadeBuffer?.destroy();
    this.matrixBuffer = this.idBuffer = this.cascadeBuffer = undefined; this.group = undefined;
    this.pipelines.clear();
  }
}

/** Power-of-two capacity, at least 256 entries, so growth is rare and never empty. */
const capacity = (n: number) => 2 ** Math.ceil(Math.log2(Math.max(n, 256)));

function strideOf({ position, morph }: Source): number {
  return !morph && (position as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute ? (position as THREE.InterleavedBufferAttribute).data.stride * 4 : 12;
}
