import { expect, test } from 'bun:test';
import ThreeBackend from 'three/src/renderers/common/Backend.js';
import Info from 'three/src/renderers/common/Info.js';
// The game's texture and node classes (three/webgpu's build), whose changes the adapter watches.
import { DataTexture, StorageTexture, TextureNode, UniformGroupNode } from 'three/webgpu';
// Three r185's own node manager, bindings, textures and binding classes: the reference every update here must match call for call.
// @ts-expect-error Three does not publish declarations for its renderer internals.
import NodeManager from 'three/src/renderers/common/nodes/NodeManager.js';
// @ts-expect-error Nor for its bindings.
import Bindings from 'three/src/renderers/common/Bindings.js';
// @ts-expect-error Nor for its textures.
import Textures from 'three/src/renderers/common/Textures.js';
// @ts-expect-error Nor for its bind groups.
import BindGroup from 'three/src/renderers/common/BindGroup.js';
// @ts-expect-error Nor for its node bindings.
import { NodeSampledTexture } from 'three/src/renderers/common/nodes/NodeSampledTexture.js';
// @ts-expect-error Nor for its node samplers.
import NodeSampler from 'three/src/renderers/common/nodes/NodeSampler.js';
import { bindingUpdateStats, installBindingUpdates, setBindingUpdates } from './BindingUpdates';

/** A seeded generator, so a failure repeats. */
function random(seed: number) { return () => ((seed = Math.imul(seed ^ (seed >>> 15), 2246822519) + 0x6d2b79f5 >>> 0) / 2 ** 32); }

type Texture = DataTexture | StorageTexture;
type Binding = Record<string, unknown> & { name: string; texture?: Texture | null; generation?: unknown; version?: number; samplerKey?: unknown };
type Group = { name: string; bindings: Binding[] };
type Store = { get(object: object): Record<string, unknown>; has(object: object): boolean; delete(object: object): void };
// Three's base backend, as the adapter sees it (its typings leave the data map out).
const Backend = ThreeBackend as unknown as new (parameters: object) => Store;

/** The GPU side three calls, as a log. A texture's backend record is dropped when it is destroyed, as WebGPU's texture utils do. */
class TestBackend extends Backend {
  constructor(readonly log: string[]) { super({}); }
  createTexture(t: Texture, o: { width: number; height: number; levels: number }) { this.log.push(`createTexture ${t.id} ${o.width}x${o.height} ${o.levels}`); this.get(t).texture = t.id; }
  updateTexture(t: Texture) { this.log.push(`updateTexture ${t.id} ${t.version}`); }
  createDefaultTexture(t: Texture) { this.log.push(`createDefaultTexture ${t.id}`); this.get(t).texture = 'default'; }
  destroyTexture(t: Texture) { this.log.push(`destroyTexture ${t.id}`); this.delete(t); }
  generateMipmaps(t: Texture) { this.log.push(`generateMipmaps ${t.id}`); }
  /** As WebGPU's: a sampler per key, and nothing done for a binding that already holds its key's sampler. */
  updateSampler(b: Binding) {
    const key = `${b.texture!.minFilter}:${b.texture!.magFilter}`, record = this.get(b);
    if (record.samplerKey !== key) { this.log.push(`updateSampler ${b.name} ${key}`); record.samplerKey = key; }
    return key;
  }
  destroySampler(b: Binding) { this.log.push(`destroySampler ${b.name}`); }
  createUniformBuffer(b: Binding) { this.log.push(`createUniformBuffer ${b.name}`); }
  destroyUniformBuffer(b: Binding) { this.log.push(`destroyUniformBuffer ${b.name}`); }
  updateBinding(b: Binding) { this.log.push(`updateBinding ${b.name}`); }
  createBindings(g: Group, _: Group[], cacheIndex: number) { this.log.push(`createBindings ${g.name} ${cacheIndex}`); }
  updateBindings(g: Group, _: Group[], cacheIndex: number, version: number) { this.log.push(`updateBindings ${g.name} ${cacheIndex} ${version}`); }
  deleteBindGroupData(g: Group) { this.log.push(`deleteBindGroupData ${g.name}`); }
}

/** Shared by both worlds, as a renderer's scene is: the textures, and the texture nodes whose values the run swaps. */
function sharedScene() {
  const texture = (name: string, w: number) => { const t = new DataTexture(new Uint8Array(w * w * 4), w, w); t.name = name; return t; };
  const plate = texture('plate', 4), fieldA = texture('fieldA', 8), fieldB = texture('fieldB', 8), sky = texture('sky', 2), deck = texture('deck', 2);
  // Not yet uploadable (version 0): three backs it with a default texture, which keeps a rebuilt group's key out of its cache.
  const pending = new DataTexture(null, 2, 2); pending.name = 'pending';
  const storage = new StorageTexture(4, 4); storage.name = 'storage'; storage.generateMipmaps = true;
  const own = Array.from({ length: 6 }, (_, i) => texture(`own${i}`, 2));
  const nodes = { plate: new TextureNode(plate), field: new TextureNode(fieldA), sky: new TextureNode(sky), deck: new TextureNode(deck), pending: new TextureNode(pending),
    storage: new TextureNode(storage), own: own.map(t => new TextureNode(t)) };
  return { plate, fieldA, fieldB, sky, deck, pending, storage, own, nodes, textures: [plate, fieldA, fieldB, sky, deck, pending, storage, ...own] as Texture[] };
}

/** One renderer's worth of three r185 bindings state over the shared scene: a render group (uniforms, compared once per render) and six
 * render objects' object groups of uniform buffers, a uniform array, storage, sampled textures (one written as storage) and samplers.
 * `patched` installs this branch's adapter. Everything three does is logged. */
function world(scene: ReturnType<typeof sharedScene>, patched: boolean) {
  const log: string[] = [];
  const backend = new TestBackend(log), info = new Info(), renderer = { backend };
  const nodes = new NodeManager(renderer, backend), textures = new Textures(renderer, backend, info);
  const attributes = { update: (a: { name: string }, type: number) => log.push(`attribute ${a.name} ${type}`) };
  const bindings = new Bindings(backend, nodes, textures, attributes, {}, info);
  const target = { _bindings: bindings };
  if (patched) installBindingUpdates(target);
  const count = new Map<string, number>();
  const script = (label: string) => { const n = (count.get(label) ?? 0) + 1; count.set(label, n); return n; };
  const renderGroup = new UniformGroupNode('render', true, 0, 'render'), objectGroup = new UniformGroupNode('object', false, 1, 'object');
  const ubo = (name: string, groupNode: UniformGroupNode, array = false): Binding => ({ name, groupNode, isUniformBuffer: true, isBuffer: true, isUniformsGroup: !array, updateRanges: [] as unknown[],
    update() { const n = script(name); if (array && n % 3 === 0) (this.updateRanges as unknown[]).push({ start: 0, count: 4 }); return array || n % 4 !== 1; },
    clearUpdateRanges() { (this.updateRanges as unknown[]).length = 0; }, release() {} });
  const storageBuffer = (name: string): Binding => ({ name, groupNode: objectGroup, isStorageBuffer: true, isBuffer: true, attribute: { name: `${name}.attribute` }, updateRanges: [],
    update: () => true, clearUpdateRanges() {}, release() {} });
  const sampled = (name: string, node: TextureNode, store = false) => { const b = new NodeSampledTexture(name, node, objectGroup); b.store = store; return b as Binding; };
  const sampler = (name: string, node: TextureNode) => new NodeSampler(name, node, objectGroup) as Binding;
  const renderGroups = [new BindGroup('render', [ubo('render.ubo', renderGroup), ubo('render.array', renderGroup, true)]) as Group];
  const groups = scene.own.map((_, r) => {
    const name = `ro${r}`, list = [ubo(`${name}.ubo`, objectGroup), sampled(`${name}.plate`, scene.nodes.plate), sampler(`${name}.plateSampler`, scene.nodes.plate),
      sampled(`${name}.field`, scene.nodes.field), sampler(`${name}.fieldSampler`, scene.nodes.field), sampled(`${name}.own`, scene.nodes.own[r]),
      sampler(`${name}.ownSampler`, scene.nodes.own[r]), ubo(`${name}.array`, objectGroup, true), sampled(`${name}.sky`, scene.nodes.sky), sampler(`${name}.skySampler`, scene.nodes.sky),
      sampled(`${name}.deck`, scene.nodes.deck), sampler(`${name}.deckSampler`, scene.nodes.deck)];
    if (r % 2) list.push(sampled(`${name}.storage`, scene.nodes.storage, r % 4 === 1), storageBuffer(`${name}.storageBuffer`));
    if (r === 3) list.push(sampled(`${name}.pending`, scene.nodes.pending));
    return [renderGroups[0], new BindGroup(`object${r}`, list) as Group];
  });
  const renderObjects = groups.map(list => ({ getBindings: () => list }));
  // Three's order: the render group's node moves once per render, then each draw updates the object's groups.
  const render = (order: number[]) => { renderGroup.needsUpdate = true; for (const r of order) bindings.updateForRender(renderObjects[r]); };
  const records = () => scene.textures.map(t => [t.name, textures.has(t), backend.has(t)]);
  const state = () => groups.flatMap(list => list[1].bindings).map(b => [b.name, b.generation, b.version, b.samplerKey, b.texture?.id ?? null]);
  return { log, target, render, records, state };
}

/** The scene changes between renders, once for both worlds: busy stretches move the swapped field and the objects' own textures most
 * renders; quiet ones only set things to what they are. The textures every object samples move once each: the sky's version, the
 * plating's node, and the deck's disposal (which resets and releases the bindings that use it, and nothing else). */
function events(scene: ReturnType<typeof sharedScene>, next: () => number, frame: number) {
  const busy = Math.floor(frame / 100) % 2 === 0, roll = next() * (busy ? 1 : 4);
  const own = () => [...scene.own, scene.fieldA, scene.fieldB, scene.pending][Math.floor(next() * 9)];
  if (frame === 300) scene.sky.needsUpdate = true;
  if (frame === 600) { scene.nodes.plate.value = scene.own[0]; scene.nodes.plate.value = scene.plate; }
  if (frame === 550) scene.deck.dispose();
  if (roll < .3) scene.nodes.field.value = scene.nodes.field.value === scene.fieldA ? scene.fieldB : scene.fieldA;
  else if (roll < .38) own().needsUpdate = true;
  else if (roll < .42) scene.own[Math.floor(next() * 6)].magFilter = next() < .5 ? 1003 : 1006;
  else if (roll < .45) own().dispose();
  else if (roll < .47) { scene.pending.image = { data: new Uint8Array(16), width: 2, height: 2 } as never; scene.pending.needsUpdate = true; }
  // A node taking a texture it has never held, and back.
  else if (roll < .5) { const node = scene.nodes.own[Math.floor(next() * 6)], was = node.value; node.value = scene.sky; if (next() < .5) node.value = was; }
  // Sets that change nothing: the same texture again, and a texture's needsUpdate false.
  else if (roll < .8) { scene.nodes.plate.value = scene.plate; scene.nodes.sky.value = scene.sky; scene.plate.needsUpdate = false; scene.sky.needsUpdate = false; }
}

test('object groups update exactly as three r185 does, call for call, through swaps, versions, sampler settings, pending uploads and disposals', () => {
  const scene = sharedScene(), three = world(scene, false), ours = world(scene, true);
  const next = random(5);
  let deferredBefore = 0;
  for (let frame = 0; frame < 1500; frame++) {
    // Every mix of the switches, changed now and then, must stay exact; the audit checks each skipped visit as it is skipped.
    if (frame % 53 === 7) setBindingUpdates(ours.target, { lookups: next() < .8, stable: next() < .8, audit: next() < .5 });
    const order = Array.from({ length: 3 + Math.floor(next() * 8) }, () => Math.floor(next() * 6));
    events(scene, next, frame);
    three.render(order); ours.render(order);
    expect(ours.records()).toEqual(three.records());
    if (frame === 700) deferredBefore = bindingUpdateStats(ours.target)!.stats.deferred;
  }
  expect(ours.log.length).toBeGreaterThan(20000);
  expect(ours.log).toEqual(three.log);
  expect(ours.state()).toEqual(three.state());
  const { stats } = bindingUpdateStats(ours.target)!;
  // Rebuilt groups took their key from the deferred records; quiet stretches skipped visits; the audit found every skip exact.
  expect(stats.deferred).toBeGreaterThan(deferredBefore);
  expect(three.log.filter(line => line.startsWith('updateBindings')).length).toBeGreaterThan(200);
  expect(stats.skipped).toBeGreaterThan(5000);
  expect(stats.audited).toBeGreaterThan(1000);
  expect(stats.violations).toBe(0);
});

test('the adapter installs once, only on three r185 bindings, and switches off to three\'s own update', () => {
  const scene = sharedScene(), w = world(scene, true);
  const bindings = (w.target as unknown as { _bindings: Record<string, unknown> })._bindings;
  const replaced = bindings._update;
  installBindingUpdates(w.target);
  expect(bindings._update).toBe(replaced);
  const bare = { _bindings: {} };
  installBindingUpdates(bare);
  expect(bindingUpdateStats(bare)).toBeUndefined();
  setBindingUpdates(w.target, { lookups: false, stable: false });
  expect(bindingUpdateStats(w.target)).toMatchObject({ lookups: false, stable: false });
});
