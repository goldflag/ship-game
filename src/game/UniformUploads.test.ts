import { expect, test } from 'bun:test';
import { Color, Matrix3, Matrix4, Vector2, Vector3, Vector4 } from 'three';
// Three r185's own uniform groups and WebGPU upload path, the reference every part here must match byte for byte.
// @ts-expect-error Three does not publish declarations for its internal uniform groups.
import NodeUniformsGroup from 'three/src/renderers/common/nodes/NodeUniformsGroup.js';
import {
  ColorNodeUniform, Matrix3NodeUniform, Matrix4NodeUniform, NumberNodeUniform, Vector2NodeUniform, Vector3NodeUniform, Vector4NodeUniform,
  // @ts-expect-error Nor for its node uniforms.
} from 'three/src/renderers/common/nodes/NodeUniform.js';
import NodeUniform from 'three/src/nodes/core/NodeUniform.js';
// @ts-expect-error Nor for its WebGPU binding utilities.
import WebGPUBindingUtils from 'three/src/renderers/webgpu/utils/WebGPUBindingUtils.js';
import { compareUniforms, installUniformUploads, setUniformUploads, uniformUploadStats } from './UniformUploads';

type Group = {
  update(): boolean; buffer: Float32Array; values: unknown[]; updateRanges: { start: number; count: number }[]; byteLength: number;
  clearUpdateRanges(): void; addUniform(uniform: object): void; isUniformsGroup: boolean;
};
type Node = { id: number; value: unknown };
type Write = { buffer: Gpu; offset: number; bytes: Uint8Array };
type Gpu = { bytes: Uint8Array };

/** A seeded generator, so a failure repeats. */
function random(seed: number) { return () => ((seed = Math.imul(seed ^ (seed >>> 15), 2246822519) + 0x6d2b79f5 >>> 0) / 2 ** 32); }

/** Every uniform kind three's groups update, integer views included, over nodes whose values the tests move. */
function uniformSet() {
  let id = 0;
  const nodes: { node: Node; type: string; make: (next: () => number) => unknown }[] = [];
  const specs: [new (u: object) => object, string, () => unknown, (next: () => number) => unknown][] = [
    [NumberNodeUniform, 'float', () => 0, next => pick(next, [0, -0, 1, .1 + .2, NaN, 1e-40, next()])],
    [NumberNodeUniform, 'int', () => 0, next => pick(next, [0, -1, 7, 2.5, 2 ** 31, -0])],
    [NumberNodeUniform, 'uint', () => 0, next => pick(next, [0, 3, -1, 2 ** 32 + 5, true])],
    [NumberNodeUniform, 'bool', () => false, next => pick(next, [true, false, 0, 1])],
    [Vector2NodeUniform, 'vec2', () => new Vector2(), next => new Vector2(pick(next, [0, -0, 1, NaN]), next())],
    [Vector2NodeUniform, 'ivec2', () => new Vector2(), next => new Vector2(Math.floor(next() * 9) - 4, pick(next, [0, 3.7]))],
    [Vector3NodeUniform, 'vec3', () => new Vector3(), next => new Vector3(next(), pick(next, [0, -0]), next())],
    [Vector3NodeUniform, 'uvec3', () => new Vector3(), next => new Vector3(3, pick(next, [0, -2]), 9)],
    [Vector4NodeUniform, 'vec4', () => new Vector4(), next => new Vector4(next(), next(), pick(next, [1, NaN]), next())],
    [Vector4NodeUniform, 'ivec4', () => new Vector4(), next => new Vector4(1, 2, pick(next, [3, 4]), -5)],
    [ColorNodeUniform, 'color', () => new Color(), next => new Color(next(), pick(next, [0, -0, .5]), next())],
    [Matrix3NodeUniform, 'mat3', () => new Matrix3(), next => new Matrix3().set(next(), 0, 1, pick(next, [2, -0]), 4, 5, 6, next(), 8)],
    [Matrix4NodeUniform, 'mat4', () => new Matrix4(), next => new Matrix4().makeTranslation(next(), pick(next, [0, NaN]), 3)],
  ];
  for (let copy = 0; copy < 3; copy++) for (const [, type, initial, make] of specs) nodes.push({ node: { id: id++, value: initial() }, type, make });
  const group = (): Group => {
    const g = new NodeUniformsGroup('object', {}) as unknown as Group;
    nodes.forEach(({ node, type }, i) => g.addUniform(new specs[i % specs.length][0](new NodeUniform(`u${i}`, type, node as never))));
    return g;
  };
  return { nodes, group };
}
function pick<T>(next: () => number, list: T[]): T { return list[Math.floor(next() * list.length)]; }
/** A move of one uniform: a new value, or one component of its value changed (in place or on a copy), so a compare that skips
 * any component shows. */
function move(entry: ReturnType<typeof uniformSet>['nodes'][number], next: () => number) {
  const value = entry.node.value as { clone?(): object; elements?: number[] } & Record<string, number>;
  if (typeof value !== 'object' || next() < .5) { entry.node.value = entry.make(next); return; }
  const target = (next() < .5 ? value : value.clone!()) as typeof value;
  const keys = target.elements ? target.elements.map((_, i) => i) : Object.keys(target).filter(k => typeof target[k] === 'number' && !k.startsWith('_') && k !== 'isColor');
  const key = pick(next, keys as (string | number)[]), component = pick(next, [0, -0, NaN, next(), 3]);
  if (target.elements) target.elements[key as number] = component; else target[key as string] = component;
  entry.node.value = target;
}
/** Values the same element for element, NaN, -0 and booleans included. */
function sameValues(a: unknown[], b: unknown[]) { return a.length === b.length && a.every((x, i) => Object.is(x, b[i])); }
const bytes = (view: ArrayBufferView) => new Uint8Array(view.buffer, view.byteOffset, view.byteLength);

test('compareUniforms leaves the values, bytes, update ranges and result three r185 leaves, for every kind of uniform', () => {
  const { nodes, group } = uniformSet(), three = group(), ours = group();
  const next = random(7);
  for (let round = 0; round < 3000; round++) {
    // Some rounds move nothing; others move a few uniforms, sometimes to the value they already hold.
    const moves = round % 5 === 0 ? 0 : 1 + Math.floor(next() * 5);
    for (let k = 0; k < moves; k++) move(pick(next, nodes), next);
    if (round % 97 === 0) (pick(next, nodes.filter(n => n.type === 'mat4')).node.value as Matrix4).elements[5] = next(); // in place
    const expected = three.update(), result = compareUniforms.call(ours as never);
    expect(result).toBe(expected);
    expect(sameValues(ours.values, three.values)).toBe(true);
    expect(bytes(ours.buffer)).toEqual(bytes(three.buffer));
    expect(ours.updateRanges.map(r => [r.start, r.count])).toEqual(three.updateRanges.map(r => [r.start, r.count]));
    three.clearUpdateRanges(); ours.clearUpdateRanges();
  }
});

/** A backend whose GPU buffers are byte arrays, uploads through three's own WebGPUBindingUtils. */
function fakeBackend() {
  const data = new Map<object, { buffer?: Gpu }>(), writes: Write[] = [];
  const backend = {
    device: { queue: { writeBuffer(buffer: Gpu, offset: number, source: ArrayBufferView, dataOffset = 0, size?: number) {
      const element = (source as unknown as { BYTES_PER_ELEMENT?: number }).BYTES_PER_ELEMENT ?? 1;
      const view = new Uint8Array(source.buffer, source.byteOffset + dataOffset * element, size !== undefined ? size * element : source.byteLength - dataOffset * element);
      buffer.bytes.set(view, offset); writes.push({ buffer, offset, bytes: view.slice() });
    } } },
    get(object: object) { let entry = data.get(object); if (!entry) data.set(object, entry = {}); return entry; },
    createUniformBuffer(binding: { byteLength: number }) { this.get(binding).buffer ??= { bytes: new Uint8Array(Math.ceil(binding.byteLength / 16) * 16) }; },
    bindingUtils: undefined as unknown as { updateBinding(binding: object): void },
  };
  backend.bindingUtils = new WebGPUBindingUtils(backend) as never;
  return { backend, writes, gpu: (binding: object) => backend.get(binding).buffer!.bytes };
}
/** Three's `Bindings._update` for one uniform buffer binding. */
function upload(backend: ReturnType<typeof fakeBackend>['backend'], binding: Group | ArrayBinding) {
  if (binding.update!()) backend.bindingUtils.updateBinding(binding);
  if (binding.updateRanges.length) binding.clearUpdateRanges!();
}
type ArrayBinding = { isUniformBuffer: true; buffer: Float32Array; byteLength: number; updateRanges: { start: number; count: number }[]; update?(): boolean; clearUpdateRanges?(): void };

test('one write per group update leaves every GPU group byte for byte where three leaves it', () => {
  const { nodes, group } = uniformSet(), reference = fakeBackend(), patched = fakeBackend();
  installUniformUploads(patched.backend);
  const three = group(), ours = group();
  reference.backend.createUniformBuffer(three); patched.backend.createUniformBuffer(ours);
  const next = random(11);
  for (let round = 0; round < 2000; round++) {
    const moves = round % 4 === 0 ? 0 : 1 + Math.floor(next() * 8);
    for (let k = 0; k < moves; k++) move(pick(next, nodes), next);
    const before = patched.writes.length;
    upload(reference.backend, three); upload(patched.backend, ours);
    expect(patched.writes.length - before).toBeLessThanOrEqual(1);
    expect(patched.gpu(ours)).toEqual(reference.gpu(three));
    // The invariant the single write rests on: the GPU copy is the whole CPU buffer.
    expect(patched.gpu(ours).subarray(0, ours.buffer.byteLength)).toEqual(bytes(ours.buffer));
  }
  const stats = uniformUploadStats(patched.backend)!.stats;
  expect(stats.groupUploads).toBeGreaterThan(100);
  expect(stats.groupRanges).toBeGreaterThan(stats.groupUploads * 2);
  expect(patched.writes.length).toBeLessThan(reference.writes.length / 2);
});

test('a uniform array writes only its changed span, or nothing, and three range writes restart it from a whole write', () => {
  const reference = fakeBackend(), patched = fakeBackend();
  installUniformUploads(patched.backend);
  const array = (): ArrayBinding => ({ isUniformBuffer: true, buffer: new Float32Array(320), byteLength: 1280, updateRanges: [],
    update() { return true; }, clearUpdateRanges() { this.updateRanges.length = 0; } });
  const three = array(), ours = array();
  reference.backend.createUniformBuffer(three); patched.backend.createUniformBuffer(ours);
  const next = random(5);
  let skipped = 0;
  for (let round = 0; round < 1500; round++) {
    const moves = round % 3 === 0 ? 0 : Math.floor(next() * 6);
    for (let k = 0; k < moves; k++) {
      const i = Math.floor(next() * 320), value = pick(next, [0, -0, NaN, next(), three.buffer[i]]);
      three.buffer[i] = value; ours.buffer[i] = value;
    }
    // Now and then a range of its own, as three's `addUpdateRange` gives: three writes just that range.
    if (round % 50 === 25) for (const b of [three, ours]) b.updateRanges.push({ start: 8, count: 4 });
    const before = patched.writes.length;
    upload(reference.backend, three); upload(patched.backend, ours);
    const made = patched.writes.slice(before);
    if (!made.length) skipped++;
    expect(made.length).toBeLessThanOrEqual(1);
    expect(patched.gpu(ours)).toEqual(reference.gpu(three));
  }
  expect(skipped).toBeGreaterThan(400);
  expect(uniformUploadStats(patched.backend)!.stats.arraySkips).toBe(skipped);
});

test('each part switches off to three\'s own path, and back on without trusting what three wrote meanwhile', () => {
  const { nodes, group } = uniformSet(), reference = fakeBackend(), patched = fakeBackend();
  installUniformUploads(patched.backend); installUniformUploads(patched.backend);
  const three = group(), ours = group();
  reference.backend.createUniformBuffer(three); patched.backend.createUniformBuffer(ours);
  expect(Object.prototype.hasOwnProperty.call(ours, 'update')).toBe(true);
  const arrays = [0, 1].map(() => ({ isUniformBuffer: true as const, buffer: new Float32Array(64), byteLength: 256, updateRanges: [], update: () => true,
    clearUpdateRanges() { /* none */ } }));
  reference.backend.createUniformBuffer(arrays[0]); patched.backend.createUniformBuffer(arrays[1]);
  const next = random(3);
  for (let round = 0; round < 600; round++) {
    const on = Math.floor(round / 100) % 2 === 0;
    setUniformUploads(patched.backend, { coalesce: on, arrays: on, compare: on });
    for (let k = 0; k < 4; k++) move(pick(next, nodes), next);
    const i = Math.floor(next() * 64), value = next();
    arrays[0].buffer[i] = value; arrays[1].buffer[i] = value;
    const before = patched.writes.length, referenceBefore = reference.writes.length;
    upload(reference.backend, three); upload(patched.backend, ours);
    upload(reference.backend, arrays[0]); upload(patched.backend, arrays[1]);
    // Off, the calls are three's own, one for one.
    if (!on) expect(patched.writes.slice(before).map(w => [w.offset, [...w.bytes]])).toEqual(reference.writes.slice(referenceBefore).map(w => [w.offset, [...w.bytes]]));
    expect(patched.gpu(ours)).toEqual(reference.gpu(three));
    expect(patched.gpu(arrays[1])).toEqual(reference.gpu(arrays[0]));
    expect(sameValues(ours.values, three.values)).toBe(true);
  }
});
