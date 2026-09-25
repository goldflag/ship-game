import { REVISION, type Camera, type ComputeNode, type Material, type Mesh, type QuadMesh, type RenderTarget, type Texture, type WebGPURenderer } from 'three/webgpu';

/** Small passes three would render or dispatch one at a time (the ocean's wave transform and foam, its wake steps and height readback,
 * the sky's cloud kernels, environment bake and prefilter) encoded straight onto three's device, several to a command encoder and one
 * submit. Three r185 renders a mesh as a whole scene: a render context, a render list and its projection, a command encoder and a
 * submit, then an encoder and a submit per texture for the target's mipmaps; a compute or a readback takes an encoder and a submit
 * of its own. In a 30-ship battle ~14 quads a frame cost the ocean ~0.3 ms, most of it fixed per render.
 *
 * A pass here runs three's own per-draw updates for its render object in three's order, under a render id of its own as a render
 * would (node updates, uniform and texture bindings, the pipeline check), then begins a pass on the same attachments, clearing or
 * loading them as three would, sets three's viewport, binds three's pipeline, bind groups and vertex buffers and draws with three's
 * draw parameters: every texel is written as three writes it. A render object (or compute node) drawn twice before a submit would see
 * only its last uniforms, so the passes before it are submitted first. A pass three has not drawn yet (or whose render object,
 * material, target textures or render state changed since) is drawn by three, after the passes before it are submitted, and its render
 * object is taken from that draw. A target's mipmaps are three's own passes, in the same encoder. Compute runs three's own `compute`
 * with its pass in the shared encoder.
 *
 * `begin`/`end` hold the submit; a three render or submit made while passes are held must not read or write what they touch.
 * `enabled = false` draws every pass through three. */

type Gpu = object;
type GpuBuffer = { mapAsync(mode: number): Promise<void>; getMappedRange(): ArrayBuffer; unmap(): void; destroy(): void };
type GpuPass = {
  setPipeline(pipeline: Gpu): void; setBindGroup(index: number, group: Gpu): void; setVertexBuffer(slot: number, buffer: Gpu): void;
  setIndexBuffer(buffer: Gpu, format: string): void; setViewport(x: number, y: number, width: number, height: number, minDepth: number, maxDepth: number): void;
  draw(vertices: number, instances: number, first: number, firstInstance: number): void;
  drawIndexed(indices: number, instances: number, first: number, base: number, firstInstance: number): void; end(): void;
};
type GpuEncoder = {
  beginRenderPass(descriptor: object): GpuPass; beginComputePass(descriptor: object): Gpu; finish(): Gpu;
  copyTextureToBuffer(source: object, destination: object, size: object): void;
};
type GpuTexture = { createView(descriptor: object): Gpu };
type GpuDevice = { createCommandEncoder(descriptor: { label: string }): GpuEncoder; queue: { submit(buffers: Gpu[]): void } };
type Attribute = { array: ArrayLike<number> };
/** The pinned r185 render object fields and methods a pass reads. */
export type PassRenderObject = {
  object: object; material: Material; version: number; pipeline: object; drawRange: unknown; group: unknown;
  getBindings(): object[]; getVertexBuffers(): object[] | null; getIndex(): Attribute | null;
  getDrawParameters(): { vertexCount: number; firstVertex: number; instanceCount: number } | null;
  getNodeBuilderState(): { updateBeforeNodes: unknown[]; updateAfterNodes: unknown[] };
};
type ComputeGroup = ComputeNode | ComputeNode[];
type Backend = {
  device?: GpuDevice; trackTimestamp?: boolean; get(resource: object): Record<string, unknown>;
  draw(renderObject: PassRenderObject, info: unknown): void;
  beginCompute(group: ComputeGroup): void; finishCompute(group: ComputeGroup): void;
  textureUtils: { generateMipmaps(texture: Texture, encoder: GpuEncoder): void };
};
type Internals = {
  backend: Backend;
  _nodes: { nodeFrame: { renderId: number }; needsRefresh(ro: PassRenderObject): boolean; updateBefore(ro: PassRenderObject): void;
    updateForRender(ro: PassRenderObject): void; updateAfter(ro: PassRenderObject): void };
  _geometries: { updateForRender(ro: PassRenderObject): void };
  _bindings: { updateForRender(ro: PassRenderObject): void };
  _pipelines: { has(ro: PassRenderObject): boolean; updateForRender(ro: PassRenderObject): void; isReady(ro: PassRenderObject): boolean };
  _isDeviceLost?: boolean;
  _clearColor: { r: number; g: number; b: number; a: number };
  info: { calls: number; render: { calls: number; frameCalls: number }; update(object: object, count: number, instances: number): void };
  contextNode: { id: number; version: number }; lighting: { enabled: boolean }; shadowMap: { enabled: boolean; type: number };
  autoClear: boolean; autoClearColor: boolean; alpha: boolean;
  getMRT(): unknown; getScissorTest(): boolean; getRenderTarget(): RenderTarget | null; getActiveCubeFace(): number;
  setRenderTarget(target: RenderTarget | null, face?: number, level?: number): void;
  render(scene: object, camera: Camera): void; compute(nodes: ComputeGroup, size?: unknown): void;
};
/** A captured pass: its render object, what it was drawn under, and its attachments at its layer. */
interface Entry {
  ro: PassRenderObject;
  mrt: unknown;
  /** Render state three's render object cache key reads (context node, lighting, shadow map), as captured. */
  state: number[];
  /** The target's size, its textures' versions and the GPU textures the attachments were made from (three makes new ones when a
   * version or the size moves), and the pass's attachments, views at the layer. */
  size: [number, number];
  versions: number[];
  textures: unknown[];
  attachments: { view: Gpu; loadOp: string; storeOp: string; clearValue: { r: number; g: number; b: number; a: number } }[];
}

const BLACK = { r: 0, g: 0, b: 0, a: 1 };
const MAP_READ = 0x1;
const own = (object: object, key: string) => Object.prototype.hasOwnProperty.call(object, key);
const passes = new WeakMap<object, DirectPasses>();

/** The direct passes of `renderer`, one set per renderer. */
export function directPasses(renderer: WebGPURenderer): DirectPasses {
  let value = passes.get(renderer);
  if (!value) passes.set(renderer, value = new DirectPasses(renderer));
  return value;
}

const renderState = (r: Internals): number[] => [r.contextNode.id, r.contextNode.version, r.lighting.enabled ? 1 : 0, r.shadowMap.enabled ? 1 : 0, r.shadowMap.type];

export class DirectPasses {
  /** Off: every pass is drawn and dispatched by three, as before. */
  enabled = REVISION === '185';
  readonly stats = { direct: 0, three: 0, captures: 0, computes: 0, readbacks: 0, submits: 0 };
  private readonly r: Internals;
  private readonly entries = new WeakMap<object, WeakMap<RenderTarget, Entry[]>>();
  private encoder: GpuEncoder | null = null;
  /** Render objects and compute nodes encoded since the last submit, and buffers to map after it. */
  private readonly used = new Set<object>();
  private readonly mappings: (() => void)[] = [];
  private depth = 0;
  private readonly clear = { r: 0, g: 0, b: 0, a: 0 };

  constructor(renderer: WebGPURenderer) { this.r = renderer as unknown as Internals; }

  /** Hold submits until the matching `end`: passes drawn in between share encoders (nested holds submit at the outermost end). */
  begin(): void { this.depth++; }
  end(): void { if (--this.depth <= 0) { this.depth = 0; this.flush(); } }

  /** Submit every pass encoded so far (before a draw three makes itself), then map the readbacks among them. */
  flush(): void {
    const encoder = this.encoder;
    if (!encoder) return;
    this.encoder = null; this.used.clear();
    this.r.backend.device!.queue.submit([encoder.finish()]);
    this.stats.submits++;
    for (const map of this.mappings.splice(0)) map();
  }

  /** Draw `mesh` (a quad, or any mesh three draws alone, seen by `camera`) into `target` (array layer `layer`), leaving `target` as the
   * renderer's render target, as three's `render` would. */
  draw(mesh: Mesh, target: RenderTarget, layer = 0, camera: Camera = (mesh as QuadMesh).camera): void {
    if (this.r._isDeviceLost) return;
    if (!this.enabled || !this.supports(mesh, target)) { this.three(mesh, target, layer, camera); return; }
    const entry = this.entry(mesh, target, layer);
    if (!entry || !this.valid(entry, mesh, target)) { this.capture(mesh, target, layer, camera); return; }
    this.encode(entry, mesh, target, layer);
    if (!this.depth) this.flush();
  }

  /** Dispatch `nodes` through three's `compute`, its compute pass in the shared encoder instead of an encoder and a submit of its own. */
  compute(nodes: ComputeGroup): void {
    const r = this.r, backend = r.backend, list = Array.isArray(nodes) ? nodes : [nodes];
    if (r._isDeviceLost) return;
    if (!this.enabled || backend.trackTimestamp || !backend.device) { this.flush(); r.compute(nodes); this.stats.three++; return; }
    // A node's uniform buffers hold one dispatch's values until a submit.
    if (list.some(node => this.used.has(node))) this.flush();
    const encoder = this.encoder ??= backend.device.createCommandEncoder({ label: 'Direct passes' });
    const begin = backend.beginCompute, finish = backend.finishCompute, owned = [own(backend, 'beginCompute'), own(backend, 'finishCompute')];
    backend.beginCompute = function (group) {
      const data = this.get(group);
      data.cmdEncoderGPU = encoder; data.passEncoderGPU = encoder.beginComputePass({ label: 'Direct compute' }); data.currentPipeline = null;
    };
    backend.finishCompute = function (group) { (this.get(group).passEncoderGPU as { end(): void }).end(); };
    try { r.compute(nodes); } finally {
      if (owned[0]) backend.beginCompute = begin; else delete (backend as Partial<Backend>).beginCompute;
      if (owned[1]) backend.finishCompute = finish; else delete (backend as Partial<Backend>).finishCompute;
    }
    for (const node of list) this.used.add(node);
    this.stats.computes++;
    if (!this.depth) this.flush();
  }

  /** Copy the `width` × `height` texels at the origin of `texture` into `buffer` (rows `bytesPerRow` apart) after every pass encoded so
   * far, as three's `readRenderTargetPixelsAsync` copies them; settles once `buffer` is mapped for reading. */
  readback(texture: Texture, buffer: GpuBuffer, bytesPerRow: number, width: number, height: number): Promise<void> {
    const backend = this.r.backend, source = backend.get(texture).texture;
    if (!source || !backend.device) return Promise.reject(new Error('Direct passes: the texture has no GPU copy to read'));
    const encoder = this.encoder ??= backend.device.createCommandEncoder({ label: 'Direct passes' });
    encoder.copyTextureToBuffer({ texture: source, origin: { x: 0, y: 0, z: 0 } }, { buffer, bytesPerRow }, { width, height });
    const mapped = new Promise<void>((resolve, reject) => this.mappings.push(() => { buffer.mapAsync(MAP_READ).then(resolve, reject); }));
    this.stats.readbacks++;
    if (!this.depth) this.flush();
    return mapped;
  }

  /** Run `work` with each `renderer.render(mesh, camera)` it makes into a render target drawn as a pass (three's own helpers, such as its
   * PMREM generator, render that way). */
  routed<T>(work: () => T): T {
    const r = this.r, render = r.render, owned = own(r, 'render'), self = this;
    let drawing = false;
    r.render = function (scene, camera) {
      const target = r.getRenderTarget();
      if (drawing || !target) return render.call(this, scene, camera);
      drawing = true;
      try { self.draw(scene as Mesh, target, r.getActiveCubeFace(), camera); } finally { drawing = false; }
    };
    try { return work(); } finally { if (owned) r.render = render; else delete (r as Partial<Internals>).render; }
  }

  /** Targets and states this reproduces: a lone mesh into colour-only 2D or array targets without multisampling, without a scissor or
   * timestamps. */
  private supports(mesh: Mesh, target: RenderTarget): boolean {
    const r = this.r, material = mesh.material as Material;
    return !!mesh.isMesh && !(mesh as { isScene?: boolean }).isScene && !mesh.children.length && mesh.visible && !Array.isArray(material) && material.visible
      && !target.depthBuffer && !target.samples && !(target as { isRenderTarget3D?: boolean }).isRenderTarget3D && !r.getScissorTest() && !r.backend.trackTimestamp && !!r.backend.device;
  }

  private entry(mesh: Mesh, target: RenderTarget, layer: number): Entry | undefined { return this.entries.get(mesh)?.get(target)?.[layer]; }

  private valid(entry: Entry, mesh: Mesh, target: RenderTarget): boolean {
    const r = this.r, ro = entry.ro, textures = target.textures;
    if (ro.material !== mesh.material || ro.version !== ro.material.version || !r._pipelines.has(ro) || r.getMRT() !== entry.mrt) return false;
    const state = entry.state;
    if (state[0] !== r.contextNode.id || state[1] !== r.contextNode.version || state[2] !== (r.lighting.enabled ? 1 : 0) || state[3] !== (r.shadowMap.enabled ? 1 : 0)
      || state[4] !== r.shadowMap.type) return false;
    if (textures.length !== entry.textures.length || target.width !== entry.size[0] || target.height !== entry.size[1]) return false;
    for (let i = 0; i < textures.length; i++) if (textures[i].version !== entry.versions[i] || r.backend.get(textures[i]).texture !== entry.textures[i]) return false;
    return true;
  }

  private three(mesh: Mesh, target: RenderTarget, layer: number, camera: Camera): void {
    this.flush();
    this.r.setRenderTarget(target, layer);
    this.r.render(mesh, camera);
    this.stats.three++;
  }

  /** Draw through three once, taking the render object it draws `mesh` with. */
  private capture(mesh: Mesh, target: RenderTarget, layer: number, camera: Camera): void {
    const r = this.r, backend = r.backend, owned = own(backend, 'draw'), draw = backend.draw;
    let taken: PassRenderObject | undefined;
    backend.draw = function (renderObject, info) {
      if (renderObject.object === mesh) taken = renderObject;
      return draw.call(this, renderObject, info);
    };
    try { this.three(mesh, target, layer, camera); } finally {
      if (owned) backend.draw = draw; else delete (backend as Partial<Backend>).draw;
    }
    this.stats.captures++;
    const state = taken?.getNodeBuilderState();
    // Nodes updated before or after a draw (render-to-texture, passes) render on their own: those passes stay with three.
    if (!taken || !r._pipelines.isReady(taken) || state!.updateBeforeNodes.length || state!.updateAfterNodes.length) return;
    const textures = target.textures.map(texture => backend.get(texture).texture as GpuTexture | undefined);
    if (textures.some(texture => !texture)) return;
    const layered = target.textures.some(texture => (texture.image as { depth?: number }).depth! > 1);
    const view = { baseMipLevel: 0, mipLevelCount: 1, baseArrayLayer: layer, arrayLayerCount: 1, dimension: layered ? '2d-array' : '2d' };
    const attachments = textures.map(texture => ({ view: texture!.createView(view), loadOp: 'load', storeOp: 'store', clearValue: BLACK }));
    let byTarget = this.entries.get(mesh);
    if (!byTarget) this.entries.set(mesh, byTarget = new WeakMap());
    let layers = byTarget.get(target);
    if (!layers) byTarget.set(target, layers = []);
    layers[layer] = { ro: taken, mrt: r.getMRT(), state: renderState(r), size: [target.width, target.height], versions: target.textures.map(texture => texture.version),
      textures, attachments };
  }

  private encode(entry: Entry, mesh: Mesh, target: RenderTarget, layer: number): void {
    const r = this.r, ro = entry.ro, nodes = r._nodes, frame = nodes.nodeFrame, info = r.info, backend = r.backend;
    // Its uniform buffers hold one draw's values until a submit.
    if (this.used.has(ro)) this.flush();
    r.setRenderTarget(target, layer);
    const renderId = frame.renderId;
    info.calls++; info.render.calls++; info.render.frameCalls++;
    frame.renderId = info.calls;
    try {
      ro.drawRange = mesh.geometry.drawRange; ro.group = null;
      const refresh = nodes.needsRefresh(ro);
      if (refresh) { nodes.updateBefore(ro); r._geometries.updateForRender(ro); nodes.updateForRender(ro); r._bindings.updateForRender(ro); }
      r._pipelines.updateForRender(ro);
      const encoder = this.encoder ??= backend.device!.createCommandEncoder({ label: 'Direct passes' });
      const pass = encoder.beginRenderPass({ label: 'Direct pass', colorAttachments: this.attachments(entry) });
      // Three's viewport for a render target: its own, floored (at the first mip level, the only one drawn here).
      const viewport = target.viewport as { x: number; y: number; z: number; w: number; minDepth?: number; maxDepth?: number };
      pass.setViewport(Math.floor(viewport.x), Math.floor(viewport.y), Math.floor(viewport.z), Math.floor(viewport.w), viewport.minDepth ?? 0, viewport.maxDepth ?? 1);
      const pipeline = r._pipelines.isReady(ro) ? backend.get(ro.pipeline) : undefined, parameters = ro.getDrawParameters();
      if (pipeline && pipeline.error !== true && parameters) {
        pass.setPipeline(pipeline.pipeline as Gpu);
        const bindings = ro.getBindings();
        for (let i = 0; i < bindings.length; i++) pass.setBindGroup(i, backend.get(bindings[i]).group as Gpu);
        const index = ro.getIndex(), buffers = ro.getVertexBuffers() ?? [];
        if (index) pass.setIndexBuffer(backend.get(index).buffer as Gpu, index.array instanceof Uint16Array ? 'uint16' : 'uint32');
        for (let i = 0; i < buffers.length; i++) pass.setVertexBuffer(i, backend.get(buffers[i]).buffer as Gpu);
        const { vertexCount, instanceCount, firstVertex } = parameters;
        if (index) pass.drawIndexed(vertexCount, instanceCount, firstVertex, 0, 0); else pass.draw(vertexCount, instanceCount, firstVertex, 0);
        info.update(mesh, vertexCount, instanceCount);
        if (refresh) nodes.updateAfter(ro);
      }
      pass.end();
      // Three's mipmap passes for the target's textures that ask for them, as its render ends with.
      for (const texture of target.textures) if (texture.generateMipmaps) backend.textureUtils.generateMipmaps(texture, encoder);
      this.used.add(ro);
      this.stats.direct++;
    } finally { frame.renderId = renderId; }
  }

  /** The pass's attachments, cleared (to the renderer's clear colour on the first, black on the others) where three's automatic clear
   * would clear them, otherwise loaded. */
  private attachments(entry: Entry): Entry['attachments'] {
    const r = this.r, clear = r.autoClear && r.autoClearColor, color = r._clearColor, alpha = r.alpha ? color.a : 1;
    this.clear.r = color.r * alpha; this.clear.g = color.g * alpha; this.clear.b = color.b * alpha; this.clear.a = color.a;
    entry.attachments.forEach((attachment, i) => { attachment.loadOp = clear ? 'clear' : 'load'; attachment.clearValue = i ? BLACK : this.clear; });
    return entry.attachments;
  }
}
