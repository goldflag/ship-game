import type { Snapshot } from './SnapshotSession';

/** Check a frame at the authority boundary. The frame arrives already in its
 * declared shape: the Rust codec (`frame_delta`) emits absent keys for null
 * optionals, so there is no normalizing walk here, only bounds. Keep this
 * module renderer/DOM-free so the custom worker can run it off the render thread. */
export function decodeSnapshot(json: string): Snapshot { return readSnapshot(JSON.parse(json)); }
export function readSnapshot(value: unknown): Snapshot {
  const frame = value as Snapshot;
  if (!frame || !Number.isSafeInteger(frame.tick) || frame.tick < 0 || !Array.isArray(frame.actors) || !frame.actors.length || frame.actors.length > 60)
    throw new Error('Invalid battle snapshot.');
  return frame;
}
