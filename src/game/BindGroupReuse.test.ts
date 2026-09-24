import { expect, test } from 'bun:test';
import { KEPT_BIND_GROUPS, bindGroupReuseStats, installBindGroupReuse, setBindGroupReuseEnabled } from './BindGroupReuse';

type Binding = { isUniformBuffer?: boolean; isSampledTexture?: boolean; isSampler?: boolean; isStorageBuffer?: boolean; texture?: object; attribute?: object; store?: boolean; mipLevel?: number };
type Data = { buffer?: object; texture?: { view: object }; externalTexture?: object; sampler?: object; group?: object; layout?: object };

/** Three r185's binding path in miniature: backend data per object, a cached layout per bind group, and a descriptor built from
 * the current buffers, views and samplers (a view per GPU texture and base level) that a new GPU bind group records. */
function fakeBackend() {
  const data = new Map<object, Data>(), groups: { resources: object[] }[] = [];
  const get = (object: object) => { let entry = data.get(object); if (!entry) data.set(object, entry = {}); return entry; };
  const bindingUtils = {
    createBindingsLayout(bindGroup: object) { return get(bindGroup).layout ??= {}; },
    createBindings(bindGroup: { bindings: Binding[] }) {
      this.createBindingsLayout(bindGroup);
      const resources = bindGroup.bindings.map(binding => binding.isUniformBuffer ? get(binding).buffer! : binding.isStorageBuffer ? get(binding.attribute!).buffer!
        : binding.isSampledTexture ? get(binding.texture!).externalTexture ?? get(binding.texture!).texture!.view : get(binding).sampler!);
      const group = { resources }; groups.push(group); get(bindGroup).group = group;
    },
  };
  return { backend: { get, bindingUtils }, data, groups, get };
}

test('a rebind to resources bound before binds the group built for them', () => {
  const { backend, groups, get } = fakeBackend();
  installBindGroupReuse(backend); installBindGroupReuse(backend);
  const uniforms: Binding = { isUniformBuffer: true }, field: Binding = { isSampledTexture: true, texture: {} }, sampler: Binding = { isSampler: true };
  get(uniforms).buffer = {}; get(sampler).sampler = {};
  const even = {}, odd = {};
  get(even).texture = { view: {} }; get(odd).texture = { view: {} };
  const bindGroup = { bindings: [uniforms, field, sampler] };
  const bind = (texture: object) => { field.texture = texture; backend.bindingUtils.createBindings(bindGroup); return get(bindGroup).group; };
  const first = bind(even), second = bind(odd);
  expect(first).not.toBe(second);
  for (let frame = 0; frame < 6; frame++) expect(bind(frame % 2 ? odd : even)).toBe(frame % 2 ? second : first);
  expect(groups).toHaveLength(2);
  expect(bindGroupReuseStats(backend)).toEqual({ enabled: true, built: 2, reused: 6 });
  // The group bound is always the one three would build now: same buffer, view and sampler.
  expect((get(bindGroup).group as { resources: object[] }).resources).toEqual([get(uniforms).buffer!, get(odd).texture!.view, get(sampler).sampler!]);
});

test('any other buffer, sampler, GPU texture, level or layout builds a new group, and external textures are never kept', () => {
  const { backend, groups, get } = fakeBackend();
  installBindGroupReuse(backend);
  const uniforms: Binding = { isUniformBuffer: true }, storage: Binding = { isStorageBuffer: true, attribute: {} }, texture = {};
  const field: Binding = { isSampledTexture: true, texture }, sampler: Binding = { isSampler: true };
  get(uniforms).buffer = {}; get(storage.attribute!).buffer = {}; get(texture).texture = { view: {} }; get(sampler).sampler = {};
  const bindGroup = { bindings: [uniforms, storage, field, sampler] }, bind = () => backend.bindingUtils.createBindings(bindGroup);
  bind(); bind(); expect(groups).toHaveLength(1);
  get(uniforms).buffer = {}; bind(); expect(groups).toHaveLength(2);
  storage.attribute = {}; get(storage.attribute).buffer = {}; bind(); expect(groups).toHaveLength(3);
  get(sampler).sampler = {}; bind(); expect(groups).toHaveLength(4);
  get(texture).texture = { view: {} }; bind(); expect(groups).toHaveLength(5); // a recreated (resized) texture
  field.store = true; field.mipLevel = 1; bind(); expect(groups).toHaveLength(6);
  get(bindGroup).layout = {}; bind(); expect(groups).toHaveLength(7);
  bind(); expect(groups).toHaveLength(7);
  get(texture).externalTexture = {}; bind(); bind(); expect(groups).toHaveLength(9);
  // Another bind group with the same resources keeps its own groups.
  delete get(texture).externalTexture;
  backend.bindingUtils.createBindings({ bindings: bindGroup.bindings }); expect(groups).toHaveLength(10);
});

test('only the most recent groups are kept, and the switch leaves every build to three', () => {
  const { backend, groups, get } = fakeBackend();
  installBindGroupReuse(backend);
  const field: Binding = { isSampledTexture: true }, bindGroup = { bindings: [field] };
  const textures = Array.from({ length: KEPT_BIND_GROUPS + 1 }, () => { const texture = {}; get(texture).texture = { view: {} }; return texture; });
  const bind = (texture: object) => { field.texture = texture; backend.bindingUtils.createBindings(bindGroup); };
  textures.forEach(bind); bind(textures[KEPT_BIND_GROUPS]);
  expect(groups).toHaveLength(KEPT_BIND_GROUPS + 1);
  bind(textures[0]); expect(groups).toHaveLength(KEPT_BIND_GROUPS + 2);
  setBindGroupReuseEnabled(backend, false);
  bind(textures[0]); expect(groups).toHaveLength(KEPT_BIND_GROUPS + 3);
});
