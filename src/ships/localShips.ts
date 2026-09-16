import { sessionShip } from './sessionShips';
import { onAccountChange } from '../accounts/session';
import type { ConstructionResult, ConstructionSource, ShipDefinition } from './blueprint';
import { shipPreset, shipPresets } from './presets';

export type IdentifiedShip = ShipDefinition & { contentHash: string };
export interface LocalShipRevision {
  source: ConstructionSource;
  result: ConstructionResult;
  definition: IdentifiedShip;
  thumbnail?: string;
}

/** Port presentation only. Each battle takes its own immutable revision snapshot;
 * neither the historical roster nor the online content manifest is extended. */
const bySource = new Map<string, LocalShipRevision>();
let snapshot: readonly LocalShipRevision[] = [];
const listeners = new Set<() => void>();
export const localShips = () => snapshot;
export const subscribeLocalShips = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const isHistoricalShip = (id: string) => Object.hasOwn(shipPresets, id);
export const isLocalShipId = (id: string) => id.startsWith('local-');

function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}
function changed() {
  snapshot = [...bySource.values()].sort((a, b) => a.source.name.localeCompare(b.source.name));
  listeners.forEach(listener => listener());
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(',')}}`;
  return JSON.stringify(value);
}
export function registerLocalShip(source: ConstructionSource, result: ConstructionResult, thumbnail?: string): LocalShipRevision {
  const definition = result.definition;
  if (!definition || result.diagnostics.some(d => d.severity === 'error')) throw new Error('Resolve the design errors before adding this ship to a battle.');
  if (result.sourceId !== source.id || result.revision !== source.revision
    || !result.contentHash || definition.contentHash !== result.contentHash
    || definition.constructionRevision !== source.revision || !definition.construction
    || canonical(definition.construction) !== canonical(source.construction)
    || !isLocalShipId(definition.id) || isHistoricalShip(definition.id)) {
    throw new Error('The design preview is out of date. Recompile this revision before launching.');
  }
  const entry = freeze(structuredClone({ source, result, definition: definition as IdentifiedShip, thumbnail }));
  bySource.set(source.id, entry); changed();
  return entry;
}
export function removeLocalShip(sourceId: string): void { if (bySource.delete(sourceId)) changed(); }
export function localShip(id: string): LocalShipRevision | undefined { return snapshot.find(entry => entry.definition.id === id); }
/** Unknown IDs are errors. A missing saved design must never become Bismarck. */
export function resolveShip(id: string): IdentifiedShip {
  if (isHistoricalShip(id)) return shipPreset(id);
  const entry = localShip(id) ?? sessionShip(id);
  if (!entry) throw new Error(`Ship unavailable: ${id}. Open its saved design and compile it again.`);
  return entry.definition;
}
export const availableShipIds = () => [...Object.keys(shipPresets), ...snapshot.map(entry => entry.definition.id)];
export function freezeLocalFleet(ids: readonly string[]): readonly LocalShipRevision[] {
  return [...new Set(ids)].flatMap(id => {
    if (isHistoricalShip(id)) return [];
    const entry = localShip(id);
    if (!entry) throw new Error(`Saved ship unavailable: ${id}. Open the design before launching.`);
    return [entry];
  });
}

onAccountChange(() => { bySource.clear(); changed(); });
