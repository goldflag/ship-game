import { NodeUpdateType, REVISION, Texture as ThreeTexture, TextureNode as ThreeTextureNode } from 'three/webgpu';

type Texture = {
  id: number; version: number; isStorageTexture?: boolean; mipmapsAutoUpdate?: boolean; isDepthTexture?: boolean;
  minFilter: number; magFilter: number; wrapS: number; wrapT: number; wrapR?: number; anisotropy: number; compareFunction: unknown;
};
type TextureRecord = { initialized?: boolean; version?: number; generation?: unknown; isDefaultTexture?: boolean; bindGroups: Set<BindGroup> };
type Attribute = { isIndirectStorageBufferAttribute?: boolean };
type Binding = {
  groupNode: { updateType: string }; isStorageBuffer?: boolean; isUniformBuffer?: boolean; isSampledTexture?: boolean; isSampler?: boolean; isBuffer?: boolean;
  attribute: Attribute; texture: Texture | null; textureNode?: { value: Texture | null; referenceNode?: unknown; compareNode?: unknown }; version: number; generation: unknown;
  samplerKey: unknown; store?: boolean; updateRanges: unknown[]; update(): boolean; clearUpdateRanges(): void; [SAMPLER]?: SamplerMemo;
};
type BindGroup = { bindings: Binding[]; [PLAN]?: Plan };
type Store = { delete(object: object): unknown; dispose?(): void };
type Bindings = {
  backend: Store & {
    get(object: object): { attribute?: Attribute; externalTexture?: unknown }; updateBinding(binding: Binding): void; generateMipmaps(texture: Texture): void;
    updateBindings(group: BindGroup, groups: BindGroup[], cacheIndex: number, version: number): void;
  };
  textures: Store & { get(texture: Texture): TextureRecord; updateTexture(texture: Texture): void; updateSampler(binding: Binding): unknown; needsMipmaps(texture: Texture): boolean };
  attributes: { update(attribute: Attribute, type: number): void };
  get(object: object): { needsMipmap?: boolean };
  _update(group: BindGroup, groups: BindGroup[]): void;
};
/** `lookups`: a texture that has not moved skips the two records three discards. `stable`: a texture or sampler whose texture cannot have
 * moved since its group's last visit is not visited. `swaps`: a texture swapped for one already uploaded skips `Textures.updateTexture`,
 * which would return at once, and a sampler whose new texture has its old one's settings keeps its key without rebuilding it. `audit`:
 * every skipped visit is checked against the binding's own state. */
export type BindingSwitches = { lookups: boolean; stable: boolean; swaps: boolean; audit: boolean };
type Stats = { deferred: number; visited: number; skipped: number; plans: number; audited: number; violations: number };
type State = BindingSwitches & { stats: Stats };
const states = new WeakMap<object, State>();

/** Switches parts off (for comparison: all off is three's own `Bindings._update`) or on. */
export function setBindingUpdates(renderer: object, switches: Partial<BindingSwitches>): void {
  const state = states.get(renderer);
  if (state) Object.assign(state, switches);
}
export const bindingUpdateStats = (renderer: object): Readonly<State> | undefined => states.get(renderer);

/** Three r185's `AttributeType.STORAGE` and `INDIRECT` (not exported). */
const STORAGE = 3, INDIRECT = 4;
const OBJECT = NodeUpdateType.OBJECT;

/** What can move a texture binding's answer: its node taking another texture (`TextureNode.value`), its texture taking a new version
 * (`Texture.needsUpdate`, the only writer of `version`) and its texture's records dropped (a disposal resets and releases the bindings
 * that use it). A group plan watches the nodes and textures it skips; a watched one that moves is volatile from then on and ends every
 * plan (`epoch`). */
const watched = new WeakSet<object>(), volatile = new WeakSet<object>();
let epoch = 0, hooked = false;
function moved(object: object): void {
  if (!watched.has(object)) return;
  watched.delete(object); volatile.add(object); epoch++;
}
function watchChanges(): void {
  if (hooked) return;
  hooked = true;
  const needsUpdate = Object.getOwnPropertyDescriptor(ThreeTexture.prototype, 'needsUpdate')!;
  Object.defineProperty(ThreeTexture.prototype, 'needsUpdate', { ...needsUpdate, set(this: ThreeTexture, value: boolean) {
    if (value === true) moved(this);
    needsUpdate.set!.call(this, value);
  } });
  const value = Object.getOwnPropertyDescriptor(ThreeTextureNode.prototype, 'value')!;
  Object.defineProperty(ThreeTextureNode.prototype, 'value', { ...value, set(this: ThreeTextureNode, texture: unknown) {
    if (texture !== value.get!.call(this)) moved(this);
    value.set!.call(this, texture);
  } });
}

/** Per object group, as of `epoch`: per binding, 1 to skip (a texture or sampler whose node and texture are watched and whose binding was
 * up to date), 2 for one that may be skipped once up to date, 0 to visit. */
const PLAN = Symbol('bindingUpdates');
type Plan = { list: Binding[]; epoch: number; flags: Uint8Array };
const SKIP = 1, CANDIDATE = 2;
/** A texture or sampler binding that three's `update()` would find unchanged: the texture its node holds, at the version it last saw. */
const current = (binding: Binding) => binding.texture !== null && binding.texture === binding.textureNode!.value && binding.version === binding.texture.version;
/** A texture or sampler binding whose visit does nothing else when its texture has not moved (a storage texture updating its mipmaps
 * does), on a texture node whose value only the watched setter writes (not one that reads another node's value) and a texture whose
 * version only `needsUpdate` moves. */
function eligible(binding: Binding): boolean {
  const node = binding.textureNode, texture = binding.texture;
  return binding.isSampler === true && node instanceof ThreeTextureNode && !node.referenceNode && !Object.prototype.hasOwnProperty.call(node, 'value') &&
    texture instanceof ThreeTexture && !Object.prototype.hasOwnProperty.call(texture, 'needsUpdate') && !(texture.isStorageTexture === true && texture.mipmapsAutoUpdate === true);
}
function flagOf(binding: Binding): number {
  if (!eligible(binding)) return 0;
  const node = binding.textureNode!, texture = binding.texture!;
  if (volatile.has(node) || volatile.has(texture)) return 0;
  if (!current(binding)) return CANDIDATE;
  watched.add(node); watched.add(texture);
  return SKIP;
}

/** The key three r185's WebGPU backend gives a sampler binding's sampler (`WebGPUTextureUtils.updateSampler`), from its texture's settings
 * and its node's comparison, as of the binding's last key. */
const SAMPLER = Symbol('samplerKey');
type SamplerMemo = { key: unknown; minFilter: number; magFilter: number; wrapS: number; wrapT: number; wrapR: unknown; anisotropy: number; depth: boolean; compare: unknown };
/** `Textures.updateSampler` for a binding whose texture moved, unless the new texture's settings give the key the binding holds: then the
 * backend would find that key's sampler, which the binding holds (so its cache keeps it), and change nothing. */
function samplerKeyOf(textures: Bindings['textures'], binding: Binding): unknown {
  const t = binding.texture!, memo = binding[SAMPLER];
  const compare = t.compareFunction !== null && binding.textureNode!.compareNode !== null ? t.compareFunction : 0;
  if (memo !== undefined && memo.key === binding.samplerKey && memo.minFilter === t.minFilter && memo.magFilter === t.magFilter && memo.wrapS === t.wrapS &&
    memo.wrapT === t.wrapT && memo.wrapR === (t.wrapR || '0') && memo.anisotropy === t.anisotropy && memo.depth === (t.isDepthTexture === true) && memo.compare === compare) return memo.key;
  const key = textures.updateSampler(binding);
  binding[SAMPLER] = { key, minFilter: t.minFilter, magFilter: t.magFilter, wrapS: t.wrapS, wrapT: t.wrapT, wrapR: t.wrapR || '0', anisotropy: t.anisotropy, depth: t.isDepthTexture === true, compare };
  return key;
}

/** Three r185's `Bindings._update` for an object group (whose bindings three updates at every draw, `NodeManager.updateGroup` answering
 * true without a lookup), with the same effects in the same order, but:
 * - `lookups`: a sampled texture that has not moved (its binding's `update()` false) does not look up its `Textures` and backend records.
 *   Three reads them only to fold each texture's id and version into the key of a rebuilt bind group; that key is computed here from the
 *   same records, in the same order, when the group is rebuilt.
 * - `stable`: a texture or sampler binding that its group's plan marks is not visited while no watched node or texture has moved (the
 *   plan's `epoch`): its `update()` would answer false and its visit do nothing else.
 * - `swaps` (a field ping-ponged between frames moves every binding that samples it, every frame): a texture already uploaded at its
 *   version is not handed to `Textures.updateTexture`, which would return at once, and a sampler keeps its key (`samplerKeyOf`). */
function updateObjectGroup(this: Bindings, bindGroup: BindGroup, bindings: BindGroup[], state: State): void {
  const { backend } = this, list = bindGroup.bindings, stats = state.stats;
  let plan = bindGroup[PLAN];
  const start = epoch, planned = state.stable && plan !== undefined && plan.list === list && plan.flags.length === list.length && plan.epoch === start;
  const flags = planned ? plan!.flags : undefined;
  let needsBindingsUpdate = false;
  for (let i = 0; i < list.length; i++) {
    const binding = list[i];
    if (flags !== undefined && flags[i] === SKIP && epoch === start) {
      stats.skipped++;
      if (state.audit) { stats.audited++; if (!current(binding)) stats.violations++; }
      continue;
    }
    stats.visited++;
    if (binding.isStorageBuffer) {
      const attribute = binding.attribute;
      const attributeType = attribute.isIndirectStorageBufferAttribute ? INDIRECT : STORAGE;
      const bindingData = backend.get(binding);
      this.attributes.update(attribute, attributeType);
      if (bindingData.attribute !== attribute) { bindingData.attribute = attribute; needsBindingsUpdate = true; }
    }
    if (binding.isUniformBuffer) {
      const updated = binding.update();
      if (updated) backend.updateBinding(binding);
    } else if (binding.isSampledTexture) {
      const updated = binding.update();
      const texture = binding.texture!;
      if (updated) {
        const texturesTextureData = this.textures.get(texture);
        // Three's `updateTexture` returns at once for an initialized texture at the version it holds.
        if (!state.swaps || texturesTextureData.initialized !== true || texturesTextureData.version !== texture.version) this.textures.updateTexture(texture);
        if (binding.generation !== texturesTextureData.generation) { binding.generation = texturesTextureData.generation; needsBindingsUpdate = true; }
        texturesTextureData.bindGroups.add(bindGroup);
      } else if (!state.lookups) { this.textures.get(texture); backend.get(texture); }
      if (texture.isStorageTexture === true && texture.mipmapsAutoUpdate === true) {
        const textureData = this.get(texture);
        if (binding.store === true) textureData.needsMipmap = true;
        else if (this.textures.needsMipmaps(texture) && textureData.needsMipmap === true) { this.backend.generateMipmaps(texture); textureData.needsMipmap = false; }
      }
    } else if (binding.isSampler) {
      const updated = binding.update();
      if (updated) {
        const samplerKey = state.swaps ? samplerKeyOf(this.textures, binding) : this.textures.updateSampler(binding);
        if (binding.samplerKey !== samplerKey) { binding.samplerKey = samplerKey; needsBindingsUpdate = true; }
      }
    }
    if (binding.isBuffer && binding.updateRanges.length > 0) binding.clearUpdateRanges();
    // A binding that may be skipped once up to date: from its next draw on, while the plan stands.
    if (flags !== undefined && flags[i] === CANDIDATE && epoch === start) flags[i] = flagOf(binding);
  }
  if (needsBindingsUpdate === true) {
    // Three's key: every sampled texture of the group, in order, as its records stand after the loop (a texture's records change only in
    // its own `updateTexture`, earlier in the loop).
    let cacheBindings = true, cacheIndex = 0, version = 0;
    for (let i = 0; i < list.length; i++) {
      const binding = list[i];
      if (!binding.isSampledTexture) continue;
      const texture = binding.texture!, texturesTextureData = this.textures.get(texture), textureData = backend.get(texture);
      if (textureData.externalTexture !== undefined || texturesTextureData.isDefaultTexture) cacheBindings = false;
      else { cacheIndex = cacheIndex * 10 + texture.id; version += texture.version; }
    }
    stats.deferred++;
    this.backend.updateBindings(bindGroup, bindings, cacheBindings ? cacheIndex : 0, version);
  }
  // A new plan after a visit of every binding, when nothing moved during it.
  if (state.stable && !planned && epoch === start) {
    if (plan === undefined || plan.flags.length !== list.length) bindGroup[PLAN] = plan = { list, epoch, flags: new Uint8Array(list.length) };
    plan.list = list; plan.epoch = epoch;
    for (let i = 0; i < list.length; i++) plan.flags[i] = flagOf(list[i]);
    stats.plans++;
  }
}

/** Adapter for pinned three r185's `Bindings._update`, which visits every binding of every bind group of every draw. In a 30-ship battle
 * that is ~4,000 texture and sampler visits a frame in object groups: a ship's paint alone samples ~19 textures (shadow maps, the
 * environment and sky tables, the sea and wake fields, the plating details) with their samplers at every draw, most of them the same
 * texture at the same version frame after frame. Each visit reads the binding, its node and its texture, and a sampled texture looks up
 * two records three uses only when the group is rebuilt. Object groups take `updateObjectGroup`; every other group three's own. */
export function installBindingUpdates(value: object): void {
  const bindings = (value as { _bindings?: Bindings })._bindings;
  if (REVISION !== '185' || !bindings?._update || !bindings.textures?.delete || !bindings.backend?.delete || states.has(value)) return;
  const state: State = { lookups: true, stable: true, swaps: true, audit: false, stats: { deferred: 0, visited: 0, skipped: 0, plans: 0, audited: 0, violations: 0 } };
  states.set(value, state);
  watchChanges();
  const three = bindings._update;
  // A bind group's bindings share one group node (three builds a group per node).
  bindings._update = function (bindGroup, groups) {
    const first = bindGroup.bindings[0];
    return (state.lookups || state.stable || state.swaps) && first !== undefined && first.groupNode.updateType === OBJECT
      ? updateObjectGroup.call(this, bindGroup, groups, state) : three.call(this, bindGroup, groups);
  };
  // A texture's records dropped (its disposal, which resets and releases its bindings) or every record dropped ends every plan.
  for (const store of [bindings.textures, bindings.backend] as Store[]) {
    const remove = store.delete, dispose = store.dispose;
    store.delete = function (object: object) { if ((object as { isTexture?: boolean }).isTexture) epoch++; return remove.call(this, object); };
    if (dispose) store.dispose = function () { epoch++; return dispose.call(this); };
  }
}
