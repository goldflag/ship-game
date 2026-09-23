import type { ShipDefinition } from './blueprint';
import catalog from './presetCatalog.json';
import { decodeRuntimeDefinition } from './runtimeEncoding';
import { assetUrl } from '../assetUrl';
/** The published hydrostatic lookup travels with the runtime content; only the Rust authority reads it. */
type HydrostaticTable = { version: 1; nodes: string };
type Definition = ShipDefinition & { contentHash: string };
const entries = catalog as unknown as Record<string, Record<string, unknown> & { runtime: { url: string; sha256: string; hydro?: { url: string; sha256: string } } }>;
const loaded = new Map<string, Definition>(), pending = new Map<string, Promise<Definition>>();
let nodeTables: Promise<{ ships: Record<string, HydrostaticTable & { contentHash: string }> }> | undefined;
async function verifiedBytes(url: string, sha256: string): Promise<Uint8Array<ArrayBuffer>> {
  const response = await fetch(assetUrl(url));
  if (!response.ok) throw new Error('Unable to load ship asset: ' + url);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
  if (digest !== sha256) throw new Error('Ship runtime digest mismatch: ' + url);
  return bytes;
}
const omitted = new Set(['armor', 'compartments', 'connections', 'mountClearance', 'construction', 'loading']);
/** Lightweight menu metadata is available synchronously. Simulation-only access
 * before admission throws instead of quietly substituting incomplete geometry.
 *
 * The result (what `shipPreset(id)` returns) is a proxy typed as a full ShipDefinition. Until `loadShipPreset(id)`
 * resolves, it serves the summary in presetCatalog.json (written by scripts/ships/runtime-assets.ts): every field
 * except those below, plus `armorMaxMm` and `runtime`. Reading `armor`, `compartments`, `connections`,
 * `mountClearance` or `loading`, or `hull.volume` or `hull.sections`, throws; `construction` holds only
 * `catalogRevision`. After loading, every read goes to the full definition. Outside a browser, presets.ts loads
 * every preset when imported, so tests and CLI scripts that import it never see the summary. */
export function preset(id: string): Definition {
  const summary = entries[id]; if (!summary) throw new Error('Missing preset metadata: ' + id + '. Run multiplayer:content.');
  const hull = new Proxy(summary.hull as object, { get(target, key) {
    if (loaded.has(id)) return Reflect.get(loaded.get(id)!.hull, key);
    if (key === 'volume' || key === 'sections') throw new Error('Load ship definition before geometry access: ' + id);
    return Reflect.get(target, key);
  } });
  return new Proxy(summary, {
    has: (_, key) => Reflect.has(loaded.get(id) ?? summary, key),
    ownKeys: () => Reflect.ownKeys(loaded.get(id) ?? summary),
    getOwnPropertyDescriptor: (_, key) => { const descriptor = Object.getOwnPropertyDescriptor(loaded.get(id) ?? summary, key); return descriptor && { ...descriptor, configurable: true }; },
    get(target, key) {
    const definition = loaded.get(id); if (definition) return Reflect.get(definition, key);
    if (key === 'hull') return hull;
    // Presence is enough for menu classification; source/geometry consumers await admission.
    if (omitted.has(String(key)) && key !== 'construction') throw new Error('Load ship definition before runtime access: ' + id);
    return Reflect.get(target, key);
  } }) as unknown as Definition;
}
export function loadShipPreset(id: string): Promise<Definition> {
  const old = loaded.get(id); if (old) return Promise.resolve(old);
  const previous = pending.get(id); if (previous) return previous;
  const entry = entries[id]; if (!entry) return Promise.reject(new Error('Unknown ship preset: ' + id));
  const promise = (async () => {
    let definition: Definition;
    if (typeof window === 'undefined' && typeof Bun !== 'undefined') {
      // CLI/tests use authoritative build outputs, including before derived assets exist.
      definition = await Bun.file(import.meta.dir + '/../../public/models/' + id + '.json').json();
    } else {
      const bytes = await verifiedBytes(entry.runtime.url, entry.runtime.sha256);
      definition = decodeRuntimeDefinition<Definition>(bytes);
    }
    if (definition.id !== id || (typeof window !== 'undefined' && definition.contentHash !== entry.contentHash)) throw new Error('Ship runtime identity mismatch: ' + id);
    let table: (HydrostaticTable & { contentHash: string }) | undefined;
    if (typeof window === 'undefined' && typeof Bun !== 'undefined') {
      nodeTables ??= Bun.file(import.meta.dir + '/../../assets/gameplay/hydrostatics.v1.json').json();
      table = (await nodeTables!).ships[id];
    } else if (entry.runtime.hydro) {
      table = JSON.parse(new TextDecoder().decode(await verifiedBytes(entry.runtime.hydro.url, entry.runtime.hydro.sha256)));
    }
    if (table && table.contentHash !== definition.contentHash) throw new Error('Hydrostatic table identity mismatch: ' + id);
    loaded.set(id, definition); return definition;
  })();
  pending.set(id, promise);
  void promise.finally(() => pending.delete(id)).catch(() => {});
  return promise;
}
export async function loadShipPresets(ids: readonly string[]): Promise<void> {
  // Bound peak parsing memory. Local source revisions have a separate admission path.
  for (const id of new Set(ids)) if (entries[id]) await loadShipPreset(id);
}
