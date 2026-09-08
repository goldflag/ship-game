import type { Snapshot } from './SnapshotSession';

/** Decode at the authority boundary. Keep this module renderer/DOM-free so the
 * custom worker can do the parse and optional-field walk off the render thread. */
export function decodeSnapshot(json: string): Snapshot { return readSnapshot(JSON.parse(json)); }
export function readSnapshot(value: unknown): Snapshot {
  const normalize = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    // Arrays keep null slots and only need their elements visited. Avoid
    // allocating string indices for every vector, trail and event array.
    if (Array.isArray(value)) { for (const child of value) normalize(child); return; }
    const object = value as Record<string, unknown>;
    for (const key of Object.keys(object)) {
      if (object[key] === null) delete object[key];
      else normalize(object[key]);
    }
  };
  const frame = value as Snapshot;
  if (!frame || !Number.isSafeInteger(frame.tick) || frame.tick < 0 || !Array.isArray(frame.actors) || !frame.actors.length || frame.actors.length > 60)
    throw new Error('Invalid battle snapshot.');
  normalize(frame);
  return frame;
}
