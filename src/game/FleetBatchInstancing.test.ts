import { expect, test } from 'bun:test';
import * as THREE from 'three/webgpu';
import { FleetBatch, type FleetDrawState } from './FleetBatch';
import { fleetBatchSubmissionStats, installFleetBatchInstancing, setFleetBatchBundlesEnabled } from './FleetBatchInstancing';

for (const indexed of [false, true]) test(`native fleet draws preserve every culled pose and geometry (${indexed ? 'indexed' : 'nonindexed'})`, () => {
  const box = new THREE.BoxGeometry(), plane = new THREE.PlaneGeometry();
  const geometries = indexed ? [box, plane] : [box.toNonIndexed(), plane.toNonIndexed()];
  const material = new THREE.MeshStandardMaterial();
  const mesh = new FleetBatch(4, 64, indexed ? 64 : 0, material);
  mesh.sortObjects = false;
  const ids = geometries.map(g => mesh.addGeometry(g));
  for (const [i, id] of [ids[0], ids[1], ids[0], ids[1]].entries()) {
    mesh.addInstance(id); mesh.setMatrixAt(i, new THREE.Matrix4().makeTranslation(i === 3 ? 500 : 0, 0, -20));
  }
  const camera = new THREE.PerspectiveCamera(60, 1, .5, 1000); camera.updateMatrixWorld();
  mesh.onBeforeRender(undefined as never, new THREE.Scene(), camera, mesh.geometry, material, null as never);
  const state = mesh as unknown as FleetDrawState;
  expect(Array.from(state._indirectTexture.image.data!).slice(0, state._multiDrawCount)).toEqual([0, 2, 1]);
  const native: number[][] = [], counts: number[][] = [];
  let binds = 0;
  const backend = { isWebGPUBackend: true, _draw() { binds++; expect(state._multiDrawCount).toBe(0); } };
  installFleetBatchInstancing(backend); installFleetBatchInstancing(backend);
  const args = [
    { object: mesh, material, getIndex: () => mesh.geometry.index },
    { update(_object: object, count: number, instances: number) { counts.push([count, instances]); } },
    null, null, null, null, null,
    { draw(...args: number[]) { native.push(args); }, drawIndexed(...args: number[]) { native.push(args); } }, null,
  ];
  (backend._draw as (...args: unknown[]) => void)(...args);
  expect(binds).toBe(1); expect(native).toHaveLength(2);
  expect(native.map(call => [call[1], call.at(-1)])).toEqual([[2, 0], [1, 2]]);
  expect(counts.map(call => call[1])).toEqual([2, 1]); expect(state._multiDrawCount).toBe(3);
  // A different camera rebuilds the original per-instance culling before grouping.
  camera.position.x = 500; camera.updateMatrixWorld();
  mesh.onBeforeRender(undefined as never, new THREE.Scene(), camera, mesh.geometry, material, null as never);
  expect(Array.from(state._indirectTexture.image.data!).slice(0, state._multiDrawCount)).toEqual([3]);
  mesh.dispose(); box.dispose(); plane.dispose(); geometries.forEach(g => g.dispose()); material.dispose();
});

test('other meshes and compatibility backends retain the original submission path', () => {
  let calls = 0;
  const original = () => { calls++; };
  const backend = { isWebGPUBackend: false, _draw: original };
  installFleetBatchInstancing(backend); expect(backend._draw).toBe(original);
  backend.isWebGPUBackend = true; installFleetBatchInstancing(backend);
  (backend._draw as (...args: unknown[]) => void)({ object: new THREE.Mesh(), material: new THREE.MeshBasicMaterial() });
  expect(calls).toBe(1);
});

test('ordered materials retain their submission path and binding failures restore draw state', () => {
  const material = new THREE.MeshBasicMaterial(), mesh = new FleetBatch(2, 6, 0, material);
  const state = mesh as unknown as FleetDrawState; state._multiDrawCount = 1;
  let fallback = true, calls = 0;
  const backend = { isWebGPUBackend: true, _draw() {
    calls++; expect(state._multiDrawCount).toBe(fallback ? 1 : 0);
    if (!fallback) throw new Error('binding failed');
  } };
  installFleetBatchInstancing(backend);
  const draw = () => (backend._draw as (...args: unknown[]) => void)({ object: mesh, material, getIndex: () => null });
  try {
    mesh.sortObjects = true; draw();
    mesh.sortObjects = false; material.transparent = true; draw();
    expect(calls).toBe(2);
    material.transparent = false; fallback = false;
    expect(draw).toThrow('binding failed'); expect(state._multiDrawCount).toBe(1);
  } finally { mesh.dispose(); material.dispose(); }
});

test('bundles reuse live pose buffers but rebuild changed draw ranges and GPU bindings', () => {
  const material = new THREE.MeshBasicMaterial(), box = new THREE.BoxGeometry(), plane = new THREE.PlaneGeometry();
  const mesh = new FleetBatch(32, 64, 64, material); mesh.sortObjects = false;
  const boxId = mesh.addGeometry(box), planeId = mesh.addGeometry(plane);
  for (let i = 0; i < 32; i++) { mesh.addInstance(boxId); mesh.setMatrixAt(i, new THREE.Matrix4().makeTranslation(i * .01, 0, -20)); }
  const camera = new THREE.PerspectiveCamera(60, 1, .5, 1000); camera.updateMatrixWorld(true);
  const prepare = () => {
    mesh.invalidateDrawList(); mesh.onBeforeRender(undefined as never, new THREE.Scene(), camera, mesh.geometry, material, null as never);
  };
  prepare();
  const state = mesh as unknown as FleetDrawState, group = {}, vertex = mesh.geometry.attributes.position;
  const resources = new Map<object, { buffer?: object; group?: object }>([
    [mesh.geometry.index!, { buffer: {} }], [vertex, { buffer: {} }], [group, { group: {} }],
  ]);
  const recorded: number[][][] = [], executed: object[][] = [];
  let binds = 0, native = 0, submittedInstances = 0;
  const backend = {
    isWebGPUBackend: true, get: (resource: object) => resources.get(resource)!,
    pipelineUtils: { createBundleEncoder() {
      const draws: number[][] = []; recorded.push(draws);
      return { draw(...args: number[]) { draws.push(args); }, drawIndexed(...args: number[]) { draws.push(args); }, finish() { return draws; } };
    } },
    _draw() { binds++; expect(state._multiDrawCount).toBe(0); },
  };
  const sets = { attributes: { 0: vertex } as Record<number, unknown>, bindingGroups: [group] as unknown[], pipeline: {} as unknown, index: mesh.geometry.index as unknown };
  const renderObject = { object: mesh, material, context: {}, getIndex: () => mesh.geometry.index };
  const args: unknown[] = [renderObject, { update(_object: object, _count: number, instances: number) { submittedInstances += instances; } }, {}, {}, [group], [vertex], {},
    { draw() { native++; }, drawIndexed() { native++; }, executeBundles(bundles: object[]) { executed.push(bundles); } }, sets];
  installFleetBatchInstancing(backend);
  const draw = () => (backend._draw as (...args: unknown[]) => void)(...args);
  try {
    draw(); expect(recorded).toHaveLength(1); expect(recorded[0][0][1]).toBe(32);
    expect(sets).toEqual({ attributes: {}, bindingGroups: [], pipeline: null, index: null });
    mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(1, 0, -20)); prepare(); draw();
    expect(recorded).toHaveLength(1); expect(binds).toBe(1); expect(executed).toHaveLength(2); expect(submittedInstances).toBe(64);
    mesh.setGeometryIdAt(1, planeId); prepare(); draw();
    expect(recorded).toHaveLength(2); expect(recorded[1].map(d => d[1])).toEqual([31, 1]);
    resources.get(group)!.group = {}; draw(); expect(recorded).toHaveLength(3);
    resources.get(vertex)!.buffer = {}; draw(); expect(recorded).toHaveLength(4);
    resources.get(mesh.geometry.index!)!.buffer = {}; draw(); expect(recorded).toHaveLength(5);
    args[3] = {}; draw(); expect(recorded).toHaveLength(6);
    expect(fleetBatchSubmissionStats(backend)).toEqual({ enabled: true, builds: 6, hits: 1 });
    setFleetBatchBundlesEnabled(backend, false); draw(); expect(native).toBe(2); expect(recorded).toHaveLength(6);
  } finally { mesh.dispose(); box.dispose(); plane.dispose(); material.dispose(); }
});
