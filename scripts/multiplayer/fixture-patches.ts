/** Lossless fixture deltas keep repeated pristine compartment state out of version control. */
export type FixturePatch = { path: (string | number)[]; value: unknown };
export function fixturePatches(before: unknown, after: unknown, path: (string|number)[] = []): FixturePatch[] {
 if (JSON.stringify(before) === JSON.stringify(after)) return [];
 if (Array.isArray(before) && Array.isArray(after) && before.length === after.length)
  return after.flatMap((value, i) => fixturePatches(before[i], value, [...path, i]));
 if (before && after && typeof before === 'object' && typeof after === 'object' && !Array.isArray(before) && !Array.isArray(after) && Object.keys(before).every(k => k in after))
  return Object.entries(after).flatMap(([key, value]) => fixturePatches((before as Record<string, unknown>)[key], value, [...path, key]));
 return [{ path, value: after }];
}
