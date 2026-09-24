import { REVISION } from 'three/webgpu';

type Range = { start: number; count: number };
type Uniform = {
  offset: number; index: number; getValue(): unknown; getType(): string;
  isNumberUniform?: boolean; isVector2Uniform?: boolean; isVector3Uniform?: boolean; isVector4Uniform?: boolean;
  isColorUniform?: boolean; isMatrix3Uniform?: boolean; isMatrix4Uniform?: boolean;
};
type Vector = { x: number; y: number; z: number; w: number };
type Color = { r: number; g: number; b: number };
/** Three's `UniformsGroup` (a uniform struct kept per uniform) or another uniform buffer (a uniform array's typed array). */
type UniformBinding = {
  isUniformBuffer?: boolean; isUniformsGroup?: boolean; buffer: ArrayBufferView & ArrayLike<number>; updateRanges: Range[];
  uniforms?: Uniform[]; values?: unknown[]; update?(): boolean; updateByType?(uniform: Uniform): boolean | undefined;
  addUniformUpdateRange?(uniform: Uniform): void;
};
type Queue = { writeBuffer(buffer: object, offset: number, data: ArrayBufferView, dataOffset?: number, size?: number): void };
type Backend = {
  device?: { queue: Queue }; get?(resource: object): { buffer?: object };
  createUniformBuffer?(binding: UniformBinding): void; bindingUtils?: { updateBinding(binding: UniformBinding): void };
};
/** Which parts are on. Each keeps the bytes every GPU buffer holds at every draw exactly as three's own path leaves them. */
export type UniformUploadSwitches = { coalesce: boolean; arrays: boolean; compare: boolean };
type Stats = { groupUploads: number; groupRanges: number; arrayUploads: number; arraySkips: number; arrayBytes: number; arrayBytesSkipped: number };
type State = UniformUploadSwitches & { stats: Stats; kept: WeakMap<object, Uint32Array> };

const states = new WeakMap<object, State>();
const emptyStats = (): Stats => ({ groupUploads: 0, groupRanges: 0, arrayUploads: 0, arraySkips: 0, arrayBytes: 0, arrayBytesSkipped: 0 });

/** Switch parts off (for comparison) or on. Turning `arrays` on forgets every kept copy: three may have written them since. */
export function setUniformUploads(backend: object, switches: Partial<UniformUploadSwitches>): void {
  const state = states.get(backend);
  if (!state) return;
  if (switches.arrays && !state.arrays) state.kept = new WeakMap();
  Object.assign(state, switches);
}
export function uniformUploadStats(backend: object): Readonly<UniformUploadSwitches & { stats: Stats }> | undefined { return states.get(backend); }

const NUMBER = 1, VECTOR2 = 2, VECTOR3 = 3, VECTOR4 = 4, COLOR = 5, MATRIX3 = 6, MATRIX4 = 7;
/** Three r185's `UniformsGroup.updateByType` order; 0 is a type three itself reports as unsupported. */
function kindOf(uniform: Uniform): number {
  return uniform.isNumberUniform ? NUMBER : uniform.isVector2Uniform ? VECTOR2 : uniform.isVector3Uniform ? VECTOR3 : uniform.isVector4Uniform ? VECTOR4
    : uniform.isColorUniform ? COLOR : uniform.isMatrix3Uniform ? MATRIX3 : uniform.isMatrix4Uniform ? MATRIX4 : 0;
}
/** `UniformsGroup._getBufferForType`: integer uniforms write through an integer view of the same bytes. */
const FLOAT = 0, INT = 1, UINT = 2;
function viewOf(type: string): number {
  return type === 'int' || type === 'ivec2' || type === 'ivec3' || type === 'ivec4' ? INT : type === 'uint' || type === 'uvec2' || type === 'uvec3' || type === 'uvec4' ? UINT : FLOAT;
}
type Plan = { uniforms: Uniform[]; length: number; kinds: Uint8Array; views: Uint8Array; bytes: ArrayBufferLike | null; int: Int32Array | null; uint: Uint32Array | null };
const plans = new WeakMap<object, Plan>();
function planOf(group: UniformBinding): Plan {
  const uniforms = group.uniforms!;
  let plan = plans.get(group);
  if (plan && plan.uniforms === uniforms && plan.length === uniforms.length) return plan;
  const kinds = new Uint8Array(uniforms.length), views = new Uint8Array(uniforms.length);
  for (let i = 0; i < uniforms.length; i++) { kinds[i] = kindOf(uniforms[i]); views[i] = viewOf(uniforms[i].getType()); }
  plans.set(group, plan = { uniforms, length: uniforms.length, kinds, views, bytes: null, int: null, uint: null });
  return plan;
}

/** Three r185's `UniformsGroup.update`, comparing and writing the same values in the same order with the same results (values,
 * buffer, update ranges and return value), without a type dispatch and a `getType()` per uniform: each group keeps its uniforms'
 * kinds and typed views. `this` is the group. */
export function compareUniforms(this: UniformBinding): boolean {
  const plan = planOf(this), { uniforms, kinds, views } = plan, n = uniforms.length;
  let updated = false;
  if (!n) return updated;
  // Three reads `values` first in every uniform's update: the first read builds the group's values and buffer (and its offsets).
  const a = this.values!;
  for (let i = 0; i < n; i++) {
    const uniform = uniforms[i], kind = kinds[i];
    if (kind === 0) { if (this.updateByType!(uniform) === true) updated = true; continue; }
    const o = uniform.offset;
    if (kind === NUMBER) {
      const v = uniform.getValue() as number;
      if (a[o] !== v) { integerView(this, plan, views[i])[o] = a[o] = v; updated = true; this.addUniformUpdateRange!(uniform); }
    } else if (kind <= VECTOR4) {
      const v = uniform.getValue() as Vector;
      if (a[o] !== v.x || a[o + 1] !== v.y || (kind >= VECTOR3 && a[o + 2] !== v.z) || (kind === VECTOR4 && a[o + 3] !== v.w)) {
        const b = integerView(this, plan, views[i]);
        b[o] = a[o] = v.x; b[o + 1] = a[o + 1] = v.y;
        if (kind >= VECTOR3) b[o + 2] = a[o + 2] = v.z;
        if (kind === VECTOR4) b[o + 3] = a[o + 3] = v.w;
        updated = true; this.addUniformUpdateRange!(uniform);
      }
    } else if (kind === COLOR) {
      const c = uniform.getValue() as Color;
      if (a[o] !== c.r || a[o + 1] !== c.g || a[o + 2] !== c.b) {
        const b = this.buffer as Float32Array;
        b[o] = a[o] = c.r; b[o + 1] = a[o + 1] = c.g; b[o + 2] = a[o + 2] = c.b;
        updated = true; this.addUniformUpdateRange!(uniform);
      }
    } else if (kind === MATRIX3) {
      const e = (uniform.getValue() as { elements: ArrayLike<number> }).elements;
      if (a[o] !== e[0] || a[o + 1] !== e[1] || a[o + 2] !== e[2] || a[o + 4] !== e[3] || a[o + 5] !== e[4] || a[o + 6] !== e[5] ||
        a[o + 8] !== e[6] || a[o + 9] !== e[7] || a[o + 10] !== e[8]) {
        const b = this.buffer as Float32Array;
        b[o] = a[o] = e[0]; b[o + 1] = a[o + 1] = e[1]; b[o + 2] = a[o + 2] = e[2];
        b[o + 4] = a[o + 4] = e[3]; b[o + 5] = a[o + 5] = e[4]; b[o + 6] = a[o + 6] = e[5];
        b[o + 8] = a[o + 8] = e[6]; b[o + 9] = a[o + 9] = e[7]; b[o + 10] = a[o + 10] = e[8];
        updated = true; this.addUniformUpdateRange!(uniform);
      }
    } else {
      const e = (uniform.getValue() as { elements: ArrayLike<number> }).elements, l = e.length;
      let same = true;
      for (let k = 0; k < l; k++) if (a[o + k] !== e[k]) { same = false; break; }
      if (!same) {
        (this.buffer as Float32Array).set(e, o);
        for (let k = 0; k < l; k++) a[o + k] = e[k];
        updated = true; this.addUniformUpdateRange!(uniform);
      }
    }
  }
  return updated;
}
/** The float buffer, or an integer view of its bytes (three builds a new one per write; the bytes written are the same). */
function integerView(group: UniformBinding, plan: Plan, view: number): Float32Array | Int32Array | Uint32Array {
  const buffer = group.buffer as Float32Array;
  if (view === FLOAT) return buffer;
  if (plan.bytes !== buffer.buffer) { plan.bytes = buffer.buffer; plan.int = new Int32Array(buffer.buffer); plan.uint = new Uint32Array(buffer.buffer); }
  return view === INT ? plan.int! : plan.uint!;
}

/** Adapter for pinned Three r185's uniform uploads, where a 30-ship battle spent ~1.5 ms a frame:
 * - A uniform group writes each run of adjacent changed uniforms with its own `writeBuffer`, ~3 per object group and ~15 per render
 *   group update. The GPU copy of a group always holds the group's whole CPU buffer (both start zeroed, and every changed value is
 *   written), so one write from the first changed uniform to the end of the last leaves the same bytes.
 * - A uniform array (three's `uniformArray`) is written whole at every update: per draw for an object group, where the shared paint
 *   and the ocean read theirs, though most of their values stay put. Each GPU buffer's last bytes are kept, and only the span from the
 *   first changed word to the last is written, or nothing.
 * - Every draw compares every uniform of its object group, through a type dispatch and two calls per uniform (`compareUniforms`).
 * Three's own path still decides what is compared and when; `setUniformUploads` switches each part off for comparison. */
export function installUniformUploads(value: object): void {
  const backend = value as Backend, utils = backend.bindingUtils, device = backend.device;
  if (REVISION !== '185' || !utils?.updateBinding || !backend.createUniformBuffer || !backend.get || !device || states.has(value)) return;
  const state: State = { coalesce: true, arrays: true, compare: true, stats: emptyStats(), kept: new WeakMap() };
  states.set(value, state);
  const get = backend.get.bind(backend), write = utils.updateBinding, create = backend.createUniformBuffer;
  // Groups compare through `compareUniforms` while `compare` is on, else through three's own `update`.
  backend.createUniformBuffer = function (binding) {
    create.call(this, binding);
    if (!binding.isUniformsGroup || Object.prototype.hasOwnProperty.call(binding, 'update')) return;
    const threeUpdate = binding.update!;
    binding.update = function (this: UniformBinding) { return state.compare ? compareUniforms.call(this) : threeUpdate.call(this); };
  };
  utils.updateBinding = function (binding) {
    const ranges = binding.updateRanges, stats = state.stats;
    if (binding.isUniformsGroup) {
      if (!state.coalesce || ranges.length < 2) return write.call(this, binding);
      let start = ranges[0].start, end = start + ranges[0].count;
      for (let i = 1; i < ranges.length; i++) {
        const range = ranges[i];
        if (range.start < start) start = range.start;
        if (range.start + range.count > end) end = range.start + range.count;
      }
      stats.groupUploads++; stats.groupRanges += ranges.length;
      const array = binding.buffer as Float32Array;
      device.queue.writeBuffer(get(binding).buffer!, start * array.BYTES_PER_ELEMENT, array, start, end - start);
      return;
    }
    const array = binding.buffer, gpu = get(binding).buffer;
    if (!state.arrays || !binding.isUniformBuffer || ranges.length || !gpu || !array || array.byteOffset % 4 || array.byteLength % 4) {
      // Three writes it (a range, or with the switch off): the next write here starts from a whole upload again.
      if (gpu) state.kept.delete(gpu);
      return write.call(this, binding);
    }
    const words = new Uint32Array(array.buffer, array.byteOffset, array.byteLength >> 2);
    const kept = state.kept.get(gpu);
    if (!kept || kept.length !== words.length) { write.call(this, binding); state.kept.set(gpu, words.slice()); stats.arrayUploads++; stats.arrayBytes += array.byteLength; return; }
    let first = 0;
    while (first < words.length && words[first] === kept[first]) first++;
    if (first === words.length) { stats.arraySkips++; stats.arrayBytesSkipped += array.byteLength; return; }
    let last = words.length - 1;
    while (words[last] === kept[last]) last--;
    kept.set(words.subarray(first, last + 1), first);
    device.queue.writeBuffer(gpu, first * 4, words, first, last - first + 1);
    stats.arrayUploads++; stats.arrayBytes += (last - first + 1) * 4; stats.arrayBytesSkipped += array.byteLength - (last - first + 1) * 4;
  };
}
