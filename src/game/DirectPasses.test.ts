import { expect, test } from 'bun:test';
import { Group, NodeMaterial, QuadMesh, RenderTarget, type Camera, type Mesh, type Texture, type WebGPURenderer } from 'three/webgpu';
import { DirectPasses, type PassRenderObject } from './DirectPasses';

type Call = [string, ...unknown[]];

/** Three r185's renderer in miniature, as far as a pass reaches it: `render` draws each mesh through `backend.draw` with a render object
 * per mesh, target and material version (as three's render object cache keys it), running three's per-draw updates; `compute` runs
 * through `backend.beginCompute`/`finishCompute` as three's does. Everything records its calls; the device records what is encoded. */
function fakeRenderer() {
  const calls: Call[] = [], data = new Map<object, Record<string, unknown>>(), objects = new Map<string, PassRenderObject>(), alive = new Set<object>();
  const get = (o: object) => { let entry = data.get(o); if (!entry) data.set(o, entry = {}); return entry; };
  let encoders = 0;
  const device = {
    createCommandEncoder: () => {
      const id = ++encoders;
      return {
        id,
        beginRenderPass: (descriptor: { colorAttachments: { view: unknown; loadOp: string; clearValue?: object }[] }) => {
          calls.push(['begin', id, descriptor.colorAttachments.map(a => [a.view, a.loadOp, { ...a.clearValue }])]);
          return {
            setPipeline: (p: unknown) => calls.push(['pipeline', p]), setBindGroup: (i: number, g: unknown) => calls.push(['group', i, g]),
            setVertexBuffer: (i: number, b: unknown) => calls.push(['vertex', i, b]), setIndexBuffer: (b: unknown, f: string) => calls.push(['index', b, f]),
            setViewport: (...v: number[]) => calls.push(['viewport', ...v]), draw: (...v: number[]) => calls.push(['draw', ...v]),
            drawIndexed: (...v: number[]) => calls.push(['drawIndexed', ...v]), executeBundles: (b: unknown[]) => calls.push(['bundles', ...b]), end: () => calls.push(['end']),
          };
        },
        beginComputePass: () => { calls.push(['begin compute', id]); return { dispatch: (node: object) => calls.push(['dispatch', node, id]), end: () => calls.push(['end compute', id]) }; },
        copyTextureToBuffer: (source: { texture: object }, destination: { buffer: object; bytesPerRow: number }, size: object) =>
          calls.push(['copy', id, source.texture, destination.buffer, destination.bytesPerRow, size]),
        finish: () => ({ encoder: id }),
      };
    },
    queue: { submit: (buffers: { encoder: number }[]) => calls.push(['submit', ...buffers.map(b => b.encoder)]) },
    createShaderModule: (d: { code: string }) => ({ code: d.code }),
    createRenderPipeline: (d: { fragment: { targets: object[] } }) => ({ targets: d.fragment.targets.length, getBindGroupLayout: () => ({ layout: true }) }),
    createSampler: (d: object) => ({ sampler: d }),
    createBindGroup: (d: { entries: object[] }) => ({ entries: d.entries }),
    createRenderBundleEncoder: (d: { colorFormats: string[] }) => {
      const bundle: Call[] = [['formats', ...d.colorFormats]];
      return { setPipeline: () => {}, setBindGroup: () => {}, draw: (...v: number[]) => bundle.push(['draw', ...v]), finish: () => bundle };
    },
  };
  const info = { calls: 0, render: { calls: 0, frameCalls: 0, drawCalls: 0 }, update(_o: object, count: number) { this.render.drawCalls++; calls.push(['info', count]); } };
  const nodeFrame = { renderId: 0 };
  let target: RenderTarget | null = null, layer = 0;
  const renderObject = (mesh: Mesh): PassRenderObject => {
    const material = mesh.material as NodeMaterial, key = `${mesh.id}:${target!.texture.uuid}:${material.uuid}:${material.version}`;
    let ro = objects.get(key);
    // A disposed render object leaves three's cache: the next render builds another.
    if (!ro || !alive.has(ro)) {
      const bindings = [{ name: 'object' }, { name: 'render' }], vertex = [{ name: 'position' }], pipeline = { name: `pipeline ${key}` };
      ro = { object: mesh, material, version: material.version, pipeline, drawRange: null, group: null, getBindings: () => bindings, getVertexBuffers: () => vertex,
        getIndex: () => null, getDrawParameters: () => ({ vertexCount: 3, firstVertex: 0, instanceCount: 1 }),
        getNodeBuilderState: () => ({ updateBeforeNodes: renderer.updateBefore, updateAfterNodes: [] }) } as unknown as PassRenderObject;
      objects.set(key, ro); alive.add(ro);
      get(pipeline).pipeline = { gpu: `pipeline ${key}` };
      bindings.forEach((b, i) => { get(b).group = { gpu: `group ${i} ${key}` }; });
      get(vertex[0]).buffer = { gpu: 'quad vertices' };
    }
    return ro;
  };
  const refresh = (ro: PassRenderObject) => calls.push(['update', ro, nodeFrame.renderId, renderer.values.layer]);
  const renderer = {
    values: { layer: 0 },
    updateBefore: [] as unknown[],
    backend: {
      device, trackTimestamp: false, get,
      draw(ro: PassRenderObject) { calls.push(['three draw', ro]); },
      beginCompute(group: object) {
        const encoder = device.createCommandEncoder(), data = get(group);
        data.cmdEncoderGPU = encoder; data.passEncoderGPU = encoder.beginComputePass();
      },
      finishCompute(group: object) {
        const data = get(group) as { passEncoderGPU: { end(): void }; cmdEncoderGPU: { finish(): { encoder: number } } };
        data.passEncoderGPU.end(); device.queue.submit([data.cmdEncoderGPU.finish()]);
      },
      textureUtils: { generateMipmaps: (texture: object, encoder: { id: number }) => calls.push(['mipmaps', texture, encoder.id]) },
    },
    _nodes: {
      nodeFrame, needsRefresh: () => true, updateBefore: () => {}, updateAfter: () => {},
      updateForRender: (ro: PassRenderObject) => refresh(ro),
    },
    _geometries: { updateForRender: () => {} },
    _bindings: { updateForRender: () => {} },
    _pipelines: { has: (ro: object) => alive.has(ro), updateForRender: () => {}, isReady: () => true },
    _isDeviceLost: false,
    _clearColor: { r: .5, g: .25, b: 1, a: .5 },
    info, contextNode: { id: 7, version: 1 }, lighting: { enabled: true }, shadowMap: { enabled: true, type: 2 },
    autoClear: true, autoClearColor: true, alpha: true, mrt: null as unknown,
    getMRT() { return this.mrt; }, getScissorTest: () => false, getActiveCubeFace: () => layer,
    setRenderTarget(t: RenderTarget | null, face = 0) { target = t; layer = face; },
    getRenderTarget: () => target,
    render(mesh: Mesh, camera: Camera) {
      info.calls++; const previous = nodeFrame.renderId; nodeFrame.renderId = info.calls;
      const ro = renderObject(mesh);
      refresh(ro);
      calls.push(['three render', mesh, target, layer, camera]);
      this.backend.draw(ro);
      nodeFrame.renderId = previous;
      calls.push(['submit three']);
      for (const texture of target!.textures) if (texture.generateMipmaps) calls.push(['mipmaps three', texture]);
    },
    compute(nodes: object | object[]) {
      info.calls++;
      this.backend.beginCompute(nodes);
      for (const node of Array.isArray(nodes) ? nodes : [nodes]) (get(nodes).passEncoderGPU as { dispatch(node: object): void }).dispatch(node);
      this.backend.finishCompute(nodes);
    },
  };
  return { renderer, calls, data, alive, gpu: (texture: object) => get(texture) };
}

/** GPU copies of a target's textures: views name the texture, and the size, levels and format are the target's. */
const textureOf = (fake: ReturnType<typeof fakeRenderer>, target: RenderTarget, levels = 1, format = 'rgba16float') => target.textures.forEach((t, i) => {
  fake.gpu(t).texture = { width: target.width, height: target.height, depthOrArrayLayers: target.depth, mipLevelCount: levels, format,
    createView: (view: object) => ({ view: `${t.uuid}:${i}`, ...view }) };
});
const quad = () => new QuadMesh(new NodeMaterial());
const kinds = (calls: Call[]) => calls.map(c => c[0]);
const make = (fake: ReturnType<typeof fakeRenderer>) => { const passes = new DirectPasses(fake.renderer as unknown as WebGPURenderer); passes.enabled = true; return passes; };

test('a pass three has drawn once is encoded from its render object, in three\'s order, and submitted', () => {
  const fake = fakeRenderer(), passes = make(fake), target = new RenderTarget(8, 4, { depthBuffer: false }), pass = quad();
  textureOf(fake, target);
  const backendDraw = fake.renderer.backend.draw;
  passes.draw(pass, target);
  expect(kinds(fake.calls)).toEqual(['update', 'three render', 'three draw', 'submit three']);
  // The capture leaves three's draw as it found it.
  expect(fake.renderer.backend.draw).toBe(backendDraw);
  expect(Object.prototype.hasOwnProperty.call(fake.renderer.backend, 'draw')).toBe(true);
  fake.calls.length = 0;
  const renderId = fake.renderer._nodes.nodeFrame.renderId, callsBefore = fake.renderer.info.calls;
  passes.draw(pass, target);
  const ro = fake.calls[0][1] as PassRenderObject, key = `${pass.id}:${target.texture.uuid}:${(pass.material as NodeMaterial).uuid}:0`;
  expect(fake.calls).toEqual([
    // Its own render id, as three's render gives one.
    ['update', ro, callsBefore + 1, 0],
    ['begin', 1, [[{ view: `${target.texture.uuid}:0`, baseMipLevel: 0, mipLevelCount: 1, baseArrayLayer: 0, arrayLayerCount: 1, dimension: '2d' }, 'clear', { r: .25, g: .125, b: .5, a: .5 }]]],
    ['viewport', 0, 0, 8, 4, 0, 1],
    ['pipeline', { gpu: `pipeline ${key}` }], ['group', 0, { gpu: `group 0 ${key}` }], ['group', 1, { gpu: `group 1 ${key}` }], ['vertex', 0, { gpu: 'quad vertices' }],
    ['draw', 3, 1, 0, 0], ['info', 3], ['end'], ['submit', 1],
  ]);
  expect(fake.renderer._nodes.nodeFrame.renderId).toBe(renderId);
  expect(fake.renderer.info.calls).toBe(callsBefore + 1);
  expect(fake.renderer.getRenderTarget()).toBe(target);
  expect(passes.stats).toEqual({ direct: 1, three: 1, captures: 1, computes: 0, readbacks: 0, submits: 1 });
  // A partial viewport is three's too, floored.
  target.viewport.set(0, 1.5, 8, 2.5);
  passes.draw(pass, target);
  expect(fake.calls.find(c => c[0] === 'viewport' && c[2] === 1)).toEqual(['viewport', 0, 1, 8, 2, 0, 1]);
});

test('held passes share one encoder and submit at the outermost end; a render object drawn again submits the passes before it first', () => {
  const fake = fakeRenderer(), passes = make(fake);
  const a = new RenderTarget(4, 4, { depthBuffer: false }), b = new RenderTarget(4, 4, { depthBuffer: false }), first = quad(), second = quad();
  textureOf(fake, a); textureOf(fake, b);
  passes.draw(first, a); passes.draw(second, b);
  fake.calls.length = 0;
  passes.begin(); passes.begin();
  passes.draw(first, a); passes.draw(second, b);
  passes.end();
  expect(kinds(fake.calls).filter(k => k === 'submit')).toEqual([]);
  // The same render object again: its uniform buffer would hold only the last values at the submit.
  fake.renderer.values.layer = 1;
  passes.draw(first, a);
  expect(fake.calls.filter(c => c[0] === 'submit')).toEqual([['submit', 1]]);
  passes.end();
  expect(fake.calls.filter(c => c[0] === 'submit')).toEqual([['submit', 1], ['submit', 2]]);
  expect(fake.calls.filter(c => c[0] === 'begin').map(c => c[1])).toEqual([1, 1, 2]);
  // Unheld, each pass submits at once.
  passes.draw(second, b);
  expect(fake.calls.at(-1)).toEqual(['submit', 3]);
});

test('a layer\'s pass writes that layer; a lone texture\'s mipmaps are three\'s, in the same encoder after the pass', () => {
  const fake = fakeRenderer(), passes = make(fake), pass = quad();
  const target = new RenderTarget(4, 4, { depth: 3, depthBuffer: false });
  textureOf(fake, target, 3);
  for (let layer = 0; layer < 3; layer++) passes.draw(pass, target, layer);
  fake.calls.length = 0;
  passes.begin();
  for (let layer = 0; layer < 3; layer++) {
    target.texture.generateMipmaps = layer === 2;
    passes.draw(pass, target, layer);
  }
  passes.end();
  const begins = fake.calls.filter(c => c[0] === 'begin') as [string, number, [{ baseArrayLayer: number; dimension: string }, string, object][]][];
  expect(begins.map(c => c[2].map(a => [a[0].baseArrayLayer, a[0].dimension]))).toEqual([0, 1, 2].map(l => [[l, '2d-array']]));
  // One render object per target draws every layer here, so each layer is its own submit (a quad per layer avoids that).
  expect(fake.calls.filter(c => c[0] === 'submit')).toEqual([['submit', 1], ['submit', 2], ['submit', 3]]);
  expect(kinds(fake.calls).slice(-3)).toEqual(['end', 'mipmaps', 'submit']);
  expect(fake.calls.filter(c => c[0] === 'mipmaps')).toEqual([['mipmaps', target.texture, 3]]);
});

test('without the automatic clear the attachments load, and a renderer without alpha clears to its colour unmultiplied', () => {
  const fake = fakeRenderer(), passes = make(fake), target = new RenderTarget(4, 4, { count: 2, depthBuffer: false }), pass = quad();
  textureOf(fake, target);
  passes.draw(pass, target);
  fake.calls.length = 0;
  fake.renderer.autoClear = false;
  passes.draw(pass, target);
  fake.renderer.autoClear = true; fake.renderer.alpha = false;
  passes.draw(pass, target);
  const begins = fake.calls.filter(c => c[0] === 'begin').map(c => (c[2] as [unknown, string, object][]).map(a => a[1] === 'load' ? ['load'] : [a[1], a[2]]));
  expect(begins).toEqual([[['load'], ['load']], [['clear', { r: .5, g: .25, b: 1, a: .5 }], ['clear', { r: 0, g: 0, b: 0, a: 1 }]]]);
});

test('a changed material, target texture, render state, MRT or a disposed render object goes back to three, which is drawn from again', () => {
  const fake = fakeRenderer(), passes = make(fake), target = new RenderTarget(4, 4, { depthBuffer: false }), pass = quad();
  textureOf(fake, target);
  const direct = () => { fake.calls.length = 0; passes.draw(pass, target); return !kinds(fake.calls).includes('three render'); };
  expect(direct()).toBe(false);
  expect(direct()).toBe(true);
  const changes: (() => void)[] = [
    () => { (pass.material as NodeMaterial).needsUpdate = true; },
    () => { textureOf(fake, target); },
    () => { target.texture.version++; },
    () => { target.setSize(8, 8); textureOf(fake, target); },
    () => { fake.renderer.contextNode.version++; },
    () => { fake.renderer.shadowMap.type = 3; },
    () => { fake.renderer.mrt = {}; },
    () => { fake.alive.clear(); },
    () => { pass.material = new NodeMaterial(); },
  ];
  for (const change of changes) {
    change();
    expect(direct()).toBe(false);
    expect(direct()).toBe(true);
  }
});

test('off, unsupported targets and meshes, timestamps, updates before a draw and a lost device all stay with three', () => {
  const fake = fakeRenderer(), passes = make(fake), pass = quad();
  const plain = new RenderTarget(4, 4, { depthBuffer: false }), depth = new RenderTarget(4, 4), multisampled = new RenderTarget(4, 4, { depthBuffer: false, samples: 4 });
  [plain, depth, multisampled].forEach(t => textureOf(fake, t));
  const three = (target: RenderTarget, mesh: Mesh = pass) => { fake.calls.length = 0; passes.draw(mesh, target); passes.draw(mesh, target); return kinds(fake.calls).filter(k => k === 'three render').length; };
  passes.enabled = false;
  expect(three(plain)).toBe(2);
  passes.enabled = true;
  expect(three(depth)).toBe(2);
  expect(three(multisampled)).toBe(2);
  const parent = quad(); parent.add(new Group());
  expect(three(plain, parent)).toBe(2);
  fake.renderer.backend.trackTimestamp = true;
  expect(three(plain)).toBe(2);
  fake.renderer.backend.trackTimestamp = false;
  fake.renderer.updateBefore = [{}];
  expect(three(plain, quad())).toBe(2);
  fake.renderer.updateBefore = [];
  expect(three(plain)).toBe(1);
  fake.renderer._isDeviceLost = true;
  fake.calls.length = 0; passes.draw(pass, plain); passes.compute({} as never);
  expect(fake.calls).toEqual([]);
});

test('compute runs three\'s own dispatches in the shared encoder, and a node dispatched again submits the passes before it first', () => {
  const fake = fakeRenderer(), passes = make(fake), target = new RenderTarget(4, 4, { depthBuffer: false }), pass = quad(), a = { kernel: 'a' }, b = { kernel: 'b' };
  textureOf(fake, target);
  const backend = fake.renderer.backend, begin = backend.beginCompute, finish = backend.finishCompute;
  passes.draw(pass, target);
  fake.calls.length = 0;
  passes.begin();
  passes.compute([a, b] as never);
  passes.draw(pass, target);
  passes.compute(a as never);
  passes.end();
  expect(fake.calls.filter(c => ['begin compute', 'dispatch', 'end compute', 'begin', 'submit'].includes(c[0])).map(c => c.length > 2 && c[0] !== 'begin' ? [c[0], c.at(-1)] : c.slice(0, 2)))
    .toEqual([['begin compute', 1], ['dispatch', 1], ['dispatch', 1], ['end compute', 1], ['begin', 1], ['submit', 1], ['begin compute', 2], ['dispatch', 2], ['end compute', 2], ['submit', 2]]);
  expect(backend.beginCompute).toBe(begin);
  expect(backend.finishCompute).toBe(finish);
  expect(passes.stats.computes).toBe(2);
  // Off: three's compute with its own encoder and submit.
  passes.enabled = false;
  fake.calls.length = 0;
  passes.compute(a as never);
  expect(kinds(fake.calls)).toEqual(['begin compute', 'dispatch', 'end compute', 'submit']);
});

test('a readback copies after the passes before it, in their encoder, and maps its buffer once they are submitted', async () => {
  const fake = fakeRenderer(), passes = make(fake), target = new RenderTarget(128, 1, { depthBuffer: false }), pass = quad();
  textureOf(fake, target);
  passes.draw(pass, target);
  fake.calls.length = 0;
  let mapped = 0;
  const buffer = { mapAsync: async (mode: number) => { expect(mode).toBe(1); expect(kinds(fake.calls).at(-1)).toBe('submit'); mapped++; } };
  passes.begin();
  passes.draw(pass, target);
  const read = passes.readback(target.texture as Texture, buffer as never, 2048, 128, 1);
  expect(mapped).toBe(0);
  passes.end();
  await read;
  expect(mapped).toBe(1);
  expect(kinds(fake.calls)).toEqual(['update', 'begin', 'viewport', 'pipeline', 'group', 'group', 'vertex', 'draw', 'info', 'end', 'copy', 'submit']);
  expect(fake.calls.find(c => c[0] === 'copy')!.slice(2)).toEqual([fake.gpu(target.texture).texture, buffer, 2048, { width: 128, height: 1 }]);
  expect(passes.stats.readbacks).toBe(1);
});

test('routed renders into a target become passes; the renderer\'s render is put back', () => {
  const fake = fakeRenderer(), passes = make(fake), target = new RenderTarget(4, 4, { depthBuffer: false }), mesh = quad(), camera = mesh.camera;
  textureOf(fake, target);
  const render = fake.renderer.render;
  const draw = () => { fake.renderer.setRenderTarget(target); (fake.renderer as unknown as WebGPURenderer).render(mesh, camera); };
  passes.routed(() => { draw(); draw(); });
  expect(kinds(fake.calls).filter(k => k === 'three render' || k === 'draw')).toEqual(['three render', 'draw']);
  expect(fake.renderer.render).toBe(render);
  expect(Object.prototype.hasOwnProperty.call(fake.renderer, 'render')).toBe(true);
});
