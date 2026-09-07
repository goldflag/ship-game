import { readFile, writeFile } from 'node:fs/promises';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
const missing = Symbol('missing');
type Value = Json | typeof missing;
const object = (v: Value): v is { [key: string]: Json } => v !== null && typeof v === 'object' && !Array.isArray(v);
function equal(a: Value, b: Value): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => equal(v, b[i]));
  if (object(a) && object(b)) return Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(k => Object.hasOwn(b, k) && equal(a[k], b[k]));
  return false;
}

function merge(base: Value, ours: Value, theirs: Value, path: string): Value {
  if (equal(ours, theirs)) return ours;
  if (equal(base, ours)) return theirs;
  if (equal(base, theirs)) return ours;
  // Only merge properties of existing objects. Concurrent incompatible additions
  // or edit/delete pairs need review, even if individual fields could be combined.
  if (object(base) && object(ours) && object(theirs)) {
    const result: { [key: string]: Json } = {};
    for (const key of new Set([...Object.keys(ours), ...Object.keys(theirs), ...Object.keys(base)])) {
      const get = (v: typeof result) => Object.hasOwn(v, key) ? v[key] : missing;
      const value = merge(get(base), get(ours), get(theirs), `${path}.${key}`);
      if (value !== missing) Object.defineProperty(result, key, { value, enumerable: true, writable: true, configurable: true });
    }
    return result;
  }
  throw new Error(`Conflicting catalog edits at ${path}`);
}

const groups = ['parts', 'torpedoes', 'depthCharges'];
function indexed(value: Json | undefined, path: string) {
  if (value === undefined) return {};
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  const entries: { [key: string]: Json } = {};
  for (const item of value) {
    if (!object(item) || typeof item.id !== 'string' || !item.id || Object.hasOwn(entries, item.id)) throw new Error(`Missing or duplicate ID in ${path}`);
    Object.defineProperty(entries, item.id, { value: item, enumerable: true });
  }
  return entries;
}

/** Catalog lists are keyed by stable ID. Geometry arrays remain indivisible. */
export function mergeCatalog(base: Json, ours: Json, theirs: Json): Json {
  if (!object(base) || !object(ours) || !object(theirs)) throw new Error('Catalog must be an object');
  const normalize = (catalog: typeof base) => {
    const result = { ...catalog };
    for (const group of groups) result[group] = indexed(catalog[group], group);
    return result;
  };
  const result = merge(normalize(base), normalize(ours), normalize(theirs), 'catalog');
  if (!object(result)) throw new Error('Invalid merged catalog');
  for (const group of groups) {
    if ([base, ours, theirs].some(c => Object.hasOwn(c, group))) result[group] = Object.values(result[group] as { [key: string]: Json });
    else delete result[group];
  }
  return result;
}

if (import.meta.main) {
  const [base, ours, theirs] = process.argv.slice(2);
  try {
    if (!base || !ours || !theirs) throw new Error('Usage: catalog-merge <base> <ours> <theirs>');
    const values = await Promise.all([base, ours, theirs].map(async p => JSON.parse(await readFile(p, 'utf8'))));
    const result = mergeCatalog(values[0], values[1], values[2]);
    await writeFile(ours, JSON.stringify(result, null, 2) + '\n');
  } catch (error) {
    // Git retains all three index stages. Never choose a side on a real conflict.
    console.error(String(error));
    process.exitCode = 1;
  }
}
