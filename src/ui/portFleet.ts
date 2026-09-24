/** The port's fleet line and berth memory. The line holds the tree ships the player owns, by nation in tree
 * order (each nation's lines in turn, oldest first), then their ready designs. Enemy-only presets never appear. */
import { canCommandPreset, type ProgressSnapshot } from '../progression/store';
import { TECH_TREE, presetPlace, type NationId, type TechNation, type TechNode } from '../progression/techTree';
import { shipPreset } from '../ships/presets';
import type { PortDesign } from './portDesigns';

export type FleetEntry =
  | {
      kind: 'preset';
      key: string;
      /** The preset id: what the port berths. */
      shipId: string;
      /** The modelled ship's own name, as the port and battle show her ("USS Cleveland"); the tree names her class. */
      name: string;
      node: TechNode;
      nation: TechNation;
      /** A locked ship being previewed: shown at her place in her nation, not yet the player's. */
      locked?: true;
    }
  | { kind: 'design'; key: string; shipId: string; name: string; design: PortDesign };
export interface FleetGroup {
  id: NationId | 'designs';
  label: string;
  nation?: TechNation;
  entries: FleetEntry[];
}

const presetEntry = (node: TechNode, nation: TechNation, locked: boolean): FleetEntry => ({
  kind: 'preset',
  key: `preset:${node.presetId}`,
  shipId: node.presetId!,
  name: shipPreset(node.presetId!).name,
  node,
  nation,
  ...(locked ? { locked: true as const } : {}),
});

/** The fleet line's groups. `preview` is a locked tree ship alongside for inspection: she keeps her place in her
 * nation's group, marked locked, so the line still says where she would sit. The designs group is always present:
 * it carries New design and All designs. */
export function portFleet(snapshot: ProgressSnapshot, designs: readonly PortDesign[], preview?: string): FleetGroup[] {
  const groups: FleetGroup[] = [];
  for (const nation of TECH_TREE) {
    const entries = nation.lines.flatMap((line) =>
      line.nodes.flatMap((node) => {
        if (!node.presetId) return [];
        if (canCommandPreset(snapshot, node.presetId)) return [presetEntry(node, nation, false)];
        return node.presetId === preview ? [presetEntry(node, nation, true)] : [];
      }),
    );
    if (entries.length) groups.push({ id: nation.id, label: nation.name, nation, entries });
  }
  groups.push({
    id: 'designs',
    label: 'Your designs',
    entries: designs
      .filter((design) => design.ship)
      .map((design) => ({ kind: 'design', key: `design:${design.ship!.source.id}`, shipId: design.ship!.definition.id, name: design.name, design })),
  });
  return groups;
}

/** A new player's first berth, and the fallback when nothing else is known: a starter every profile owns. */
export const STARTER_BERTH = 'cleveland';

export type BerthMemory = { kind: 'preset'; presetId: string } | { kind: 'design'; sourceId: string };
const BERTH_KEY = 'port.berth';
/** Before tree ships could berth, the port remembered only a design's source id. */
const LEGACY_DESIGN_KEY = 'port.design';

/** The ship last berthed in this browser, so the port reopens on her. */
export function rememberedBerth(): BerthMemory | undefined {
  try {
    const value = localStorage.getItem(BERTH_KEY);
    if (value?.startsWith('preset:')) return { kind: 'preset', presetId: value.slice(7) };
    if (value?.startsWith('design:')) return { kind: 'design', sourceId: value.slice(7) };
    const legacy = localStorage.getItem(LEGACY_DESIGN_KEY);
    return legacy ? { kind: 'design', sourceId: legacy } : undefined;
  } catch {
    return undefined;
  }
}
export function rememberBerth(entry: FleetEntry): void {
  if (entry.kind === 'preset' && entry.locked) return;
  try {
    localStorage.setItem(BERTH_KEY, entry.kind === 'preset' ? `preset:${entry.shipId}` : `design:${entry.design.ship!.source.id}`);
  } catch {
    /* Private windows reopen on the starter. */
  }
}

/** The preset the harbor loads first: the tree ship last berthed here, else the starter. A remembered design is not
 * compiled yet, so the port loads the starter under an empty quay and brings the design alongside once it compiles. */
export function openingPreset(memory = rememberedBerth()): string {
  return memory?.kind === 'preset' && presetPlace(memory.presetId) ? memory.presetId : STARTER_BERTH;
}

const remembers = (entry: FleetEntry, memory: BerthMemory) =>
  memory.kind === 'preset' ? entry.kind === 'preset' && entry.shipId === memory.presetId : entry.kind === 'design' && entry.design.ship!.source.id === memory.sourceId;
/** Where the port goes when the ship alongside is not the player's: the remembered berth if she is in the fleet, else the
 * starter, else the first ship the player has. */
export function fallbackBerth(entries: readonly FleetEntry[], memory = rememberedBerth()): FleetEntry | undefined {
  const owned = entries.filter((entry) => !(entry.kind === 'preset' && entry.locked));
  return (memory && owned.find((entry) => remembers(entry, memory))) ?? owned.find((entry) => entry.shipId === STARTER_BERTH) ?? owned[0];
}
