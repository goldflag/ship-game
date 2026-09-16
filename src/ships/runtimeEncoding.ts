/** Derived encoding of the existing ShipDefinition JSON, never an authoring format.
 * Postorder DAG: exact f64 numbers, interned strings, shared array/object records.
 * References always point backwards; object schemas are shared arrays of key strings.
 * No quantization, geometry simplification or identifier rewriting is performed.
 */
const MAGIC = [78, 83, 68, 1]; // NSD, encoding version 1
const MAX_NODES = 8_000_000, MAX_DEPTH = 128;
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
class Writer {
  private bytes = new Uint8Array(1024); private length = 0;
  byte(n: number) { if (this.length === this.bytes.length) { const b = new Uint8Array(this.length * 2); b.set(this.bytes); this.bytes = b; } this.bytes[this.length++] = n; }
  uint(n: number) { do { const b = n % 128; n = Math.floor(n / 128); this.byte(b | (n ? 128 : 0)); } while (n); }
  data(bytes: Uint8Array) { for (const b of bytes) this.byte(b); }
  finish() { return this.bytes.slice(0, this.length); }
}
export function encodeRuntimeDefinition(value: unknown): Uint8Array {
  const writer = new Writer(), encoder = new TextEncoder();
  const tables = Array.from({ length: 7 }, () => new Map<string | number, number>());
  let count = 0;
  function visit(v: Json, depth: number): number {
    if (depth > MAX_DEPTH) throw new Error('Runtime definition nesting exceeds limit');
    let tag: number, key: string | number, refs: number[] = [], schema = 0;
    if (v === null) { tag = 0; key = ''; }
    else if (typeof v === 'boolean') { tag = v ? 2 : 1; key = ''; }
    else if (typeof v === 'number') { if (!Number.isFinite(v)) throw new Error('Nonfinite runtime number'); tag = 3; key = Object.is(v, -0) ? '-0' : v; }
    else if (typeof v === 'string') { tag = 4; key = v; }
    else if (Array.isArray(v)) { tag = 5; refs = v.map(c => visit(c, depth + 1)); key = refs.join(','); }
    else {
      if (typeof v !== 'object') throw new Error('Runtime definition contains a non-JSON value');
      tag = 6; const keys = Object.keys(v).sort();
      schema = visit(keys, depth + 1); refs = keys.map(k => visit(v[k], depth + 1)); key = schema + ':' + refs.join(',');
    }
    const old = tables[tag].get(key); if (old !== undefined) return old;
    const id = count++; if (count > MAX_NODES) throw new Error('Runtime definition exceeds node limit');
    tables[tag].set(key, id); writer.byte(tag);
    if (tag === 3) { const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, v as number, true); writer.data(b); }
    else if (tag === 4) { const b = encoder.encode(v as string); writer.uint(b.length); writer.data(b); }
    else if (tag === 5) { writer.uint(refs.length); refs.forEach(r => writer.uint(r)); }
    else if (tag === 6) { writer.uint(schema); refs.forEach(r => writer.uint(r)); }
    return id;
  }
  const root = visit(value as Json, 0), body = writer.finish(), out = new Writer();
  out.data(new Uint8Array(MAGIC)); out.uint(count); out.uint(root); out.data(body); return out.finish();
}
/** Returned records are immutable and shared, including equal geometry arrays. */
export function decodeRuntimeDefinition<T>(bytes: Uint8Array): T {
  let at = 0;
  const byte = () => { if (at >= bytes.length) throw new Error('Truncated runtime definition'); return bytes[at++]; };
  const uint = () => { let n = 0, scale = 1; for (let i = 0; i < 5; i++) { const b = byte(); n += (b & 127) * scale; if (!(b & 128)) { if (n > 0xffffffff) break; return n; } scale *= 128; } throw new Error('Invalid runtime index'); };
  if (MAGIC.some(b => byte() !== b)) throw new Error('Unsupported runtime definition encoding');
  const count = uint(), root = uint();
  if (!count || count > MAX_NODES || count > bytes.length || root >= count) throw new Error('Invalid runtime node count');
  const values: Json[] = [], depths: number[] = [];
  const decoder = new TextDecoder('utf-8', { fatal: true }), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < count; i++) {
    let depth = 0;
    const ref = () => { const id = uint(); if (id >= i) throw new Error('Invalid runtime reference'); depth = Math.max(depth, depths[id] + 1); return values[id]; };
    const tag = byte(); let value: Json;
    if (tag < 3) value = tag === 0 ? null : tag === 2;
    else if (tag === 3) { if (at + 8 > bytes.length) throw new Error('Truncated runtime number'); value = view.getFloat64(at, true); at += 8; if (!Number.isFinite(value)) throw new Error('Nonfinite runtime number'); }
    else if (tag === 4) { const size = uint(); if (at + size > bytes.length) throw new Error('Truncated runtime string'); value = decoder.decode(bytes.subarray(at, at + size)); at += size; }
    else if (tag === 5) { const size = uint(); if (size > bytes.length - at) throw new Error('Invalid runtime array length'); value = []; for (let j = 0; j < size; j++) value.push(ref()); Object.freeze(value); }
    else if (tag === 6) {
      const keys = ref(); if (!Array.isArray(keys) || keys.some(k => typeof k !== 'string')) throw new Error('Invalid runtime object schema');
      value = {}; const seen = new Set<string>();
      for (const key of keys as string[]) { if (seen.has(key)) throw new Error('Duplicate runtime field'); seen.add(key); Object.defineProperty(value, key, { value: ref(), enumerable: true }); }
      Object.freeze(value);
    } else throw new Error('Unknown runtime node');
    if (depth > MAX_DEPTH) throw new Error('Runtime definition nesting exceeds limit');
    depths.push(depth); values.push(value);
  }
  if (at !== bytes.length) throw new Error('Trailing runtime data');
  return values[root] as T;
}
