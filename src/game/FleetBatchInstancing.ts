import { REVISION, type BufferAttribute, type BufferGeometry, type Material, type Object3D } from 'three/webgpu';
import { FleetBatch, type FleetDrawState } from './FleetBatch';

type Encoder = {
  draw(vertices: number, instances: number, firstVertex: number, firstInstance: number): void;
  drawIndexed(indices: number, instances: number, firstIndex: number, baseVertex: number, firstInstance: number): void;
  executeBundles?(bundles: object[]): void;
};
type DrawInfo = { update(object: Object3D, count: number, instances: number): void };
type RenderObject = { object: Object3D; material: Material & { wireframe?: boolean }; context?: object; getIndex(): BufferAttribute | null };
type Sets = { attributes: Record<number, unknown>; bindingGroups: unknown[]; pipeline: unknown; index: unknown };
type DrawArgs = [RenderObject, DrawInfo, unknown, object, object[], BufferAttribute[], unknown, Encoder, Sets];
type Backend = {
  isWebGPUBackend?: boolean; _draw?: (...args: DrawArgs) => void;
  get?(resource: object): { buffer?: object; group?: object };
  pipelineUtils?: { createBundleEncoder(context: object, label: string): Encoder & { finish(): object } };
};
type Range = { start: number; count: number; first: number; instances: number };
type CachedBundle = { bundle: object; pipeline: object; index: object | undefined; buffers: (object | undefined)[]; bindings: (object | undefined)[]; bytes: number; ranges: Range[] };
const installed = new WeakSet<object>();
const bundleSettings = new WeakMap<object, { enabled: boolean; hits: number; builds: number }>();
export function setFleetBatchBundlesEnabled(backend: object, enabled: boolean): void {
  const state = bundleSettings.get(backend) ?? { enabled, hits: 0, builds: 0 };
  state.enabled = enabled; bundleSettings.set(backend, state);
}
export function fleetBatchSubmissionStats(backend: object) { return bundleSettings.get(backend); }

function sameResources(a: (object | undefined)[], b: (object | undefined)[]): boolean {
  return a.length === b.length && a.every((resource, i) => resource === b[i]);
}
function sameRanges(state: FleetDrawState, length: number, ranges: Range[]): boolean {
  let first = 0;
  for (const range of ranges) {
    if (range.first !== first || first + range.instances > length) return false;
    for (let i = 0; i < range.instances; i++, first++) {
      if (state._multiDrawStarts[first] !== range.start || state._multiDrawCounts[first] !== range.count) return false;
    }
  }
  return first === length;
}

/** Adapter for pinned Three r185. Its BatchedMesh shader indexes poses with
 * instance_index, including firstInstance, but the backend submits one native
 * draw per pose. Coalesce equal, consecutive geometry ranges after culling.
 * Keep Three's pipeline/buffer binding path and all non-fleet draws intact. */
export function installFleetBatchInstancing(value: object): void {
  const backend = value as Backend;
  if (REVISION !== '185' || !backend.isWebGPUBackend || !backend._draw || installed.has(value)) return;
  const original = backend._draw;
  const bundles = new WeakMap<RenderObject, CachedBundle>();
  if (!bundleSettings.has(value)) setFleetBatchBundlesEnabled(value, true);
  const stats = bundleSettings.get(value)!;
  backend._draw = function (...args: DrawArgs) {
    const [renderObject, info, , pipeline, bindings, vertexBuffers, , encoder, currentSets] = args;
    const { object, material } = renderObject;
    if (!(object instanceof FleetBatch) || object.sortObjects || material.transparent) return original.apply(this, args);
    const state = object as unknown as FleetDrawState;
    const length = state._multiDrawCount;
    const bind = (drawArgs: DrawArgs) => {
      // Keep Three's pipeline/buffer binding path. Restore even if it fails.
      state._multiDrawCount = 0;
      try { original.apply(this, drawArgs); } finally { state._multiDrawCount = length; }
    };
    const index = renderObject.getIndex();
    const geometry: BufferGeometry = object.geometry;
    const bytes = material.wireframe ? geometry.attributes.position.count > 65535 ? 4 : 2 : index?.array.BYTES_PER_ELEMENT ?? 1;
    // The renderer still updates uniforms/textures and performs current camera
    // culling. Only native draw commands are retained, with exact invalidation
    // when their ranges, pipeline or GPU resources change.
    if (stats.enabled && length >= 16 && !material.stencilWrite && renderObject.context &&
        encoder.executeBundles && backend.get && backend.pipelineUtils) {
      const indexBuffer = index ? backend.get(index).buffer : undefined;
      const buffers = vertexBuffers.map(buffer => backend.get!(buffer).buffer);
      const groups = bindings.map(group => backend.get!(group).group);
      let cached = bundles.get(renderObject);
      if (!cached || cached.pipeline !== pipeline || cached.index !== indexBuffer || cached.bytes !== bytes ||
          !sameResources(cached.buffers, buffers) || !sameResources(cached.bindings, groups) || !sameRanges(state, length, cached.ranges)) {
        const bundleEncoder = backend.pipelineUtils.createBundleEncoder(renderObject.context, 'Fleet surface draws');
        const bundleArgs: DrawArgs = [...args];
        bundleArgs[7] = bundleEncoder;
        bundleArgs[8] = { attributes: {}, bindingGroups: [], pipeline: null, index: null };
        bind(bundleArgs);
        const ranges: Range[] = [];
        for (let first = 0; first < length;) {
          const start = state._multiDrawStarts[first], count = state._multiDrawCounts[first];
          let end = first + 1;
          while (end < length && state._multiDrawStarts[end] === start && state._multiDrawCounts[end] === count) end++;
          if (index) bundleEncoder.drawIndexed(count, end - first, start / bytes, 0, first);
          else bundleEncoder.draw(count, end - first, start, first);
          ranges.push({ start, count, first, instances: end - first }); first = end;
        }
        cached = { bundle: bundleEncoder.finish(), pipeline, index: indexBuffer, buffers, bindings: groups, bytes, ranges };
        bundles.set(renderObject, cached); stats.builds++;
      } else stats.hits++;
      encoder.executeBundles([cached.bundle]);
      // WebGPU clears these bindings after executeBundles. Three must bind
      // them again before the following ordinary mesh is submitted.
      currentSets.attributes = {}; currentSets.bindingGroups = []; currentSets.pipeline = null; currentSets.index = null;
      for (const range of cached.ranges) info.update(object, range.count, range.instances);
      return;
    }
    bind(args);
    for (let first = 0; first < length;) {
      const start = state._multiDrawStarts[first], count = state._multiDrawCounts[first];
      let end = first + 1;
      while (end < length && state._multiDrawStarts[end] === start && state._multiDrawCounts[end] === count) end++;
      if (index) encoder.drawIndexed(count, end - first, start / bytes, 0, first);
      else encoder.draw(count, end - first, start, first);
      info.update(object, count, end - first);
      first = end;
    }
  };
  installed.add(value);
}
