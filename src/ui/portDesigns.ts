import type { ConstructionDesignHead } from '../ships/constructionStore';
import type { LocalShipRevision } from '../ships/localShips';

/** One saved design as the port lists it: a finished ship that can berth, or a draft that can only be edited. */
export interface PortDesign {
  /** Storage identity: what the editor opens and the store deletes. Falls back to the source id for unsaved session ships. */
  id: string;
  name: string;
  updatedAt: number;
  head?: ConstructionDesignHead;
  ship?: LocalShipRevision;
  status: 'ready' | 'preparing' | 'draft' | 'recovery';
}
export type PortSort = 'recent' | 'name' | 'size';
export type PortFilter = 'all' | 'ready' | 'drafts';

export const PORT_STATUS_LABEL: Record<PortDesign['status'], string> = {
  ready: 'Ready for sea', preparing: 'Preparing preview…', draft: 'Draft · open to edit', recovery: 'Needs recovery · open to edit',
};

/** Join the saved library with the ships compiled this session. `restoring` marks drafts whose compile may still be running. */
export function portDesigns(heads: readonly ConstructionDesignHead[], local: readonly LocalShipRevision[], restoring: boolean): PortDesign[] {
  const claimed = new Set<LocalShipRevision>();
  const designs = heads.map((head): PortDesign => {
    const ship = local.find(entry => entry.source.id === (head.sourceId ?? head.id));
    if (ship) claimed.add(ship);
    return { id: head.id, name: ship?.source.name ?? head.name, updatedAt: head.updatedAt, head, ship, status: ship ? 'ready' : head.readError ? 'recovery' : restoring ? 'preparing' : 'draft' };
  });
  // A ship compiled before the library listing refreshes still belongs in port.
  for (const ship of local) if (!claimed.has(ship)) designs.push({ id: ship.source.id, name: ship.source.name, updatedAt: Number.MAX_SAFE_INTEGER, ship, status: 'ready' });
  return sortDesigns(designs, 'recent');
}

export function sortDesigns(designs: readonly PortDesign[], sort: PortSort): PortDesign[] {
  const byName = (a: PortDesign, b: PortDesign) => a.name.localeCompare(b.name);
  const length = (design: PortDesign) => design.ship?.definition.hull.length ?? -1;
  return [...designs].sort(sort === 'name' ? byName : sort === 'size' ? (a, b) => length(b) - length(a) || byName(a, b) : (a, b) => b.updatedAt - a.updatedAt || byName(a, b));
}

export function filterDesigns(designs: readonly PortDesign[], filter: PortFilter, query: string): PortDesign[] {
  const needle = query.trim().toLowerCase();
  return designs.filter(design => (filter === 'all' || (filter === 'ready') === (design.status === 'ready')) && (!needle || design.name.toLowerCase().includes(needle)));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function editedLabel(updatedAt: number, now = Date.now()): string {
  if (!Number.isFinite(updatedAt) || updatedAt >= Number.MAX_SAFE_INTEGER) return 'Edited just now';
  const minutes = Math.floor((now - updatedAt) / 60_000);
  if (minutes < 1) return 'Edited just now';
  if (minutes < 60) return `Edited ${minutes} min ago`;
  if (minutes < 60 * 24) return `Edited ${Math.floor(minutes / 60)} h ago`;
  const days = Math.floor(minutes / (60 * 24));
  if (days === 1) return 'Edited yesterday';
  if (days < 7) return `Edited ${days} days ago`;
  // Spelled out here: month abbreviations from the platform differ between browsers.
  const date = new Date(updatedAt);
  return `Edited ${date.getDate()} ${MONTHS[date.getMonth()]}${days > 300 ? ` ${date.getFullYear()}` : ''}`;
}
