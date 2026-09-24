import { REVISION } from 'three/webgpu';

type Binding = {
  isUniformBuffer?: boolean; isStorageBuffer?: boolean; isSampledTexture?: boolean; isSampler?: boolean;
  attribute?: object; texture?: object; store?: boolean; mipLevel?: number;
};
type BindGroup = { bindings: Binding[] };
type Data = { buffer?: object; texture?: object; externalTexture?: object; sampler?: object; group?: object };
type Utils = {
  createBindings(bindGroup: BindGroup, bindings: unknown, cacheIndex: number, version?: number): void;
  createBindingsLayout(bindGroup: BindGroup): object;
};
type Backend = { get?(resource: object): Data; bindingUtils?: Utils };
type Kept = { layout: object; resources: unknown[]; group: object };
type State = { enabled: boolean; built: number; reused: number };

/** GPU bind groups kept per three bind group, most recent first. The ocean and wake fields a hull's paint samples are
 * ping-ponged every frame, so its bind group alternates between two; a few spare slots cover fields on other cadences. */
export const KEPT_BIND_GROUPS = 4;
const states = new WeakMap<object, State>();

export function setBindGroupReuseEnabled(backend: object, enabled: boolean): void {
  const state = states.get(backend);
  if (state) state.enabled = enabled;
}
export function bindGroupReuseStats(backend: object): Readonly<State> | undefined { return states.get(backend); }

/** What three r185's `WebGPUBindingUtils.createBindGroup` binds for each binding: a uniform or storage buffer, a sampler, or a
 * texture view, which it takes from the texture's own view cache by GPU texture, level count and base level. Undefined when a
 * binding imports an external texture, which is a new resource every time. */
export function bindGroupResources(backend: { get(resource: object): Data }, bindGroup: BindGroup): unknown[] | undefined {
  const resources: unknown[] = [];
  for (const binding of bindGroup.bindings) {
    if (binding.isUniformBuffer) resources.push(backend.get(binding).buffer);
    else if (binding.isStorageBuffer) resources.push(backend.get(binding.attribute!).buffer);
    else if (binding.isSampledTexture) {
      const data = backend.get(binding.texture!);
      if (data.externalTexture !== undefined) return undefined;
      // The texture object picks the view's dimension; the GPU texture and data its size, levels and cached view.
      resources.push(binding.texture, data, data.texture, binding.store ? binding.mipLevel : -1);
    } else if (binding.isSampler) resources.push(backend.get(binding).sampler);
    else resources.push(undefined);
  }
  return resources;
}
function same(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Adapter for pinned Three r185. When a sampled texture's binding points at another texture (the ocean's ping-ponged wave
 * fields, every frame), three rebuilds the object's bind group, and its own cache of built groups misses whenever any bound
 * texture's version moved since, which the fleet's pose and draw-list textures do every frame: every hull's paint built a new
 * descriptor and GPU bind group each frame. A WebGPU bind group is immutable and defined by its layout, label and the resources
 * it binds, so the group built earlier for the same three bind group, layout and resources is bound instead. Three's path
 * still decides when to rebind; a new combination is built by three as before. */
export function installBindGroupReuse(value: object): void {
  const backend = value as Backend, utils = backend.bindingUtils;
  if (REVISION !== '185' || !utils?.createBindings || !utils.createBindingsLayout || !backend.get || states.has(value)) return;
  const state: State = { enabled: true, built: 0, reused: 0 };
  states.set(value, state);
  const kept = new WeakMap<object, Kept[]>(), get = backend.get.bind(backend), build = utils.createBindings;
  utils.createBindings = function (bindGroup, bindings, cacheIndex, version) {
    if (!state.enabled) return build.call(this, bindGroup, bindings, cacheIndex, version);
    const layout = this.createBindingsLayout(bindGroup), resources = bindGroupResources({ get }, bindGroup);
    const list = kept.get(bindGroup) ?? [];
    if (resources) for (let i = 0; i < list.length; i++) {
      const entry = list[i];
      if (entry.layout !== layout || !same(entry.resources, resources)) continue;
      if (i) { list.splice(i, 1); list.unshift(entry); }
      get(bindGroup).group = entry.group; state.reused++;
      return;
    }
    build.call(this, bindGroup, bindings, cacheIndex, version); state.built++;
    const group = get(bindGroup).group;
    if (!resources || !group) return;
    list.unshift({ layout, resources, group });
    if (list.length > KEPT_BIND_GROUPS) list.length = KEPT_BIND_GROUPS;
    kept.set(bindGroup, list);
  };
}
