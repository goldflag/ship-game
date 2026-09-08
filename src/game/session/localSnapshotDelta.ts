/** Ordered, lossless updates for the owned custom-battle worker. Unlike online
 * packets, these cannot be dropped: one request has one response. Unchanged
 * subtrees stay on each side instead of being cloned into the render thread. */
export type LocalDelta = { value: unknown } | { array: [number, LocalDelta][] } | { object: [string, LocalDelta][]; removed: string[] };

export function localDelta(previous: unknown, next: unknown): LocalDelta | undefined {
  if (previous === next) return;
  if (!previous || !next || typeof previous !== 'object' || typeof next !== 'object' || Array.isArray(previous) !== Array.isArray(next)) return { value: next };
  if (Array.isArray(previous) && Array.isArray(next)) {
    if (previous.length !== next.length) return { value: next };
    const array: [number, LocalDelta][] = [];
    for (let i = 0; i < next.length; i++) {
      const change = localDelta(previous[i], next[i]);
      if (change) array.push([i, change]);
    }
    return array.length ? array.length > next.length / 2 && next.every(value => value === null || typeof value !== 'object') ? { value: next } : { array } : undefined;
  }
  const before = previous as Record<string, unknown>, after = next as Record<string, unknown>;
  const keys = Object.keys(after), object: [string, LocalDelta][] = [];
  const removed = Object.keys(before).filter(key => !Object.hasOwn(after, key));
  for (const key of keys) {
    const change = Object.hasOwn(before, key) ? localDelta(before[key], after[key]) : { value: after[key] };
    if (change) object.push([key, change]);
  }
  if (!removed.length && !object.length) return;
  return object.length > keys.length / 2 && keys.every(key => after[key] === null || typeof after[key] !== 'object') ? { value: next } : { object, removed };
}

/** Copy changed paths. Never mutate the snapshot currently being interpolated. */
export function applyLocalDelta(previous: unknown, delta: LocalDelta | undefined): unknown {
  if (!delta) return previous;
  if ('value' in delta) return delta.value;
  if ('array' in delta) {
    const result = (previous as unknown[]).slice();
    for (const [index, change] of delta.array) result[index] = applyLocalDelta(result[index], change);
    return result;
  }
  const result = { ...previous as Record<string, unknown> };
  for (const key of delta.removed) delete result[key];
  for (const [key, change] of delta.object) Object.defineProperty(result, key, { value: applyLocalDelta(result[key], change), enumerable: true, configurable: true, writable: true });
  return result;
}
