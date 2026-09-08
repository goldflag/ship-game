import type { Snapshot } from './SnapshotSession';

/** Decode at the authority boundary. Keep this module renderer/DOM-free so the
 * custom worker can do the parse and optional-field walk off the render thread. */
export function decodeSnapshot(json: string): Snapshot { return readSnapshot(JSON.parse(json)); }
export function readSnapshot(value: unknown): Snapshot {
  const normalize = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    const object = value as Record<string, unknown>;
    const array = Array.isArray(object);
    for (const key of Object.keys(object)) {
      if (object[key] === null && !array) delete object[key];
      else normalize(object[key]);
    }
  };
  const frame = value as Snapshot;
  if (!frame || !Number.isSafeInteger(frame.tick) || frame.tick < 0 || !Array.isArray(frame.actors) || !frame.actors.length || frame.actors.length > 60)
    throw new Error('Invalid battle snapshot.');
  normalize(frame);
  return frame;
}
