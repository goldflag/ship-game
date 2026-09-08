/** Self-contained updates against an immutable match baseline, not the previous
 * packet. Structured cloning prevents renderer mutation from changing the base. */
export function expandSnapshot(baseline: unknown, update: unknown): unknown {
  if (!update || typeof update !== 'object' || !('type' in update) || update.type !== 'snapshot-delta' || !('patches' in update) || !Array.isArray(update.patches)) throw new Error('Invalid snapshot update.');
  if (update.patches.length > 250_000) throw new Error('Too many snapshot changes.');
  let result = structuredClone(baseline);
  for (const patch of update.patches) {
    if (!Array.isArray(patch) || patch.length !== 2 || !Array.isArray(patch[0]) || patch[0].length > 32) throw new Error('Invalid snapshot change.');
    const [path, value] = patch;
    if (!path.length) { result = value; continue; }
    let target = result as Record<string | number, unknown>;
    for (let i = 0; i < path.length; i++) {
      const key = path[i];
      if ((typeof key !== 'string' && typeof key !== 'number') || ['__proto__', 'prototype', 'constructor'].includes(String(key)) || !target || typeof target !== 'object') throw new Error('Invalid snapshot path.');
      if (Array.isArray(target) && (typeof key !== 'number' || !Number.isInteger(key) || key < 0 || key >= target.length)) throw new Error('Invalid snapshot index.');
      if (i === path.length - 1) target[key] = value;
      else { if (!Object.hasOwn(target, key)) throw new Error('Missing snapshot path.'); target = target[key] as typeof target; }
    }
  }
  return result;
}
