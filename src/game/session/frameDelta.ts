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
  if (!update || typeof update !== 'object' || !Number.isSafeInteger(update.tick) || update.tick < 0
    || !(update.baseTick === null || Number.isSafeInteger(update.baseTick))) throw new Error('Invalid battle frame update.');
  if ((update.baseTick ?? undefined) !== reference?.tick) throw new Error('Battle frame arrived against a baseline this session is not holding.');
  const frame = readSnapshot(applyFramePatch(reference, update.delta));
  if (frame.tick !== update.tick) throw new Error('Battle frame tick disagrees with its update.');
  return frame;
}
