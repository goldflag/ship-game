/** The one frame decoder, the receiving end of `crates/naval-sim/src/frame_delta.rs`.
 * Both transports deliver a `FrameUpdate`: a patch against a reference frame
 * the receiver already holds. The custom-battle worker's reference is the frame
 * it published last (ordered, lossless: one request, one reply); the match
 * server's is the immutable baseline that arrived with the match metadata, so
 * any update may be skipped. Applying copies the changed paths and never
 * mutates the reference, which may still be interpolating on screen; unchanged
 * subtrees keep their identity.
 *
 * The codec owns the null invariant: an object field that is null in Rust has
 * no key here, with one declared exception (`activeFlightLimit`, whose null is
 * the "unlimited" policy). Nothing on this side strips nulls. */
import type { FramePatch } from '../../multiplayer/generated/FramePatch';
import type { FrameUpdate } from '../../multiplayer/generated/FrameUpdate';
import { readSnapshot } from './snapshotCodec';
import type { Snapshot } from './SnapshotSession';

export type { FramePatch, FrameUpdate };

function setField<T>(object: Record<string, T>, key: string, value: T): void {
  if (key === '__proto__') Object.defineProperty(object, key, { value, enumerable: true, configurable: true, writable: true });
  else object[key] = value;
}

/** Copy changed paths onto `previous`. Never mutate the frame being interpolated. */
export function applyFramePatch(previous: unknown, patch: FramePatch | undefined): unknown {
  if (patch === undefined) return previous;
  if (patch === null || typeof patch !== 'object') return patch;
  if ('value' in patch) return patch.value;
  if ('array' in patch) {
    let result: unknown[];
    if (patch.from) {
      // A keyed collection: copy each run of survivors to where it now sits; the patches fill the rest.
      result = [];
      for (const [index, from, count] of patch.from) {
        while (result.length < index) result.push(undefined);
        for (let i = 0; i < count; i++) result.push((previous as unknown[])[from + i]);
      }
      while (result.length < patch.length!) result.push(undefined);
    } else result = (previous as unknown[]).slice();
    for (const [index, change] of patch.array) result[index] = applyFramePatch(result[index], change);
    return result;
  }
  const result = { ...previous as Record<string, unknown> };
  if (patch.removed) for (const key of patch.removed) delete result[key];
  for (const key of Object.keys(patch.object)) setField(result, key, applyFramePatch(result[key], patch.object[key]));
  return result;
}

/** The frame `update` describes, given the reference it was encoded against
 * (`undefined` when the receiver holds nothing yet). A reference the encoder
 * did not diff against is a transport fault, never a silently wrong frame. */
export function decodeFrameUpdate(reference: Snapshot | undefined, update: FrameUpdate): Snapshot {
  return checkedFrame(reference, update, () => applyFramePatch(reference, update.delta));
}
function checkedFrame(reference: Snapshot | undefined, update: { baseTick: number | null; tick: number }, apply: () => unknown): Snapshot {
  if (!update || typeof update !== 'object' || !Number.isSafeInteger(update.tick) || update.tick < 0
    || !(update.baseTick === null || Number.isSafeInteger(update.baseTick))) throw new Error('Invalid battle frame update.');
  if ((update.baseTick ?? undefined) !== reference?.tick) throw new Error('Battle frame arrived against a baseline this session is not holding.');
  const frame = readSnapshot(apply());
  if (frame.tick !== update.tick) throw new Error('Battle frame tick disagrees with its update.');
  return frame;
}

/** The binary grammar's tags (`frame_delta::tag`). */
const END = 0, NULL = 1, FALSE = 2, TRUE = 3, NUMBER = 4, TEXT = 5, JSON_VALUE = 6, ARRAY = 7, OBJECT = 8, PATCH_OBJECT = 9, PATCH_ARRAY = 10, PATCH_KEYED = 11;
const BINARY_HEADER = 36;
const utf8 = new TextDecoder(), EMPTY = new Uint8Array(0), EMPTY_VIEW = new DataView(EMPTY.buffer);

/** A binary update's ticks, read from its header without decoding it. */
export function binaryUpdateTicks(bytes: Uint8Array): { baseTick: number | null; tick: number } {
  if (bytes.byteLength <= BINARY_HEADER) throw new Error('Invalid battle frame update.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, BINARY_HEADER), base = view.getFloat64(8, true);
  return { baseTick: base < 0 ? null : base, tick: view.getFloat64(0, true) };
}

/** Reads the local worker's binary form of the update (`FrameDelta::update_binary`,
 * whose doc spells the grammar): the same patch as the text, with numbers as
 * their eight bytes and keys numbered by a table the stream builds as it goes.
 * The patch is applied as it is read, onto the reference, exactly as
 * `applyFramePatch` applies the text: the same copied paths, kept identities
 * and key order, with no JSON text to parse and no patch tree to walk. A new
 * object is cloned from its shape's template, which `JSON.parse` laid out, so
 * it is stored as a parsed one would be: objects filled key by key keep most
 * fields out of line, and apply and the renderer read them a fifth slower.
 * One reader per stream, since it holds the stream's key and shape tables. */
export class BinaryFrameReader {
  private keys: string[] = [];
  private shapes: { keys: string[]; template: Record<string, unknown> }[] = [];
  private bytes: Uint8Array = EMPTY;
  private view: DataView = EMPTY_VIEW;
  private at = 0;
  private table: unknown[] = [];
  decode(reference: Snapshot | undefined, bytes: Uint8Array): Snapshot {
    return checkedFrame(reference, binaryUpdateTicks(bytes), () => {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const offset = view.getUint32(16, true), knownKeys = view.getUint32(20, true), freshKeys = view.getUint32(24, true);
      const knownShapes = view.getUint32(28, true), freshShapes = view.getUint32(32, true);
      if (offset <= BINARY_HEADER || offset > bytes.byteLength) throw new Error('Invalid battle frame update.');
      const table = JSON.parse(utf8.decode(bytes.subarray(offset))) as unknown[];
      if (!Array.isArray(table) || freshKeys + freshShapes > table.length) throw new Error('Invalid battle frame update.');
      if (!knownKeys) { this.keys = []; this.shapes = []; }
      if (this.keys.length !== knownKeys || this.shapes.length !== knownShapes) throw new Error('Battle frame arrived against a key table this session is not holding.');
      const shapesAt = table.length - freshShapes;
      for (let i = shapesAt - freshKeys; i < shapesAt; i++) this.keys.push(table[i] as string);
      for (let i = shapesAt; i < table.length; i++) {
        const keys = (table[i] as number[]).map(key => this.key(key));
        this.shapes.push({ keys, template: JSON.parse(`{${keys.map(key => `${JSON.stringify(key)}:null`).join(',')}}`) });
      }
      this.bytes = bytes; this.view = view; this.table = table; this.at = BINARY_HEADER;
      const frame = bytes[BINARY_HEADER] === END ? (this.at++, reference) : this.patch(reference);
      const end = this.at;
      this.bytes = EMPTY; this.view = EMPTY_VIEW; this.table = [];
      if (end !== offset) throw new Error('Invalid battle frame update.');
      return frame;
    });
  }
  private leb(): number {
    let byte = this.bytes[this.at++];
    if (byte < 0x80) return byte;
    let value = byte & 0x7f, scale = 0x80;
    do { byte = this.bytes[this.at++]; value += (byte & 0x7f) * scale; scale *= 0x80; } while (byte >= 0x80);
    return value;
  }
  private key(id: number): string {
    const key = this.keys[id];
    if (key === undefined) throw new Error('Invalid battle frame update.');
    return key;
  }
  private value(tag: number): unknown {
    switch (tag) {
      case NULL: return null;
      case FALSE: return false;
      case TRUE: return true;
      case NUMBER: { const value = this.view.getFloat64(this.at, true); this.at += 8; return value; }
      case TEXT: case JSON_VALUE: return this.table[this.leb()];
      case ARRAY: {
        const values: unknown[] = [];
        for (let n = this.leb(); n > 0; n--) values.push(this.value(this.bytes[this.at++]));
        return values;
      }
      case OBJECT: {
        const shape = this.shapes[this.leb()];
        if (!shape) throw new Error('Invalid battle frame update.');
        const object: Record<string, unknown> = { ...shape.template }, keys = shape.keys;
        for (let i = 0; i < keys.length; i++) setField(object, keys[i], this.value(this.bytes[this.at++]));
        return object;
      }
    }
    throw new Error('Invalid battle frame update.');
  }
  private patch(previous: any): any {
    const tag = this.bytes[this.at++];
    if (tag === PATCH_OBJECT) {
      const result = { ...previous };
      for (let id = this.leb(); id; id = this.leb()) { const key = this.key(id - 1); setField(result, key, this.patch(result[key])); }
      for (let n = this.leb(); n > 0; n--) delete result[this.key(this.leb())];
      return result;
    }
    if (tag === PATCH_ARRAY || tag === PATCH_KEYED) {
      let result: unknown[];
      if (tag === PATCH_KEYED) {
        // A keyed collection: copy each run of survivors to where it now sits; the patches fill the rest.
        result = [];
        for (let runs = this.leb(); runs > 0; runs--) {
          const index = this.leb(), from = this.leb(), count = this.leb();
          while (result.length < index) result.push(undefined);
          for (let i = 0; i < count; i++) result.push(previous[from + i]);
        }
        const length = this.leb();
        while (result.length < length) result.push(undefined);
      } else result = previous.slice();
      for (let index = this.leb(); index; index = this.leb()) result[index - 1] = this.patch(result[index - 1]);
      return result;
    }
    return this.value(tag);
  }
}
