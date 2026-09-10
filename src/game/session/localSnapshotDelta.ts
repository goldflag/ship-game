/** Ordered, lossless updates for the owned custom-battle worker. Unlike online
 * packets, these cannot be dropped: one request has one response. Unchanged
 * subtrees stay on each side instead of being cloned into the render thread. */
export type LocalDelta = string | number | boolean | null | { value: unknown } | { array: [number, LocalDelta][] } | { object: Record<string, LocalDelta>; removed?: string[] };

function replacement(value: unknown): LocalDelta {
  // Scalar leaves need no wrapper during structured cloning. Keep undefined
  // wrapped because an undefined delta means that the old value is unchanged.
  return value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? value : { value };
}

function setField<T>(object: Record<string, T>, key: string, value: T): void {
  if (key === '__proto__') Object.defineProperty(object, key, { value, enumerable: true, configurable: true, writable: true });
  else object[key] = value;
}

export function localDelta(previous: unknown, next: unknown): LocalDelta | undefined {
  if (previous === next) return;
  if (!previous || !next || typeof previous !== 'object' || typeof next !== 'object' || Array.isArray(previous) !== Array.isArray(next)) return replacement(next);
  if (Array.isArray(previous) && Array.isArray(next)) {
    if (previous.length !== next.length) return { value: next };
    let array: [number, LocalDelta][] | undefined;
    for (let i = 0; i < next.length; i++) {
      const change = localDelta(previous[i], next[i]);
      if (change !== undefined) (array ??= []).push([i, change]);
    }
    return array ? array.length > next.length / 2 && next.every(value => value === null || typeof value !== 'object') ? { value: next } : { array } : undefined;
  }
  const before = previous as Record<string, unknown>, after = next as Record<string, unknown>;
  const keys = Object.keys(after);
  let object: Record<string, LocalDelta> | undefined, removed: string[] | undefined, changed = 0;
  for (const key of Object.keys(before)) if (!Object.hasOwn(after, key)) (removed ??= []).push(key);
  for (const key of keys) {
    const change = Object.hasOwn(before, key) ? localDelta(before[key], after[key]) : replacement(after[key]);
    if (change !== undefined) { setField(object ??= {}, key, change); changed++; }
  }
  if (!removed && !object) return;
  return object && changed > keys.length / 2 && keys.every(key => after[key] === null || typeof after[key] !== 'object') ? { value: next } : { object: object ?? {}, removed };
}

/** Copy changed paths. Never mutate the snapshot currently being interpolated. */
export function applyLocalDelta(previous: unknown, delta: LocalDelta | undefined): unknown {
  if (delta === undefined) return previous;
  if (delta === null || typeof delta !== 'object') return delta;
  if ('value' in delta) return delta.value;
  if ('array' in delta) {
    const result = (previous as unknown[]).slice();
    for (const [index, change] of delta.array) result[index] = applyLocalDelta(result[index], change);
    return result;
  }
  const result = { ...previous as Record<string, unknown> };
  if (delta.removed) for (const key of delta.removed) delete result[key];
  for (const key of Object.keys(delta.object)) setField(result, key, applyLocalDelta(result[key], delta.object[key]));
  return result;
}
