import { readFile, writeFile } from 'node:fs/promises';
import { detectStyle, format, isObject, parseRaw, RawNumber, type Json } from './json-format';

const missing = Symbol('missing');
type Value = Json | typeof missing;
const object = (v: Value): v is { [key: string]: Json } => v !== missing && isObject(v);
function equal(a: Value, b: Value): boolean {
  if (a === b) return true;
  if (a instanceof RawNumber && b instanceof RawNumber) return a.raw === b.raw;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => equal(v, b[i]));
  if (object(a) && object(b)) return Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(k => Object.hasOwn(b, k) && equal(a[k], b[k]));
  return false;
}
const setKey = (target: { [key: string]: Json }, key: string, value: Json) =>
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });

/** Arrays of records with a unique string `id` (or, failing that, `partId`) in every version merge by that
 * key. Any other array, such as geometry, stays indivisible. */
function recordKey(arrays: Json[][]): string | undefined {
  const items = arrays.flat();
  if (!items.length || !items.every(isObject)) return undefined;
  return ['id', 'partId'].find(key => arrays.every(list => {
    const ids = list.map(item => (item as { [key: string]: Json })[key]);
    return ids.every(id => typeof id === 'string' && id) && new Set(ids).size === ids.length;
  }));
}

/** Record and key order: ours, unless only theirs reordered. The other side's additions follow the record that
 * precedes them there (or precede the one that follows), else go last. Two different reorderings need review. */
function order(base: string[], ours: string[], theirs: string[], kept: Set<string>, path: string) {
  const common = (list: string[]) => list.filter(k => base.includes(k) && ours.includes(k) && theirs.includes(k)).join('\n');
  const [primary, secondary] = common(theirs) === common(base) || common(ours) === common(theirs) ? [ours, theirs] : common(ours) === common(base) ? [theirs, ours] : [];
  if (!primary || !secondary) throw new Error(`Records reordered on both sides at ${path}`);
  const result = primary.filter(k => kept.has(k));
  secondary.forEach((key, i) => {
    if (!kept.has(key) || result.includes(key)) return;
    const before = secondary.slice(0, i).reverse().find(k => result.includes(k)), after = secondary.slice(i + 1).find(k => result.includes(k));
    result.splice(before !== undefined ? result.indexOf(before) + 1 : after !== undefined ? result.indexOf(after) : result.length, 0, key);
  });
  return result;
}

function merge(base: Value, ours: Value, theirs: Value, path: string): Value {
  if (equal(ours, theirs)) return ours;
  if (equal(base, ours)) return theirs;
  if (equal(base, theirs)) return ours;
  // Only merge inside values present in all three versions. Concurrent incompatible additions
  // or edit/delete pairs need review, even if individual fields could be combined.
  if (object(base) && object(ours) && object(theirs)) {
    const merged = new Map<string, Json>();
    for (const key of new Set([...Object.keys(ours), ...Object.keys(theirs), ...Object.keys(base)])) {
      const get = (v: { [key: string]: Json }) => Object.hasOwn(v, key) ? v[key] : missing;
      const value = merge(get(base), get(ours), get(theirs), `${path}.${key}`);
      if (value !== missing) merged.set(key, value);
    }
    const result: { [key: string]: Json } = {};
    for (const key of order(Object.keys(base), Object.keys(ours), Object.keys(theirs), new Set(merged.keys()), path)) setKey(result, key, merged.get(key)!);
    return result;
  }
  if (Array.isArray(base) && Array.isArray(ours) && Array.isArray(theirs)) {
    const key = recordKey([base, ours, theirs]);
    if (key) {
      const index = (list: Json[]) => new Map(list.map(item => [(item as { [key: string]: Json })[key] as string, item]));
      const [b, o, t] = [index(base), index(ours), index(theirs)];
      const merged = new Map<string, Json>();
      for (const id of new Set([...o.keys(), ...t.keys(), ...b.keys()])) {
        const value = merge(b.get(id) ?? missing, o.get(id) ?? missing, t.get(id) ?? missing, `${path}[${id}]`);
        if (value !== missing) merged.set(id, value);
      }
      return order([...b.keys()], [...o.keys()], [...t.keys()], new Set(merged.keys()), path).map(id => merged.get(id)!);
    }
  }
  throw new Error(`Conflicting edits at ${path}`);
}

/** Three-way merge of a JSON document by stable record IDs. Throws on a conflict. */
export function mergeRecords(base: Json, ours: Json, theirs: Json): Json {
  const result = merge(base, ours, theirs, '$');
  if (result === missing) throw new Error('Document deleted');
  return result;
}

/** The merged text in ours' exact formatting. Throws on a conflict or on a style no writer here reproduces. */
export function mergeText(base: string, ours: string, theirs: string): string {
  const [baseValue, oursValue, theirsValue] = [base, ours, theirs].map(parseRaw);
  const style = detectStyle(ours, oursValue, { text: theirs, value: theirsValue }, { text: base, value: baseValue });
  if (!style) throw new Error('Unrecognized JSON formatting; not merged by record');
  return format(mergeRecords(baseValue, oursValue, theirsValue), style);
}

if (import.meta.main) {
  const [base, ours, theirs, path = ours] = process.argv.slice(2);
  if (!base || !ours || !theirs) {
    console.error('Usage: catalog-merge <base> <ours> <theirs> [path]');
    process.exit(2);
  }
  const texts = await Promise.all([base, ours, theirs].map(p => readFile(p, 'utf8')));
  try {
    await writeFile(ours, mergeText(texts[0], texts[1], texts[2]));
  } catch (error) {
    // Never choose a side on a real conflict: leave base-aware line markers for review.
    // Git keeps all three versions in the index either way.
    console.error(`${path}: ${error instanceof Error ? error.message : error}`);
    const lines = Bun.spawnSync(['git', 'merge-file', '--zdiff3', '-L', 'ours', '-L', 'base', '-L', 'theirs', ours, base, theirs]);
    process.exitCode = lines.exitCode === 0 && /Unrecognized|Invalid JSON/.test(String(error)) ? 0 : 1;
  }
}
